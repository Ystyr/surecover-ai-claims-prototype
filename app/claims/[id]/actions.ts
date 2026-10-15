"use server"

import { redirect } from "next/navigation"

import { assessClaim, quotableItems, validateFactValue } from "@/checks/assess.mjs"
import { isUuid } from "@/lib/findings"
import { createClient } from "@/lib/supabase/server"

export async function correctFact(formData: FormData) {
  const claimId = String(formData.get("claim_id") ?? "")
  const factKey = String(formData.get("fact_key") ?? "")
  const rationale = String(formData.get("rationale") ?? "").trim()
  if (!isUuid(claimId)) redirect("/")
  if (!factKey) redirect(`/claims/${claimId}?correction=missing`)
  if (!rationale) redirect(`/claims/${claimId}?correction=rationale`)

  const supabase = await createClient()
  const fact = await supabase
    .from("extracted_facts")
    .select("id, field, original_value")
    .eq("claim_id", claimId)
    .eq("fact_key", factKey)
    .maybeSingle()
  if (fact.error) redirect(`/claims/${claimId}?correction=read`)
  if (!fact.data) redirect(`/claims/${claimId}?correction=missing`)

  const validated = validateFactValue(fact.data.field, String(formData.get("value") ?? ""))
  if (!validated) redirect(`/claims/${claimId}?correction=invalid`)

  const corrections = await loadCorrections(supabase, claimId)
  if (!corrections) redirect(`/claims/${claimId}?correction=read`)
  const effective = corrections.latest.get(factKey) ?? fact.data.original_value
  if (validated === effective) redirect(`/claims/${claimId}?correction=unchanged`)

  const prepared = await loadAssessmentInput(supabase, claimId)
  if (!prepared) redirect(`/claims/${claimId}?correction=read`)
  corrections.latest.set(factKey, validated)
  const assessment = assessClaim({
    receivedAt: prepared.receivedAt,
    policy: prepared.policy,
    documents: prepared.documents,
    corrections: [...corrections.latest].map(([key, value]) => ({ factKey: key, value })),
  })

  const saved = await supabase.rpc("record_fact_correction", {
    p_claim_id: claimId,
    p_fact_key: factKey,
    p_corrected_value: validated,
    p_rationale: rationale,
    p_checks: assessment.checks,
    p_baseline: corrections.baseline,
  })
  if (saved.error) redirect(`/claims/${claimId}?correction=${correctionCode(saved.error.message)}`)
  redirect(`/claims/${claimId}`)
}

function correctionCode(message: string) {
  const text = message.toLowerCase()
  if (text.includes("value unchanged")) return "unchanged"
  if (text.includes("fact not found")) return "missing"
  if (text.includes("value invalid")) return "invalid"
  if (text.includes("stale correction")) return "stale"
  return "save"
}

const DECISIONS = ["request", "approve", "reject"]

export async function recordDecision(formData: FormData) {
  const claimId = String(formData.get("claim_id") ?? "")
  const action = String(formData.get("action") ?? "")
  const assessmentId = String(formData.get("assessment_id") ?? "")
  const rationale = String(formData.get("rationale") ?? "").trim()
  if (!isUuid(claimId)) redirect("/")
  if (!rationale) redirect(`/claims/${claimId}?decision=rationale`)
  if (!isUuid(assessmentId) || !DECISIONS.includes(action)) redirect(`/claims/${claimId}?decision=save`)

  const supabase = await createClient()
  const saved = await supabase.rpc("record_claim_decision", {
    p_claim_id: claimId,
    p_action: action,
    p_rationale: rationale,
    p_assessment_id: assessmentId,
  })
  if (saved.error) {
    const code = decisionCode(saved.error.message)
    if (code === "missing") redirect("/")
    redirect(`/claims/${claimId}?decision=${code}`)
  }
  redirect(`/claims/${claimId}`)
}

function decisionCode(message: string) {
  const text = message.toLowerCase()
  if (text.includes("rationale required")) return "rationale"
  if (text.includes("checks unnamed")) return "unnamed"
  if (text.includes("stale decision")) return "stale"
  if (text.includes("decision recorded")) return "recorded"
  if (text.includes("claim not found")) return "missing"
  return "save"
}

async function loadCorrections(
  supabase: Awaited<ReturnType<typeof createClient>>,
  claimId: string,
) {
  const facts = await supabase.from("extracted_facts").select("id, fact_key").eq("claim_id", claimId)
  if (facts.error || !facts.data) return null
  if (facts.data.length === 0) return { latest: new Map<string, string>(), baseline: [] }
  const rows = await supabase
    .from("fact_corrections")
    .select("id, fact_id, corrected_value, created_at")
    .in(
      "fact_id",
      facts.data.map((fact) => fact.id),
    )
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
  if (rows.error || !rows.data) return null
  const keyById = new Map(facts.data.map((fact) => [fact.id, fact.fact_key]))
  const latest = new Map<string, string>()
  const latestId = new Map<string, string>()
  for (const row of rows.data) {
    const key = keyById.get(row.fact_id)
    if (!key) continue
    latest.set(key, row.corrected_value)
    latestId.set(key, row.id)
  }
  return {
    latest,
    baseline: facts.data.map((fact) => ({
      fact_key: fact.fact_key,
      correction_id: latestId.get(fact.fact_key) ?? null,
    })),
  }
}

async function loadAssessmentInput(supabase: Awaited<ReturnType<typeof createClient>>, claimId: string) {
  const claim = await supabase.from("claims").select("received_at, policy_version").eq("id", claimId).maybeSingle()
  if (claim.error || !claim.data) return null
  const policy = await supabase
    .from("policies")
    .select("coverage_start, coverage_end, public_holidays")
    .eq("version", claim.data.policy_version)
    .maybeSingle()
  if (policy.error || !policy.data) return null
  const documents = await supabase.from("claim_documents").select("id, source_file").eq("claim_id", claimId)
  if (documents.error || !documents.data) return null
  const documentIds = documents.data.map((document) => document.id)
  const pages = await supabase.from("quotable_pages").select("document_id, page_number").in("document_id", documentIds)
  if (pages.error || !pages.data) return null
  const items = await supabase
    .from("document_items")
    .select("document_id, page_number, item_index, text")
    .in("document_id", documentIds)
    .order("item_index")
  if (items.error || !items.data) return null

  const quoted = quotableItems(items.data, pages.data)
  const byDocument = new Map(documents.data.map((document) => [document.id, { sourceFile: document.source_file, items: [] as { text: string; pageNumber: number }[] }]))
  for (const item of quoted) {
    byDocument.get(item.document_id)?.items.push({ text: item.text, pageNumber: item.page_number })
  }
  return {
    receivedAt: claim.data.received_at,
    policy: policy.data,
    documents: [...byDocument.values()],
  }
}
