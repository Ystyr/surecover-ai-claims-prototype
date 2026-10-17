// Records one approval on CLM-DEMO-1002. A second run leaves that decision in place.
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createClient } from "@supabase/supabase-js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const CLAIM_ID = "c1a10001-de10-4000-a000-000000001002"
const CLAIM_REFERENCE = "CLM-DEMO-1002"
const RATIONALE = "The missing boarding pass is now on file and the latest checks pass."
const SENTENCE = "The boarding pass for SC202 on 7 August 2026 from NRT to SIN is not on file."
const REPLY_EMAIL = "fixture-reply-1002"
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
  const anonKey = env.SUPABASE_PUBLISHABLE_KEY
  const password = env.OFFICER_PASSWORD
  if (!url || !anonKey || !password) {
    throw new Error(".env must set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and OFFICER_PASSWORD")
  }
  return { url, anonKey, password }
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
  const { url, anonKey, password } = projectEnv()
  const officer = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const signedIn = await officer.auth.signInWithPassword({ email: "officer-a@example.com", password })
  if (signedIn.error) throw signedIn.error

  const before = new Map()
  for (const reference of KEPT) before.set(reference, await storedClaim(officer, reference))
  const ownBefore = await storedClaim(officer, CLAIM_REFERENCE)

  const decisions = await officer.from("claim_decisions").select("id, action, rationale").eq("claim_id", CLAIM_ID)
  if (decisions.error) throw decisions.error
  const request = decisions.data.find((decision) => decision.action === "request")
  if (!request) throw new Error(`${CLAIM_REFERENCE} has no request`)
  const requestMessage = await officer.from("claim_messages").select("id, body").eq("decision_id", request.id).single()
  if (requestMessage.error) throw requestMessage.error
  if (!requestMessage.data.body.includes(SENTENCE)) throw new Error("the request no longer names the missing flight")
  const reply = await officer.from("inbound_messages").select("id").eq("claim_id", CLAIM_ID).eq("provider_email_id", REPLY_EMAIL).maybeSingle()
  if (reply.error) throw reply.error
  if (!reply.data) throw new Error(`${CLAIM_REFERENCE} has no reply`)

  const assessments = await officer
    .from("assessments")
    .select("id, policy_checks(check_name, outcome)")
    .eq("claim_id", CLAIM_ID)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
  if (assessments.error) throw assessments.error
  const latest = assessments.data[0]
  if (!latest) throw new Error(`${CLAIM_REFERENCE} has no assessment`)
  for (const name of PASSING) {
    const check = latest.policy_checks.find((entry) => entry.check_name === name)
    if (check?.outcome !== "pass") throw new Error(`${name} is ${check?.outcome}`)
  }

  let approval = decisions.data.find((decision) => decision.action === "approve")
  if (!approval) {
    const saved = await officer.rpc("record_claim_decision", {
      p_claim_id: CLAIM_ID,
      p_action: "approve",
      p_rationale: RATIONALE,
      p_assessment_id: latest.id,
    })
    if (saved.error) throw saved.error
    approval = { id: saved.data, action: "approve", rationale: RATIONALE }
  }
  if (approval.rationale !== RATIONALE) throw new Error("the approval rationale changed")

  const afterDecisions = await officer.from("claim_decisions").select("id, action").eq("claim_id", CLAIM_ID)
  if (afterDecisions.error) throw afterDecisions.error
  const approvals = afterDecisions.data.filter((decision) => decision.action === "approve")
  if (approvals.length !== 1) throw new Error(`${CLAIM_REFERENCE} has ${approvals.length} approvals`)
  if (!afterDecisions.data.some((decision) => decision.action === "request")) throw new Error("the request decision was removed")

  const claim = await storedClaim(officer, CLAIM_REFERENCE)
  if (claim.status !== "approved") throw new Error(`${CLAIM_REFERENCE} status is ${claim.status}`)
  if (claim.files !== 7) throw new Error(`${CLAIM_REFERENCE} has ${claim.files} files`)
  if (claim.messages !== ownBefore.messages) throw new Error("the approval recorded a message")
  if (JSON.stringify(claim.mail) !== JSON.stringify(ownBefore.mail)) throw new Error("the approval changed the reply")

  const keptRequest = await officer.from("claim_messages").select("body").eq("id", requestMessage.data.id).single()
  if (keptRequest.error) throw keptRequest.error
  if (keptRequest.data.body !== requestMessage.data.body) throw new Error("the request message changed")

  for (const reference of KEPT) {
    const after = await storedClaim(officer, reference)
    const earlier = before.get(reference)
    if (
      after.id !== earlier.id ||
      after.status !== earlier.status ||
      after.files !== earlier.files ||
      after.messages !== earlier.messages ||
      JSON.stringify(after.mail) !== JSON.stringify(earlier.mail)
    ) {
      throw new Error(`${reference} changed while approving ${CLAIM_REFERENCE}`)
    }
  }

  console.log(`${CLAIM_REFERENCE} is approved and the request, reply, and earlier failure stay`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
