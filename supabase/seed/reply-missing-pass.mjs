// Stores the traveler's reply on CLM-DEMO-1002. The request and the other claims stay.
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createClient } from "@supabase/supabase-js"

import { assessClaim, quotableItems } from "../../checks/assess.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const CLAIM_ID = "c1a10001-de10-4000-a000-000000001002"
const CLAIM_REFERENCE = "CLM-DEMO-1002"
const EMAIL_ID = "fixture-reply-1002"
const SUBJECT = "Re: Information requested for CLM-DEMO-1002"
const FROM = "jamie.lee@example.com"
const FILE = "boarding-pass-sc202.pdf"
const SENTENCE = "The boarding pass for SC202 on 7 August 2026 from NRT to SIN is not on file."
const KEPT = ["CLM-DEMO-1001", "CLM-DEMO-1003", "CLM-DEMO-1004", "CLM-DEMO-1005"]
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
  return { url, serviceRole }
}

function readParse(file) {
  return JSON.parse(readFileSync(path.join(root, "fixtures/parses/complete", `${file}.json`), "utf8"))
}

async function storedClaim(db, reference) {
  const claim = await db.from("claims").select("id, status").eq("reference", reference).single()
  if (claim.error) throw claim.error
  const documents = await db.from("claim_documents").select("id").eq("claim_id", claim.data.id)
  if (documents.error) throw documents.error
  const mail = await db.from("inbound_messages").select("provider_email_id").eq("claim_id", claim.data.id)
  if (mail.error) throw mail.error
  const messages = await db.from("claim_messages").select("id").eq("claim_id", claim.data.id)
  if (messages.error) throw messages.error
  return {
    id: claim.data.id,
    status: claim.data.status,
    files: documents.data.length,
    mail: mail.data.map((row) => row.provider_email_id).sort(),
    messages: messages.data.length,
  }
}

async function main() {
  const { url, serviceRole } = projectEnv()
  const expected = JSON.parse(readFileSync(path.join(root, "fixtures/expected/complete-claim.json"), "utf8"))
  const db = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })

  const before = new Map()
  for (const reference of KEPT) before.set(reference, await storedClaim(db, reference))

  const claim = await db.from("claims").select("id, received_at, policy_version, status").eq("id", CLAIM_ID).single()
  if (claim.error) throw claim.error
  const request = await db.from("claim_decisions").select("id, action").eq("claim_id", CLAIM_ID).eq("action", "request").maybeSingle()
  if (request.error) throw request.error
  if (!request.data) throw new Error(`${CLAIM_REFERENCE} has no request`)
  const requestMessage = await db.from("claim_messages").select("id, body").eq("decision_id", request.data.id).single()
  if (requestMessage.error) throw requestMessage.error
  if (!requestMessage.data.body.includes(SENTENCE)) throw new Error("the request no longer names the missing flight")

  const documents = await db.from("claim_documents").select("id, source_file").eq("claim_id", CLAIM_ID)
  if (documents.error) throw documents.error
  if (!documents.data.some((document) => document.source_file === FILE)) {
    const parse = readParse(FILE)
    const bytes = readFileSync(path.join(root, "fixtures/samples/complete", FILE))
    const storagePath = `${CLAIM_ID}/${FILE}`
    const uploaded = await db.storage.from("claim-files").upload(storagePath, new Uint8Array(bytes), {
      contentType: parse.media_type,
      upsert: false,
    })
    if (uploaded.error) throw uploaded.error
    const document = await db
      .from("claim_documents")
      .insert({
        claim_id: CLAIM_ID,
        source_file: FILE,
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

  const storedDocuments = await db.from("claim_documents").select("id, source_file").eq("claim_id", CLAIM_ID)
  if (storedDocuments.error) throw storedDocuments.error
  if (storedDocuments.data.length !== 7) throw new Error(`${CLAIM_REFERENCE} has ${storedDocuments.data.length} files`)
  const documentIds = storedDocuments.data.map((document) => document.id)
  const pages = await db.from("quotable_pages").select("document_id, page_number").in("document_id", documentIds)
  if (pages.error) throw pages.error
  const items = await db
    .from("document_items")
    .select("document_id, page_number, item_index, text")
    .in("document_id", documentIds)
    .order("item_index")
  if (items.error) throw items.error
  const policy = await db
    .from("policies")
    .select("coverage_start, coverage_end, public_holidays")
    .eq("version", claim.data.policy_version)
    .single()
  if (policy.error) throw policy.error

  const quoted = quotableItems(items.data, pages.data)
  const byDocument = new Map(storedDocuments.data.map((document) => [document.id, { sourceFile: document.source_file, items: [] }]))
  for (const item of quoted) byDocument.get(item.document_id).items.push({ text: item.text, pageNumber: item.page_number })
  const assessment = assessClaim({
    receivedAt: claim.data.received_at,
    policy: policy.data,
    documents: [...byDocument.values()],
  })
  for (const name of PASSING) {
    const entry = assessment.checks.find((check) => check.check_name === name)
    if (entry?.outcome !== "pass") throw new Error(`${name} is ${entry?.outcome}`)
  }

  const latest = await db
    .from("assessments")
    .select("id, policy_checks(check_name, outcome)")
    .eq("claim_id", CLAIM_ID)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .single()
  if (latest.error) throw latest.error
  const latestCompleteness = latest.data.policy_checks.find((check) => check.check_name === "completeness")
  if (latestCompleteness?.outcome !== "pass") {
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

  const status = await db.from("claims").update({ status: "needs review" }).eq("id", CLAIM_ID)
  if (status.error) throw status.error

  const existingMail = await db.from("inbound_messages").select("id, claim_id, subject, from_address").eq("provider_email_id", EMAIL_ID).maybeSingle()
  if (existingMail.error) throw existingMail.error
  if (!existingMail.data) {
    const inserted = await db.from("inbound_messages").insert({
      provider: "simulated",
      provider_email_id: EMAIL_ID,
      from_address: FROM,
      subject: SUBJECT,
      claim_id: CLAIM_ID,
    })
    if (inserted.error) throw inserted.error
  } else if (
    existingMail.data.claim_id !== CLAIM_ID ||
    existingMail.data.subject !== SUBJECT ||
    existingMail.data.from_address !== FROM
  ) {
    throw new Error("the stored reply does not match this claim")
  }

  const keptRequest = await db.from("claim_messages").select("body").eq("id", requestMessage.data.id).single()
  if (keptRequest.error) throw keptRequest.error
  if (keptRequest.data.body !== requestMessage.data.body) throw new Error("the request message changed")

  for (const reference of KEPT) {
    const after = await storedClaim(db, reference)
    const earlier = before.get(reference)
    if (
      after.id !== earlier.id ||
      after.status !== earlier.status ||
      after.files !== earlier.files ||
      after.messages !== earlier.messages ||
      JSON.stringify(after.mail) !== JSON.stringify(earlier.mail)
    ) {
      throw new Error(`${reference} changed while storing the reply on ${CLAIM_REFERENCE}`)
    }
  }

  console.log(`${CLAIM_REFERENCE} reply stores the 7 August pass and returns the claim to needs review`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
