// Turns a stored Resend inbound row into a claim, or matches a reply. Demo claims stay.
import { spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createClient } from "@supabase/supabase-js"

import { assessClaim, quotableItems } from "../../checks/assess.mjs"
import { sendResendEmail } from "../../lib/email.ts"
import { acknowledgmentText } from "../../lib/findings.ts"
import { claimFormIdentity, claimReferenceInSubject, emailAddress, isDemoReference, liveClaimReference } from "../../lib/inbound.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KEPT = ["CLM-DEMO-1001", "CLM-DEMO-1002", "CLM-DEMO-1003", "CLM-DEMO-1004", "CLM-DEMO-1005"]
const POLICY_VERSION = "demo-2026.1"

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

function walkFiles(directory, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) walkFiles(full, found)
    else if (/\.(pdf|png|jpe?g)$/i.test(entry.name)) found.push(full)
  }
  return found
}

let fixtureHashes
function fixtureParse(bytes) {
  if (!fixtureHashes) {
    fixtureHashes = new Map()
    const samples = path.join(root, "fixtures", "samples")
    for (const file of walkFiles(samples)) {
      const parsePath = path.join(root, "fixtures", "parses", `${path.relative(samples, file)}.json`)
      if (!existsSync(parsePath)) continue
      fixtureHashes.set(createHash("sha256").update(readFileSync(file)).digest("hex"), parsePath)
    }
  }
  const parsePath = fixtureHashes.get(createHash("sha256").update(bytes).digest("hex"))
  return parsePath ? JSON.parse(readFileSync(parsePath, "utf8")) : null
}

