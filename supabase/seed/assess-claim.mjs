// Writes a new assessment for CLM-DEMO-1001. Earlier assessments stay.
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createClient } from "@supabase/supabase-js"

import { assessClaim, quotableItems } from "../../checks/assess.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const CLAIM_REFERENCE = "CLM-DEMO-1001"

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

async function main() {
  const { url, serviceRole } = projectEnv()
  const db = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const claim = await db.from("claims").select("id, received_at, policy_version").eq("reference", CLAIM_REFERENCE).single()
  if (claim.error) throw claim.error
  const policy = await db
    .from("policies")
    .select("coverage_start, coverage_end, public_holidays")
    .eq("version", claim.data.policy_version)
    .single()
  if (policy.error) throw policy.error
  const documents = await db.from("claim_documents").select("id, source_file").eq("claim_id", claim.data.id)
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
    receivedAt: claim.data.received_at,
    policy: policy.data,
    documents: [...byDocument.values()],
  })
  if (assessment.checks.some((entry) => entry.outcome !== "pass")) {
    throw new Error(`CLM-DEMO-1001 did not pass: ${assessment.checks.map((entry) => `${entry.check_name}=${entry.outcome}`).join(", ")}`)
  }

  const saved = await db
    .from("assessments")
    .insert({ claim_id: claim.data.id, adapter: assessment.adapter })
    .select("id")
    .single()
  if (saved.error) throw saved.error
  const checks = await db.from("policy_checks").insert(
    assessment.checks.map((entry) => ({
      assessment_id: saved.data.id,
      claim_id: claim.data.id,
      check_name: entry.check_name,
      outcome: entry.outcome,
      detail: entry.detail,
    })),
  )
  if (checks.error) throw checks.error
  console.log(`stored assessment ${saved.data.id} for ${CLAIM_REFERENCE}`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
