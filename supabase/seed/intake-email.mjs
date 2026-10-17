// Stores the fixture inbound email as CLM-DEMO-1005. The other claims stay.
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createClient } from "@supabase/supabase-js"

import { assessClaim, quotableItems } from "../../checks/assess.mjs"
import { sendResendEmail } from "../../lib/email.ts"
import { acknowledgmentText } from "../../lib/findings.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const CLAIM_ID = "c1a10001-de10-4000-a000-000000001005"
const CLAIM_REFERENCE = "CLM-DEMO-1005"
const EMAIL_ID = "fixture-email-1005"
const KEPT = ["CLM-DEMO-1001", "CLM-DEMO-1002", "CLM-DEMO-1003", "CLM-DEMO-1004"]
const PASSING = ["completeness", "filing_deadline", "coverage", "claim_type", "consistency", "delay"]

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
  if (!url || !serviceRole) throw new Error(".env must set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
  return { url, serviceRole, resendKey: env.RESEND_API_KEY, resendFrom: env.RESEND_FROM }
}

function readParse(file) {
  return JSON.parse(readFileSync(path.join(root, "fixtures/parses/complete", `${file}.json`), "utf8"))
}

async function storedClaim(db, reference) {
  const claim = await db.from("claims").select("id, status").eq("reference", reference).maybeSingle()
  if (claim.error) throw claim.error
  if (!claim.data) return null
  const documents = await db.from("claim_documents").select("id").eq("claim_id", claim.data.id)
  if (documents.error) throw documents.error
  return { id: claim.data.id, status: claim.data.status, files: documents.data.length }
}

async function clearStorage(db) {
  const listed = await db.storage.from("claim-files").list(CLAIM_ID)
  if (listed.error) throw listed.error
  if (listed.data.length === 0) return
  const paths = listed.data.map((file) => `${CLAIM_ID}/${file.name}`)
  const deleted = await db.storage.from("claim-files").remove(paths)
  if (deleted.error) throw deleted.error
}

async function main() {
  const { url, serviceRole, resendKey, resendFrom } = projectEnv()
  const expected = JSON.parse(readFileSync(path.join(root, "fixtures/expected/complete-claim.json"), "utf8"))
  const claim = expected.claim
  const db = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })

  const before = new Map()
  for (const reference of KEPT) {
    const stored = await storedClaim(db, reference)
    if (!stored) throw new Error(`${reference} is not stored`)
    before.set(reference, stored)
  }
  const officer = await db.from("officers").select("id").eq("email", "officer-a@example.com").single()
  if (officer.error) throw officer.error

  const removedMail = await db.from("inbound_messages").delete().eq("provider_email_id", EMAIL_ID)
  if (removedMail.error) throw removedMail.error
  const removedMessages = await db.from("claim_messages").delete().eq("claim_id", CLAIM_ID)
  if (removedMessages.error) throw removedMessages.error
  const removed = await db.from("claims").delete().eq("reference", CLAIM_REFERENCE)
  if (removed.error) throw removed.error
  await clearStorage(db)

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
    assigned_officer_id: officer.data.id,
  })
  if (inserted.error) throw inserted.error

  for (const sample of expected.sample_documents) {
    const parse = readParse(sample.file)
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

    if (parse.items.length > 0) {
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
  }

  const policy = await db
    .from("policies")
    .select("coverage_start, coverage_end, public_holidays")
    .eq("version", expected.policy_version)
    .single()
  if (policy.error) throw policy.error
  const documents = await db.from("claim_documents").select("id, source_file").eq("claim_id", CLAIM_ID)
  if (documents.error) throw documents.error
  if (documents.data.length !== 7) throw new Error(`expected 7 files, found ${documents.data.length}`)
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
  for (const name of PASSING) {
    const entry = assessment.checks.find((check) => check.check_name === name)
    if (entry?.outcome !== "pass") throw new Error(`${name} is ${entry?.outcome}`)
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

  const notice = acknowledgmentText({ reference: CLAIM_REFERENCE, claimantName: claim.claimant_name })
  let provider = "simulated"
  let status = "recorded"
  let providerMessageId = `simulated-${randomUUID()}`
  if (resendKey && resendFrom) {
    try {
      providerMessageId = await sendResendEmail({
        apiKey: resendKey,
        from: resendFrom,
        to: claim.traveler_email,
        subject: notice.subject,
        text: notice.body,
      })
      provider = "resend"
      status = "sent"
    } catch {
      provider = "simulated"
      status = "recorded"
      providerMessageId = `simulated-${randomUUID()}`
    }
  }
  const message = await db.from("claim_messages").insert({
    claim_id: CLAIM_ID,
    decision_id: null,
    officer_id: officer.data.id,
    to_address: claim.traveler_email,
    subject: notice.subject,
    body: notice.body,
    provider,
    provider_message_id: providerMessageId,
    status,
  })
  if (message.error) throw message.error

  const inbound = await db.from("inbound_messages").insert({
    provider: "simulated",
    provider_email_id: EMAIL_ID,
    from_address: claim.traveler_email,
    subject: notice.subject,
    claim_id: CLAIM_ID,
  })
  if (inbound.error) throw inbound.error

  for (const reference of KEPT) {
    const after = await storedClaim(db, reference)
    const earlier = before.get(reference)
    if (!after || after.id !== earlier.id || after.status !== earlier.status || after.files !== earlier.files) {
      throw new Error(`${reference} changed while storing ${CLAIM_REFERENCE}`)
    }
  }

  console.log(`stored ${CLAIM_REFERENCE} from ${EMAIL_ID}`)
  console.log(`${notice.subject} (${provider}, ${status})`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
