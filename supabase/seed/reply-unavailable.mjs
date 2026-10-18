// Proves a body-only reply on a new live claim. The five demo claims stay.
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createClient } from "@supabase/supabase-js"

import { assessClaim, NOUL_SUPPORT, quotableItems } from "../../checks/assess.mjs"
import { unavailableDocumentSentence, unavailableUpdateText } from "../../lib/findings.ts"
import { liveClaimReference } from "../../lib/inbound.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const CLAIM_ID = "c1a10001-de10-4000-a000-000000001006"
const INBOUND_ID = "c1a10001-de10-4000-a000-000000001016"
const EMAIL_ID = "unavailable-reply"
const CLAIM_REFERENCE = liveClaimReference(EMAIL_ID)
const OMITTED_FILE = "boarding-pass-sc202.pdf"
const GAP = "SC202 on 7 August 2026 from NRT to SIN"
const REPLY = "I do not have the boarding pass for the return flight."
const RATIONALE = "Completeness fails because the return boarding pass is not on file."
const KEPT = ["CLM-DEMO-1001", "CLM-DEMO-1002", "CLM-DEMO-1003", "CLM-DEMO-1004", "CLM-DEMO-1005"]

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
  const rows = []
  for (const claim of claims.data) {
    const documents = await db.from("claim_documents").select("id").eq("claim_id", claim.id)
    const messages = await db.from("claim_messages").select("id").eq("claim_id", claim.id)
    const inbound = await db.from("inbound_messages").select("id").eq("claim_id", claim.id)
    if (documents.error) throw documents.error
    if (messages.error) throw messages.error
    if (inbound.error) throw inbound.error
    rows.push({
      reference: claim.reference,
      id: claim.id,
      status: claim.status,
      files: documents.data.length,
      messages: messages.data.length,
      inbound: inbound.data.length,
    })
  }
  return rows.sort((a, b) => a.reference.localeCompare(b.reference))
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

  const samples = expected.sample_documents.filter((sample) => sample.file !== OMITTED_FILE)
  if (samples.length !== 6) throw new Error(`expected 6 files, found ${samples.length}`)
  for (const sample of samples) {
    const parse = JSON.parse(readFileSync(path.join(root, "fixtures/parses/complete", `${sample.file}.json`), "utf8"))
    const bytes = readFileSync(path.join(root, "fixtures/samples/complete", sample.file))
    const storagePath = `${CLAIM_ID}/${sample.file}`
    const uploaded = await db.storage.from("claim-files").upload(storagePath, new Uint8Array(bytes), {
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
        storage_path: storagePath,
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

  const policy = await db
    .from("policies")
    .select("coverage_start, coverage_end, public_holidays")
    .eq("version", expected.policy_version)
    .single()
  if (policy.error) throw policy.error
  const documents = await db.from("claim_documents").select("id, source_file").eq("claim_id", CLAIM_ID)
  if (documents.error) throw documents.error
  const documentIds = documents.data.map((document) => document.id)
  const pages = await db.from("quotable_pages").select("document_id, page_number").in("document_id", documentIds)
  if (pages.error) throw pages.error
  const items = await db
    .from("document_items")
    .select("document_id, page_number, item_index, text")
    .in("document_id", documentIds)
    .order("item_index")
  if (items.error) throw items.error
  const quoted = quotableItems(items.data, pages.data)
  const byDocument = new Map(documents.data.map((document) => [document.id, { sourceFile: document.source_file, items: [] }]))
  for (const item of quoted) byDocument.get(item.document_id).items.push({ text: item.text, pageNumber: item.page_number })
  const assessment = assessClaim({
    receivedAt: claim.received_at,
    policy: policy.data,
    documents: [...byDocument.values()],
  })
  const completeness = assessment.checks.find((entry) => entry.check_name === "completeness")
  if (completeness?.outcome !== "fail" || JSON.stringify(completeness.detail.gaps) !== JSON.stringify([GAP])) {
    throw new Error(`completeness is ${completeness?.outcome}`)
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
  return saved.data.id
}

async function ensureRequest(officer, claimId) {
  const decisions = await officer.from("claim_decisions").select("id, action").eq("claim_id", claimId)
  if (decisions.error) throw decisions.error
  let request = decisions.data.find((decision) => decision.action === "request")
  if (!request) {
    const assessments = await officer
      .from("assessments")
      .select("id")
      .eq("claim_id", claimId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
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

async function state(db, claimId) {
  const claim = await db.from("claims").select("status").eq("id", claimId).single()
  const assessments = await db.from("assessments").select("id").eq("claim_id", claimId).order("created_at", { ascending: false }).order("id", { ascending: false })
  const messages = await db.from("claim_messages").select("id, subject, decision_id").eq("claim_id", claimId).order("created_at")
  const inbound = await db.from("inbound_messages").select("id, claim_id, body, unavailable_noul").eq("provider_email_id", EMAIL_ID).maybeSingle()
  const documents = await db.from("claim_documents").select("id").eq("claim_id", claimId)
  if (claim.error) throw claim.error
  if (assessments.error) throw assessments.error
  if (messages.error) throw messages.error
  if (inbound.error) throw inbound.error
  if (documents.error) throw documents.error
  const latest = assessments.data[0]
  const completeness = await db
    .from("policy_checks")
    .select("outcome, detail")
    .eq("assessment_id", latest.id)
    .eq("check_name", "completeness")
    .single()
  if (completeness.error) throw completeness.error
  return {
    status: claim.data.status,
    assessments: assessments.data.map((row) => row.id),
    messages: messages.data,
    inbound: inbound.data,
    files: documents.data.length,
    completeness: completeness.data,
  }
}

async function main() {
  if (CLAIM_REFERENCE !== "CLM-LIVE-UNAVAILABLER") throw new Error(`reference is ${CLAIM_REFERENCE}`)
  const { url, serviceRole, anonKey, password } = projectEnv()
  const db = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })
  const officer = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const signedIn = await officer.auth.signInWithPassword({ email: "officer-a@example.com", password })
  if (signedIn.error) throw signedIn.error

  const before = await snapshot(db)
  if (before.length !== KEPT.length) throw new Error("a demo claim is missing")
  const expected = JSON.parse(readFileSync(path.join(root, "fixtures/expected/complete-claim.json"), "utf8"))
  const officerRow = await db.from("officers").select("id").eq("email", "officer-a@example.com").single()
  if (officerRow.error) throw officerRow.error

  const existing = await db.from("claims").select("id").eq("reference", CLAIM_REFERENCE).maybeSingle()
  if (existing.error) throw existing.error
  const claimId = existing.data?.id ?? CLAIM_ID
  if (!existing.data) await createClaim(db, expected, officerRow.data.id)

  const assessments = await db.from("assessments").select("id").eq("claim_id", claimId)
  if (assessments.error) throw assessments.error
  if (assessments.data.length !== 1) throw new Error(`${CLAIM_REFERENCE} has ${assessments.data.length} assessments`)
  await ensureRequest(officer, claimId)

  const stored = await db.from("inbound_messages").select("id, claim_id").eq("provider_email_id", EMAIL_ID).maybeSingle()
  if (stored.error) throw stored.error
  if (!stored.data) {
    const inserted = await db.from("inbound_messages").insert({
      id: INBOUND_ID,
      provider: "resend",
      provider_email_id: EMAIL_ID,
      from_address: expected.claim.traveler_email,
      subject: `Re: Information requested for ${CLAIM_REFERENCE}`,
      body: REPLY,
    })
    if (inserted.error) throw inserted.error
  }

  const inbound = await db.from("inbound_messages").select("id, claim_id").eq("provider_email_id", EMAIL_ID).single()
  if (inbound.error) throw inbound.error
  if (!inbound.data.claim_id) {
    const first = receive(inbound.data.id)
    if (!first.includes(`unavailable reply stored on ${CLAIM_REFERENCE}`)) throw new Error(first.trim())
  }
  const proved = await state(db, claimId)
  const notice = unavailableUpdateText({ reference: CLAIM_REFERENCE, claimantName: expected.claim.claimant_name, gaps: [GAP] })
  if (proved.status !== "needs review") throw new Error(`${CLAIM_REFERENCE} is ${proved.status}`)
  if (proved.assessments.length !== 1) throw new Error("a new assessment was stored")
  if (proved.files !== 6) throw new Error(`${CLAIM_REFERENCE} has ${proved.files} files`)
  if (proved.completeness.outcome !== "fail" || JSON.stringify(proved.completeness.detail.gaps) !== JSON.stringify([GAP])) {
    throw new Error("completeness is no longer the missing pass")
  }
  if (proved.inbound?.body !== REPLY) throw new Error("the reply body was not stored")
  if (typeof proved.inbound.unavailable_noul !== "number" || proved.inbound.unavailable_noul < NOUL_SUPPORT) {
    throw new Error("the reply was not judged as an unavailable document")
  }
  const updates = proved.messages.filter((message) => message.subject === notice.subject)
  if (updates.length !== 1 || updates[0].decision_id !== null) throw new Error("the update message was not stored once")
  const update = await db.from("claim_messages").select("body").eq("id", updates[0].id).single()
  if (update.error) throw update.error
  if (!update.data.body.includes(unavailableDocumentSentence(GAP))) throw new Error("the update sentence is missing")

  const again = receive(inbound.data.id)
  if (!again.includes("already on a claim")) throw new Error(again.trim())
  const after = await state(db, claimId)
  if (JSON.stringify(after) !== JSON.stringify(proved)) throw new Error("a second run changed the claim")
  const demos = await snapshot(db)
  if (JSON.stringify(demos) !== JSON.stringify(before)) throw new Error("a demo claim changed")
  console.log(`${CLAIM_REFERENCE} unavailable reply stored at ${proved.inbound.unavailable_noul}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
