// Proves one unmatched question gets a stored document list. Existing claims stay.
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createClient } from "@supabase/supabase-js"

import { NOUL_SUPPORT } from "../../checks/assess.mjs"
import { documentsToSendText } from "../../lib/findings.ts"
import { liveClaimReference } from "../../lib/inbound.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const INBOUND_ID = "c1a10001-de10-4000-a000-000000001026"
const EMAIL_ID = "documents-question"
const QUESTION = "What documents should I send?"
const FROM = "Jamie Lee <jamie.lee@example.com>"
const SUBJECT = "What should I send"
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
  if (!url || !serviceRole) throw new Error(".env must set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
  return { url, serviceRole }
}

async function snapshot(db) {
  const claims = await db.from("claims").select("id, reference, status").in("reference", KEPT)
  if (claims.error) throw claims.error
  if (claims.data.length !== KEPT.length) throw new Error("a kept claim is missing")
  const rows = []
  for (const claim of claims.data) {
    const documents = await db.from("claim_documents").select("id").eq("claim_id", claim.id)
    const messages = await db.from("claim_messages").select("id").eq("claim_id", claim.id)
    const inbound = await db.from("inbound_messages").select("id, body, unavailable_noul").eq("claim_id", claim.id)
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
    .select("id, body, claim_id, unavailable_noul, documents_noul, documents_reply_subject")
    .eq("subject", "Test")
    .is("claim_id", null)
    .maybeSingle()
  if (testMail.error) throw testMail.error
  if (!testMail.data) throw new Error("the Test message is missing")
  const count = await db.from("claims").select("id")
  if (count.error) throw count.error
  return { claims: rows.sort((a, b) => a.reference.localeCompare(b.reference)), testMail: testMail.data, claimCount: count.data.length }
}

function receive(inboundId) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "supabase/seed/receive-mail.mjs", inboundId], {
    cwd: root,
    encoding: "utf8",
  })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "receive failed")
  return `${result.stdout}${result.stderr}`
}

async function storedQuestion(db) {
  const row = await db
    .from("inbound_messages")
    .select("id, claim_id, body, documents_noul, documents_reply_subject, documents_reply_body, documents_reply_provider, documents_reply_status")
    .eq("provider_email_id", EMAIL_ID)
    .maybeSingle()
  if (row.error) throw row.error
  return row.data
}

async function main() {
  const forbidden = liveClaimReference(EMAIL_ID)
  const { url, serviceRole } = projectEnv()
  const db = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })
  const before = await snapshot(db)
  const existing = await storedQuestion(db)
  if (!existing) {
    const inserted = await db.from("inbound_messages").insert({
      id: INBOUND_ID,
      provider: "resend",
      provider_email_id: EMAIL_ID,
      from_address: FROM,
      subject: SUBJECT,
      body: QUESTION,
    })
    if (inserted.error) throw inserted.error
  }
  const inbound = await storedQuestion(db)
  if (!inbound) throw new Error("the question was not stored")
  if (!inbound.documents_reply_subject) {
    const first = receive(inbound.id)
    if (!first.includes(`documents listed for ${EMAIL_ID}`)) throw new Error(first.trim())
  }
  const proved = await storedQuestion(db)
  const notice = documentsToSendText({ claimantName: "Jamie Lee" })
  if (proved.claim_id) throw new Error("the question became a claim")
  if (proved.body !== QUESTION) throw new Error("the question body changed")
  if (typeof proved.documents_noul !== "number" || proved.documents_noul < NOUL_SUPPORT) {
    throw new Error("the question was not judged as a request for the document list")
  }
  if (proved.documents_reply_subject !== notice.subject || proved.documents_reply_body !== notice.body) {
    throw new Error("the document list was not stored")
  }
  if (!proved.documents_reply_provider || !proved.documents_reply_status) throw new Error("the document list was not recorded")
  const claim = await db.from("claims").select("id").eq("reference", forbidden).maybeSingle()
  if (claim.error) throw claim.error
  if (claim.data) throw new Error(`${forbidden} was created`)

  const again = receive(inbound.id)
  if (!again.includes("already lists the documents")) throw new Error(again.trim())
  const afterQuestion = await storedQuestion(db)
  if (JSON.stringify(afterQuestion) !== JSON.stringify(proved)) throw new Error("a second run changed the question")
  const after = await snapshot(db)
  if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error("an existing claim changed")
  console.log(`${EMAIL_ID} documents listed at ${proved.documents_noul}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
