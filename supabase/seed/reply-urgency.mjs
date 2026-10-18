// Proves an urgent reply is flagged on a new live claim. Existing claims stay.
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createClient } from "@supabase/supabase-js"

import { assessClaim, NOUL_SUPPORT, quotableItems } from "../../checks/assess.mjs"
import { liveClaimReference } from "../../lib/inbound.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const CLAIM_ID = "c1a10001-de10-4000-a000-000000001007"
const INBOUND_ID = "c1a10001-de10-4000-a000-000000001017"
const EMAIL_ID = "urgency-reply"
const CLAIM_REFERENCE = liveClaimReference(EMAIL_ID)
const REPLY = "I am frustrated with the wait. Please handle this claim sooner."
const RATIONALE = "The documents are on file. Please confirm nothing else is needed."
const CHECKS = ["completeness", "filing_deadline", "coverage", "claim_type", "consistency", "delay"]
const KEPT = [
  "CLM-DEMO-1001",
  "CLM-DEMO-1002",
  "CLM-DEMO-1003",
  "CLM-DEMO-1004",
  "CLM-DEMO-1005",
  "CLM-LIVE-7FEE6FF8C2E1",
  "CLM-LIVE-DRYRUNCOMPLE",
  "CLM-LIVE-UNAVAILABLER",
]

function projectEnv() {
  let raw
  try {
    raw = readFileSync(path.join(root, ".env"), "utf8")
  } catch {
    throw new Error("Missing .env")
  }
  const env = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "")
  }
  const url = env.SUPABASE_URL
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = env.SUPABASE_PUBLISHABLE_KEY
  const password = env.OFFICER_PASSWORD
  if (!url || !serviceRole || !anonKey || !password) {
    throw new Error(".env must set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PUBLISHABLE_KEY, and OFFICER_PASSWORD")
  }
  return { url, serviceRole, anonKey, password }
}

async function snapshot(db) {
  const claims = await db.from("claims").select("id, reference, status").in("reference", KEPT)
  if (claims.error) throw claims.error
  if (claims.data.length !== KEPT.length) throw new Error("a kept claim is missing")
  const rows = []
  for (const claim of claims.data) {
    const documents = await db.from("claim_documents").select("id").eq("claim_id", claim.id)
    const messages = await db.from("claim_messages").select("id").eq("claim_id", claim.id)
    const inbound = await db.from("inbound_messages").select("id, body, unavailable_noul, documents_noul, urgency_noul").eq("claim_id", claim.id)
    if (documents.error) throw documents.error
    if (messages.error) throw messages.error
    if (inbound.error) throw inbound.error
    rows.push({
      reference: claim.reference,
      id: claim.id,
      status: claim.status,
      files: documents.data.length,
      messages: messages.data.length,
      inbound: inbound.data,
    })
  }
  const testMail = await db
    .from("inbound_messages")
    .select("id, body, claim_id, documents_noul, documents_reply_subject, urgency_noul")
    .eq("subject", "Test")
    .is("claim_id", null)
    .maybeSingle()
  const question = await db
    .from("inbound_messages")
    .select("id, claim_id, documents_noul, documents_reply_subject, urgency_noul")
    .eq("provider_email_id", "documents-question")
    .maybeSingle()
  if (testMail.error) throw testMail.error
  if (question.error) throw question.error
  if (!testMail.data || !question.data) throw new Error("the stored unmatched mail is missing")
  return {
    claims: rows.sort((a, b) => a.reference.localeCompare(b.reference)),
    testMail: testMail.data,
    question: question.data,
  }
}

