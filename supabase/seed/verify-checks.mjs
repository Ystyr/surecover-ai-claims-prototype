import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createClient } from "@supabase/supabase-js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const CHECKS = ["completeness", "filing_deadline", "coverage", "claim_type", "consistency", "delay"]

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
  const anonKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY
  const password = env.OFFICER_PASSWORD
  if (!url || !anonKey || !password) {
    throw new Error(".env must set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and OFFICER_PASSWORD")
  }
  return { url, anonKey, password }
}

function require(condition, message) {
  if (!condition) throw new Error(message)
}

async function signIn(url, anonKey, email, password) {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const signedIn = await client.auth.signInWithPassword({ email, password })
  if (signedIn.error) throw signedIn.error
  return client
}

async function main() {
  const { url, anonKey, password } = projectEnv()
  const officerA = await signIn(url, anonKey, "officer-a@example.com", password)
  const claim = await officerA.from("claims").select("id").eq("reference", "CLM-DEMO-1001").single()
  if (claim.error) throw claim.error
  const denied = await officerA.from("assessments").insert({ claim_id: claim.data.id, adapter: "fixture" })
  require(denied.error, "officer A inserted an assessment without the correction function")

  const hidden = await officerA.schema("private").rpc("record_fact_correction", {
    p_claim_id: claim.data.id,
    p_fact_key: "delay-letter.pdf#hours",
    p_corrected_value: "9",
    p_rationale: "should not run",
    p_checks: [],
    p_baseline: [],
  })
  require(hidden.error, "the private correction function was exposed to the API")
  require(
    !/value invalid|six checks|stale correction|value unchanged|fact not found/.test(hidden.error.message),
    `the private correction function ran: ${hidden.error.message}`,
  )

  const assessments = await officerA
    .from("assessments")
    .select("id, adapter, created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
  if (assessments.error) throw assessments.error
  require(assessments.data.length >= 1, "officer A saw no assessment")
  require(assessments.data[0].adapter === "fixture", `assessment adapter is ${assessments.data[0].adapter}`)

  const hoursFact = await officerA
    .from("extracted_facts")
    .select("id")
    .eq("claim_id", claim.data.id)
    .eq("fact_key", "delay-letter.pdf#hours")
    .single()
  if (hoursFact.error) throw hoursFact.error
  const corrections = await officerA
    .from("fact_corrections")
    .select("id, corrected_value, assessment_id")
    .eq("fact_id", hoursFact.data.id)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
  if (corrections.error) throw corrections.error
  const restored = [...corrections.data].reverse().find((row) => row.corrected_value === "8")
  const failedHours = corrections.data.filter((row) => row.corrected_value === "3")
  require(restored, "the restored 8-hour correction is missing")
  require(failedHours.length >= 1, "the 3-hour correction is missing")
  require(
    failedHours.every((row) => row.assessment_id !== assessments.data[0].id),
    "a 3-hour assessment is the latest",
  )
  const latestDelay = await officerA
    .from("policy_checks")
    .select("detail")
    .eq("assessment_id", assessments.data[0].id)
    .eq("check_name", "delay")
    .single()
  if (latestDelay.error) throw latestDelay.error
  require(Number(latestDelay.data.detail?.hours) !== 3, "the latest delay is 3 hours")

  const checks = await officerA
    .from("policy_checks")
    .select("check_name, outcome, detail")
    .eq("assessment_id", restored.assessment_id)
  if (checks.error) throw checks.error
  const byName = new Map(checks.data.map((entry) => [entry.check_name, entry]))
  require(byName.size === CHECKS.length, `the restored assessment has ${byName.size} checks`)
  for (const name of CHECKS) {
    require(byName.get(name)?.outcome === "pass", `${name} is ${byName.get(name)?.outcome}`)
  }
  const filing = byName.get("filing_deadline").detail
  require(filing.working_days === 2, `working days are ${filing.working_days}`)
  require(filing.deadline === "2026-09-21", `deadline is ${filing.deadline}`)
  require(filing.return_date === "2026-08-07", `return date is ${filing.return_date}`)
  require(filing.return_quote?.source_file === "claim-form.pdf", "filing return quote is not the claim form")
  require(filing.revised_quote?.source_file === "revised-itinerary.pdf", "filing arrival quote is not the revised itinerary")
  const claimType = byName.get("claim_type").detail
  require(claimType.quote?.source_file === "claim-form.pdf", "claim type quote is not the claim form")
  require(claimType.letter_source_file === "delay-letter.pdf", "claim type letter file is not the delay letter")
  const delay = byName.get("delay").detail
  require(byName.get("delay").outcome === "pass" && delay.hours === 8, `delay is ${byName.get("delay").outcome} ${delay.hours}`)
  require(delay.quote?.source_file === "delay-letter.pdf", "delay quote is not the delay letter")

  const officerB = await signIn(url, anonKey, "officer-b@example.com", password)
  for (const table of ["assessments", "policy_checks"]) {
    const result = await officerB.from(table).select("*")
    if (result.error) throw result.error
    require(result.data.length === 0, `officer B saw ${result.data.length} ${table} rows`)
  }

  console.log("officer A can read the restored 8-hour pass, and every 3-hour assessment is still in history")
  console.log("officer A cannot insert an assessment directly")
  console.log("officer B receives no assessment and no check rows")
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
