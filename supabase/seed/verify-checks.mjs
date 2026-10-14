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
  const assessments = await officerA.from("assessments").select("id, adapter, created_at").order("created_at", { ascending: false })
  if (assessments.error) throw assessments.error
  require(assessments.data.length >= 1, "officer A saw no assessment")
  require(assessments.data[0].adapter === "fixture", `assessment adapter is ${assessments.data[0].adapter}`)

  const checks = await officerA
    .from("policy_checks")
    .select("check_name, outcome, detail")
    .eq("assessment_id", assessments.data[0].id)
  if (checks.error) throw checks.error
  const byName = new Map(checks.data.map((entry) => [entry.check_name, entry]))
  require(byName.size === CHECKS.length, `officer A saw ${byName.size} checks`)
  for (const name of CHECKS) {
    require(byName.get(name)?.outcome === "pass", `${name} is ${byName.get(name)?.outcome}`)
  }
  const filing = byName.get("filing_deadline").detail
  require(filing.working_days === 2, `working days are ${filing.working_days}`)
  require(filing.deadline === "2026-09-21", `deadline is ${filing.deadline}`)
  require(filing.return_date === "2026-08-07", `return date is ${filing.return_date}`)
  const delay = byName.get("delay").detail
  require(byName.get("delay").outcome === "pass" && delay.hours === 8, `delay is ${byName.get("delay").outcome} ${delay.hours}`)

  const officerB = await signIn(url, anonKey, "officer-b@example.com", password)
  for (const table of ["assessments", "policy_checks"]) {
    const result = await officerB.from(table).select("*")
    if (result.error) throw result.error
    require(result.data.length === 0, `officer B saw ${result.data.length} ${table} rows`)
  }

  console.log("officer A can read the six passing checks for CLM-DEMO-1001")
  console.log("officer B receives no assessment and no check rows")
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