async function createClaim(db, expected, officerId) {
  const claim = expected.claim
  const inserted = await db.from("claims").insert({
    id: CLAIM_ID,
    reference: CLAIM_REFERENCE,
    status: "needs review",
    policy_version: expected.policy_version,
    claimant_name: claim.claimant_name,
    policy_reference: claim.policy_reference,
    traveler_email: claim.traveler_email,
    return_date: claim.return_date,
    received_at: claim.received_at,
    assigned_officer_id: officerId,
  })
  if (inserted.error) throw inserted.error
  if (expected.sample_documents.length !== 7) throw new Error(`expected 7 files, found ${expected.sample_documents.length}`)
  for (const sample of expected.sample_documents) {
    const parse = JSON.parse(readFileSync(path.join(root, "fixtures/parses/complete", `${sample.file}.json`), "utf8"))
    const bytes = readFileSync(path.join(root, "fixtures/samples/complete", sample.file))
    const uploaded = await db.storage.from("claim-files").upload(`${CLAIM_ID}/${sample.file}`, new Uint8Array(bytes), {
      contentType: parse.media_type,
      upsert: false,
    })
    if (uploaded.error) throw uploaded.error
    const document = await db
      .from("claim_documents")
      .insert({
        claim_id: CLAIM_ID,
        source_file: sample.file,
        media_type: parse.media_type,
        storage_path: `${CLAIM_ID}/${sample.file}`,
        text_source: parse.text_source,
        parser: parse.parser,
        parser_version: parse.parser_version,
      })
      .select("id")
      .single()
    if (document.error) throw document.error
    const pages = await db.from("document_pages").insert(
      parse.pages.map((page) => ({
        document_id: document.data.id,
        page_number: page.page_number,
        text: page.text,
        text_source: page.text_source,
      })),
    )
    if (pages.error) throw pages.error
    const items = await db.from("document_items").insert(
      parse.items.map((item, itemIndex) => ({
        document_id: document.data.id,
        page_number: item.page_number,
        item_index: itemIndex,
        text: item.text,
        label: item.label,
        bbox: item.bbox,
        confidence: item.confidence ?? null,
        review: item.review ?? null,
      })),
    )
    if (items.error) throw items.error
  }
  const policy = await db.from("policies").select("coverage_start, coverage_end, public_holidays").eq("version", expected.policy_version).single()
  if (policy.error) throw policy.error
  const documents = await db.from("claim_documents").select("id, source_file").eq("claim_id", CLAIM_ID)
  if (documents.error) throw documents.error
  const documentIds = documents.data.map((document) => document.id)
  const pages = await db.from("quotable_pages").select("document_id, page_number").in("document_id", documentIds)
  if (pages.error) throw pages.error
  const items = await db.from("document_items").select("document_id, page_number, item_index, text").in("document_id", documentIds).order("item_index")
  if (items.error) throw items.error
  const quoted = quotableItems(items.data, pages.data)
  const byDocument = new Map(documents.data.map((document) => [document.id, { sourceFile: document.source_file, items: [] }]))
  for (const item of quoted) byDocument.get(item.document_id).items.push({ text: item.text, pageNumber: item.page_number })
  const assessment = assessClaim({ receivedAt: claim.received_at, policy: policy.data, documents: [...byDocument.values()] })
  for (const name of CHECKS) {
    const check = assessment.checks.find((entry) => entry.check_name === name)
    if (check?.outcome !== "pass") throw new Error(`${name} is ${check?.outcome}`)
  }
  const saved = await db.from("assessments").insert({ claim_id: CLAIM_ID, adapter: assessment.adapter }).select("id").single()
  if (saved.error) throw saved.error
  const checks = await db.from("policy_checks").insert(
    assessment.checks.map((entry) => ({
      assessment_id: saved.data.id,
      claim_id: CLAIM_ID,
      check_name: entry.check_name,
      outcome: entry.outcome,
      detail: entry.detail,
    })),
  )
  if (checks.error) throw checks.error
}

async function ensureRequest(officer, claimId) {
  const decisions = await officer.from("claim_decisions").select("id, action").eq("claim_id", claimId)
  if (decisions.error) throw decisions.error
  let request = decisions.data.find((decision) => decision.action === "request")
  if (!request) {
    const assessments = await officer.from("assessments").select("id").eq("claim_id", claimId).order("created_at", { ascending: false }).limit(1)
    if (assessments.error) throw assessments.error
    const saved = await officer.rpc("record_claim_decision", {
      p_claim_id: claimId,
      p_action: "request",
      p_rationale: RATIONALE,
      p_assessment_id: assessments.data[0].id,
    })
    if (saved.error) throw saved.error
    request = { id: saved.data, action: "request" }
  }
  const existing = await officer.from("claim_messages").select("id").eq("decision_id", request.id).maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data) return
  const message = await officer.rpc("record_request_message", { p_decision_id: request.id })
  if (message.error) throw message.error
}

function receive(inboundId) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "supabase/seed/receive-mail.mjs", inboundId], {
    cwd: root,
    encoding: "utf8",
  })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "receive failed")
  return `${result.stdout}${result.stderr}`
}