function parseWithDocling(bytes, filename) {
  const directory = mkdtempSync(path.join(tmpdir(), "surecover-"))
  try {
    const input = path.join(directory, filename)
    const output = path.join(directory, "parse.json")
    writeFileSync(input, bytes)
    const python = path.join(root, "parser", ".venv", "Scripts", "python.exe")
    const command = existsSync(python) ? python : "python"
    const result = spawnSync(command, [path.join(root, "parser", "convert_document.py"), "--input", input, "--output", output], {
      cwd: root,
      encoding: "utf8",
      timeout: 300000,
    })
    if (result.status !== 0) throw new Error(result.stderr?.trim() || "parser failed")
    return JSON.parse(readFileSync(output, "utf8"))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

async function demoSnapshot(db) {
  const snapshot = new Map()
  for (const reference of KEPT) {
    const claim = await db.from("claims").select("id, status").eq("reference", reference).maybeSingle()
    if (claim.error) throw claim.error
    if (!claim.data) throw new Error(`${reference} is not stored`)
    const documents = await db.from("claim_documents").select("id").eq("claim_id", claim.data.id)
    if (documents.error) throw documents.error
    const messages = await db.from("claim_messages").select("id").eq("claim_id", claim.data.id)
    if (messages.error) throw messages.error
    const mail = await db.from("inbound_messages").select("provider_email_id").eq("claim_id", claim.data.id)
    if (mail.error) throw mail.error
    snapshot.set(reference, {
      id: claim.data.id,
      status: claim.data.status,
      files: documents.data.length,
      messages: messages.data.length,
      mail: mail.data.map((row) => row.provider_email_id).sort().join(","),
    })
  }
  return snapshot
}

function sameSnapshot(before, after) {
  for (const reference of KEPT) {
    const earlier = before.get(reference)
    const current = after.get(reference)
    if (
      !current ||
      current.id !== earlier.id ||
      current.status !== earlier.status ||
      current.files !== earlier.files ||
      current.messages !== earlier.messages ||
      current.mail !== earlier.mail
    ) {
      return false
    }
  }
  return true
}

async function storedFiles(db, emailId) {
  const listed = await db.storage.from("claim-files").list(`inbound/${emailId}`, { limit: 100 })
  if (listed.error) throw listed.error
  const files = []
  for (const entry of listed.data ?? []) {
    if (!entry.name || entry.name.endsWith("/")) continue
    const storagePath = `inbound/${emailId}/${entry.name}`
    const downloaded = await db.storage.from("claim-files").download(storagePath)
    if (downloaded.error) throw downloaded.error
    const bytes = Buffer.from(await downloaded.data.arrayBuffer())
    const parsed = fixtureParse(bytes) ?? parseWithDocling(bytes, entry.name)
    files.push({
      filename: entry.name,
      bytes,
      parse: parsed,
      mediaType: parsed.media_type || entry.metadata?.mimetype || "application/pdf",
    })
  }
  return files
}

async function storeFile(db, claimId, file) {
  const existing = await db
    .from("claim_documents")
    .select("id")
    .eq("claim_id", claimId)
    .eq("source_file", file.filename)
    .maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data) return false
  const storagePath = `${claimId}/${file.filename}`
  const uploaded = await db.storage.from("claim-files").upload(storagePath, new Uint8Array(file.bytes), {
    contentType: file.mediaType,
    upsert: false,
  })
  if (uploaded.error && !String(uploaded.error.message).includes("already exists")) throw uploaded.error
  const document = await db
    .from("claim_documents")
    .insert({
      claim_id: claimId,
      source_file: file.filename,
      media_type: file.mediaType,
      storage_path: storagePath,
      text_source: file.parse.text_source,
      parser: file.parse.parser,
      parser_version: file.parse.parser_version,
    })
    .select("id")
    .single()
  if (document.error) throw document.error
  const pages = await db.from("document_pages").insert(
    (file.parse.pages ?? []).map((page) => ({
      document_id: document.data.id,
      page_number: page.page_number,
      text: page.text,
      text_source: page.text_source,
    })),
  )
  if (pages.error) throw pages.error
  const items = file.parse.items ?? []
  if (items.length > 0) {
    const stored = await db.from("document_items").insert(
      items.map((item, itemIndex) => ({
        document_id: document.data.id,
        page_number: item.page_number,
        item_index: itemIndex,
        text: item.text,
        label: item.label || "text_line",
        bbox: item.bbox,
        confidence: item.confidence ?? null,
        review: item.review ?? null,
      })),
    )
    if (stored.error) throw stored.error
  }
  return true
}

async function storeAssessment(db, claimId, receivedAt) {
  const policy = await db
    .from("policies")
    .select("coverage_start, coverage_end, public_holidays")
    .eq("version", POLICY_VERSION)
    .single()
  if (policy.error) throw policy.error
  const documents = await db.from("claim_documents").select("id, source_file").eq("claim_id", claimId)
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
  const quoted = quotableItems(items.data ?? [], pages.data ?? [])
  const byDocument = new Map(documents.data.map((document) => [document.id, { sourceFile: document.source_file, items: [] }]))
  for (const item of quoted) byDocument.get(item.document_id).items.push({ text: item.text, pageNumber: item.page_number })
  const assessment = assessClaim({
    receivedAt,
    policy: policy.data,
    documents: [...byDocument.values()],
  })
  const saved = await db.from("assessments").insert({ claim_id: claimId, adapter: assessment.adapter }).select("id").single()
  if (saved.error) throw saved.error
  const checks = await db.from("policy_checks").insert(
    assessment.checks.map((entry) => ({
      assessment_id: saved.data.id,
      claim_id: claimId,
      check_name: entry.check_name,
      outcome: entry.outcome,
      detail: entry.detail,
    })),
  )
  if (checks.error) throw checks.error
  const documentId = new Map(documents.data.map((document) => [document.source_file, document.id]))
  if (assessment.facts.length > 0) {
    const facts = await db.from("extracted_facts").upsert(
      assessment.facts.map((fact) => ({
        claim_id: claimId,
        fact_key: fact.factKey,
        source_file: fact.sourceFile,
        document_id: documentId.get(fact.sourceFile) ?? null,
        page_number: fact.pageNumber,
        quote_text: fact.quoteText,
        field: fact.field,
        leg_index: fact.legIndex,
        original_value: fact.originalValue,
      })),
      { onConflict: "claim_id,fact_key", ignoreDuplicates: true },
    )
    if (facts.error) throw facts.error
  }
  return assessment
}

async function acknowledge(db, claim, env) {
  const existing = await db.from("claim_messages").select("id").eq("claim_id", claim.id)
  if (existing.error) throw existing.error
  if (existing.data.length > 0) return "recorded"
  const officer = await db.from("officers").select("id").eq("email", "officer-a@example.com").single()
  if (officer.error) throw officer.error
  const notice = acknowledgmentText({ reference: claim.reference, claimantName: claim.claimantName })
  let provider = "simulated"
  let status = "recorded"
  let providerMessageId = `simulated-${randomUUID()}`
  if (env.resendKey && env.resendFrom) {
    try {
      providerMessageId = await sendResendEmail({
        apiKey: env.resendKey,
        from: env.resendFrom,
        to: claim.travelerEmail,
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
    claim_id: claim.id,
    decision_id: null,
    officer_id: officer.data.id,
    to_address: claim.travelerEmail,
    subject: notice.subject,
    body: notice.body,
    provider,
    provider_message_id: providerMessageId,
    status,
  })
  if (message.error) throw message.error
  return status
}

async function linkMail(db, inboundId, claimId) {
  const linked = await db.from("inbound_messages").update({ claim_id: claimId }).eq("id", inboundId).is("claim_id", null).select("id")
  if (linked.error) throw linked.error
  if (!linked.data?.length) throw new Error("inbound mail was already linked")
}

async function processInbound(db, inboundId, env) {
  const row = await db
    .from("inbound_messages")
    .select("id, provider, provider_email_id, from_address, subject, claim_id, created_at")
    .eq("id", inboundId)
    .maybeSingle()
  if (row.error) throw row.error
  if (!row.data) throw new Error("inbound mail is not stored")
  if (row.data.claim_id) return `${row.data.provider_email_id} is already on a claim`
  if (row.data.provider !== "resend") return `${row.data.provider_email_id} stays simulated`

  const named = claimReferenceInSubject(row.data.subject)
  if (named && isDemoReference(named)) return `${named} stays unchanged`
  if (named) {
    const claim = await db.from("claims").select("id, reference, status, received_at").eq("reference", named).maybeSingle()
    if (claim.error) throw claim.error
    if (!claim.data) return `${named} is not stored`
    if (!named.startsWith("CLM-LIVE-")) return `${named} stays unchanged`
    if (claim.data.status !== "information requested") return `${named} is ${claim.data.status}`
    const files = await storedFiles(db, row.data.provider_email_id)
    if (files.length === 0) throw new Error(`${row.data.provider_email_id} has no stored files`)
    for (const file of files) await storeFile(db, claim.data.id, file)
    await storeAssessment(db, claim.data.id, claim.data.received_at)
    const updated = await db.from("claims").update({ status: "needs review" }).eq("id", claim.data.id).eq("status", "information requested")
    if (updated.error) throw updated.error
    await linkMail(db, row.data.id, claim.data.id)
    return `reply stored on ${named}`
  }

  const files = await storedFiles(db, row.data.provider_email_id)
  if (files.length === 0) throw new Error(`${row.data.provider_email_id} has no stored files`)
  const form = files.find((file) => file.filename.toLowerCase() === "claim-form.pdf")
  const identity = form ? claimFormIdentity(form.parse.items ?? []) : null
  if (!identity) throw new Error(`${row.data.provider_email_id} claim form is not on file`)
  const travelerEmail = emailAddress(row.data.from_address)
  if (!travelerEmail) throw new Error(`${row.data.provider_email_id} sender address is missing`)
  const reference = liveClaimReference(row.data.provider_email_id)
  if (!reference) throw new Error(`${row.data.provider_email_id} is too short to name a claim`)
  const officer = await db.from("officers").select("id").eq("email", "officer-a@example.com").single()
  if (officer.error) throw officer.error

  const inserted = await db.from("claims").insert({
    id: row.data.id,
    reference,
    status: "needs review",
    policy_version: POLICY_VERSION,
    claimant_name: identity.claimantName,
    policy_reference: identity.policyReference,
    traveler_email: travelerEmail,
    return_date: identity.returnDate,
    received_at: row.data.created_at,
    assigned_officer_id: officer.data.id,
  })
  if (inserted.error && inserted.error.code !== "23505") throw inserted.error
  const claim = await db.from("claims").select("id, reference").eq("id", row.data.id).maybeSingle()
  if (claim.error) throw claim.error
  if (!claim.data || claim.data.reference !== reference) throw new Error(`${reference} was not stored`)

  for (const file of files) await storeFile(db, claim.data.id, file)
  const assessments = await db.from("assessments").select("id").eq("claim_id", claim.data.id)
  if (assessments.error) throw assessments.error
  if (assessments.data.length === 0) await storeAssessment(db, claim.data.id, row.data.created_at)
  const status = await acknowledge(
    db,
    { id: claim.data.id, reference, claimantName: identity.claimantName, travelerEmail },
    env,
  )
  await linkMail(db, row.data.id, claim.data.id)
  return `${reference} stored from ${row.data.provider_email_id} (${status})`
}

async function receiveOne(db, inboundId, env) {
  if (!UUID.test(inboundId)) throw new Error("inbound id is not a uuid")
  const before = await demoSnapshot(db)
  let failure = null
  let outcome = ""
  try {
    outcome = await processInbound(db, inboundId, env)
  } catch (error) {
    failure = error
  }
  const after = await demoSnapshot(db)
  if (!sameSnapshot(before, after)) throw new Error("a demo claim changed")
  if (failure) throw failure
  console.log(outcome)
}

async function main() {
  const env = projectEnv()
  const db = createClient(env.url, env.serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })
  const only = process.argv[2]
  const ids = []
  if (only) ids.push(only)
  else {
    const pending = await db.from("inbound_messages").select("id").is("claim_id", null).eq("provider", "resend")
    if (pending.error) throw pending.error
    ids.push(...pending.data.map((row) => row.id))
  }
  if (ids.length === 0) {
    console.log("no unmatched Resend mail")
    return
  }
  let failed = false
  for (const id of ids) {
    try {
      await receiveOne(db, id, env)
    } catch (error) {
      failed = true
      console.error(error.message || error)
    }
  }
  if (failed) process.exitCode = 1
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
