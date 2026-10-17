// Records one information request on CLM-DEMO-1002. A second run leaves that request in place.
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createClient } from "@supabase/supabase-js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const CLAIM_ID = "c1a10001-de10-4000-a000-000000001002"
const CLAIM_REFERENCE = "CLM-DEMO-1002"
const RATIONALE = "Please send the missing boarding pass."
const SENTENCE = "The boarding pass for SC202 on 7 August 2026 from NRT to SIN is not on file."
const KEPT = ["CLM-DEMO-1001", "CLM-DEMO-1003", "CLM-DEMO-1004"]

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
  return { id: claim.data.id, status: claim.data.status, files: documents.data.length }
}

async function main() {
  const { url, anonKey, password } = projectEnv()
  const officer = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const signedIn = await officer.auth.signInWithPassword({ email: "officer-a@example.com", password })
  if (signedIn.error) throw signedIn.error

  const before = new Map()
  for (const reference of KEPT) before.set(reference, await storedClaim(officer, reference))

  const decisions = await officer.from("claim_decisions").select("id, action").eq("claim_id", CLAIM_ID)
  if (decisions.error) throw decisions.error
  let request = decisions.data.find((decision) => decision.action === "request")
  if (!request) {
    const assessments = await officer
      .from("assessments")
      .select("id")
      .eq("claim_id", CLAIM_ID)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
    if (assessments.error) throw assessments.error
    if (!assessments.data[0]) throw new Error(`${CLAIM_REFERENCE} has no assessment`)
    const saved = await officer.rpc("record_claim_decision", {
      p_claim_id: CLAIM_ID,
      p_action: "request",
      p_rationale: RATIONALE,
      p_assessment_id: assessments.data[0].id,
    })
    if (saved.error) throw saved.error
    request = { id: saved.data, action: "request" }
  }

  const existing = await officer.from("claim_messages").select("id, body").eq("decision_id", request.id).maybeSingle()
  if (existing.error) throw existing.error
  if (!existing.data) {
    const saved = await officer.rpc("record_request_message", { p_decision_id: request.id })
    if (saved.error) throw saved.error
  }

  const message = await officer.from("claim_messages").select("body, provider, status").eq("decision_id", request.id).single()
  if (message.error) throw message.error
  if (!message.data.body.includes(SENTENCE)) throw new Error("the request does not name the missing boarding pass")
  if (message.data.provider !== "simulated" || message.data.status !== "recorded") {
    throw new Error(`the request message is ${message.data.provider} ${message.data.status}`)
  }

  const claim = await storedClaim(officer, CLAIM_REFERENCE)
  if (claim.status !== "information requested") throw new Error(`${CLAIM_REFERENCE} status is ${claim.status}`)
  if (claim.files !== 6) throw new Error(`${CLAIM_REFERENCE} has ${claim.files} files`)

  for (const reference of KEPT) {
    const after = await storedClaim(officer, reference)
    const earlier = before.get(reference)
    if (after.id !== earlier.id || after.status !== earlier.status || after.files !== earlier.files) {
      throw new Error(`${reference} changed while requesting ${CLAIM_REFERENCE}`)
    }
  }

  console.log(`${CLAIM_REFERENCE} request names the missing 7 August pass`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