async function main() {
  if (CLAIM_REFERENCE !== "CLM-LIVE-URGENCYREPLY") throw new Error(`reference is ${CLAIM_REFERENCE}`)
  const { url, serviceRole, anonKey, password } = projectEnv()
  const db = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })
  const officer = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const signedIn = await officer.auth.signInWithPassword({ email: "officer-a@example.com", password })
  if (signedIn.error) throw signedIn.error
  const before = await snapshot(db)
  const expected = JSON.parse(readFileSync(path.join(root, "fixtures/expected/complete-claim.json"), "utf8"))
  const officerRow = await db.from("officers").select("id").eq("email", "officer-a@example.com").single()
  if (officerRow.error) throw officerRow.error
  const existing = await db.from("claims").select("id").eq("reference", CLAIM_REFERENCE).maybeSingle()
  if (existing.error) throw existing.error
  const claimId = existing.data?.id ?? CLAIM_ID
  if (!existing.data) await createClaim(db, expected, officerRow.data.id)
  await ensureRequest(officer, claimId)

  const stored = await db.from("inbound_messages").select("id, claim_id").eq("provider_email_id", EMAIL_ID).maybeSingle()
  if (stored.error) throw stored.error
  if (!stored.data) {
    const inserted = await db.from("inbound_messages").insert({
      id: INBOUND_ID,
      provider: "resend",
      provider_email_id: EMAIL_ID,
      from_address: "Jamie Lee <jamie.lee@example.com>",
      subject: `Re: Information requested for ${CLAIM_REFERENCE}`,
      body: REPLY,
    })
    if (inserted.error) throw inserted.error
  }
  const listed = await db.storage.from("claim-files").list(`inbound/${EMAIL_ID}`)
  if (listed.error) throw listed.error
  if (!listed.data?.some((entry) => entry.name === "claim-form.pdf")) {
    const bytes = readFileSync(path.join(root, "fixtures/samples/complete/claim-form.pdf"))
    const uploaded = await db.storage.from("claim-files").upload(`inbound/${EMAIL_ID}/claim-form.pdf`, new Uint8Array(bytes), {
      contentType: "application/pdf",
      upsert: false,
    })
    if (uploaded.error) throw uploaded.error
  }
  const inbound = await db.from("inbound_messages").select("id, claim_id").eq("provider_email_id", EMAIL_ID).single()
  if (inbound.error) throw inbound.error
  if (!inbound.data.claim_id) {
    const first = receive(inbound.data.id)
    if (!first.includes(`reply stored on ${CLAIM_REFERENCE}`)) throw new Error(first.trim())
  }

  const proved = await db
    .from("inbound_messages")
    .select("claim_id, body, urgency_noul")
    .eq("provider_email_id", EMAIL_ID)
    .single()
  if (proved.error) throw proved.error
  if (proved.data.claim_id !== claimId || proved.data.body !== REPLY) throw new Error("the urgent reply was not linked")
  if (typeof proved.data.urgency_noul !== "number" || proved.data.urgency_noul < NOUL_SUPPORT) {
    throw new Error("the reply was not flagged")
  }
  const claim = await db.from("claims").select("status").eq("id", claimId).single()
  const messages = await db.from("claim_messages").select("subject").eq("claim_id", claimId)
  const assessments = await db.from("assessments").select("id").eq("claim_id", claimId).order("created_at", { ascending: false })
  if (claim.error) throw claim.error
  if (messages.error) throw messages.error
  if (assessments.error) throw assessments.error
  if (claim.data.status !== "needs review") throw new Error(`${CLAIM_REFERENCE} is ${claim.data.status}`)
  if (messages.data.length !== 1 || messages.data[0].subject !== `Information requested for ${CLAIM_REFERENCE}`) {
    throw new Error("the urgent reply sent a new message")
  }
  if (assessments.data.length !== 2) throw new Error(`${CLAIM_REFERENCE} has ${assessments.data.length} assessments`)
  for (const assessment of assessments.data) {
    const checks = await db.from("policy_checks").select("check_name, outcome").eq("assessment_id", assessment.id)
    if (checks.error) throw checks.error
    for (const name of CHECKS) {
      const check = checks.data.find((entry) => entry.check_name === name)
      if (check?.outcome !== "pass") throw new Error(`${name} is ${check?.outcome}`)
    }
  }

  const again = receive(inbound.data.id)
  if (!again.includes("already on a claim")) throw new Error(again.trim())
  const afterReply = await db.from("inbound_messages").select("claim_id, body, urgency_noul").eq("provider_email_id", EMAIL_ID).single()
  const afterAssessments = await db.from("assessments").select("id").eq("claim_id", claimId)
  if (afterReply.error) throw afterReply.error
  if (afterAssessments.error) throw afterAssessments.error
  if (JSON.stringify(afterReply.data) !== JSON.stringify(proved.data)) throw new Error("a second run changed the reply")
  if (afterAssessments.data.length !== 2) throw new Error("a second run stored an assessment")
  const after = await snapshot(db)
  if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error("an existing claim changed")
  console.log(`${CLAIM_REFERENCE} urgent reply flagged at ${proved.data.urgency_noul}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
