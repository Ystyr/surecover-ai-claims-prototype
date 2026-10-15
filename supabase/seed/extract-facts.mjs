// Stores the parsed facts for CLM-DEMO-1001. Existing fact rows stay as first parsed.
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
  const documentId = new Map(documents.data.map((document) => [document.source_file, document.id]))

  const assessment = assessClaim({
    receivedAt: claim.data.received_at,
    policy: policy.data,
    documents: [...byDocument.values()],
  })
  const obsolete = await db
    .from("extracted_facts")
    .select("id, fact_key")
    .eq("claim_id", claim.data.id)
    .like("fact_key", "%#leg:%")
  if (obsolete.error) throw obsolete.error
  if (obsolete.data.length > 0) {
    const linked = await db
      .from("fact_corrections")
      .select("fact_id")
      .in(
        "fact_id",
        obsolete.data.map((row) => row.id),
      )
    if (linked.error) throw linked.error
    if (linked.data.length > 0) throw new Error("A leg-index fact has a correction and was left in place")
    const removed = await db
      .from("extracted_facts")
      .delete()
      .in(
        "id",
        obsolete.data.map((row) => row.id),
      )
    if (removed.error) throw removed.error
    console.log(`removed ${obsolete.data.length} leg-index facts`)
  }

  const rows = assessment.facts.map((fact) => ({
    claim_id: claim.data.id,
    fact_key: fact.factKey,
    source_file: fact.sourceFile,
    document_id: documentId.get(fact.sourceFile) ?? null,
    page_number: fact.pageNumber,
    quote_text: fact.quoteText,
    field: fact.field,
    leg_index: fact.legIndex,
    original_value: fact.originalValue,
  }))
  const saved = await db.from("extracted_facts").upsert(rows, {
    onConflict: "claim_id,fact_key",
    ignoreDuplicates: true,
  })
  if (saved.error) throw saved.error
  console.log(`stored ${rows.length} parsed facts for ${CLAIM_REFERENCE}`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
