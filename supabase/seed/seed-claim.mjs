// Hosted demo. The officer password and service-role key stay in .env.
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createClient } from "@supabase/supabase-js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const CLAIM_ID = "c1a10001-de10-4000-a000-000000001001"
const CLAIM_REFERENCE = "CLM-DEMO-1001"
const OFFICERS = [
  { email: "officer-a@example.com", displayName: "Officer A" },
  { email: "officer-b@example.com", displayName: "Officer B" },
]

function readEnvFile() {
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
  return env
}

function projectEnv() {
  const env = readEnvFile()
  const url = env.SUPABASE_URL
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY
  const password = env.OFFICER_PASSWORD
  if (!url || !serviceRole || !password) {
    throw new Error(".env must set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and OFFICER_PASSWORD")
  }
  return { url, serviceRole, password }
}

async function replaceUser(admin, email, password) {
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (listed.error) throw listed.error
  const existing = listed.data.users.find((user) => user.email === email)
  if (existing) {
    const removed = await admin.auth.admin.deleteUser(existing.id)
    if (removed.error) throw removed.error
  }
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (created.error) throw created.error
  return created.data.user.id
}

async function main() {
  const { url, serviceRole, password } = projectEnv()
  const expected = JSON.parse(
    readFileSync(path.join(root, "fixtures/expected/complete-claim.json"), "utf8"),
  )
  const claim = expected.claim
  const db = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const existing = await db.from("claims").select("reference")
  if (existing.error) throw existing.error
  const others = existing.data.filter((row) => row.reference !== CLAIM_REFERENCE).map((row) => row.reference)
  if (others.length > 0) {
    throw new Error(`seed:claim stops before deleting anything. Other claims are still stored: ${others.join(", ")}`)
  }

  const removed = await db.from("claims").delete().eq("reference", CLAIM_REFERENCE)
  if (removed.error) throw removed.error
  const listed = await db.storage.from("claim-files").list(CLAIM_ID)
  if (listed.error) throw listed.error
  if (listed.data.length > 0) {
    const paths = listed.data.map((file) => `${CLAIM_ID}/${file.name}`)
    const deleted = await db.storage.from("claim-files").remove(paths)
    if (deleted.error) throw deleted.error
  }
  for (const officer of OFFICERS) {
    const cleared = await db.from("officers").delete().eq("email", officer.email)
    if (cleared.error) throw cleared.error
  }

  const officerIds = {}
  for (const officer of OFFICERS) {
    officerIds[officer.email] = await replaceUser(db, officer.email, password)
    const saved = await db.from("officers").insert({
      id: officerIds[officer.email],
      email: officer.email,
      display_name: officer.displayName,
    })
    if (saved.error) throw saved.error
  }

  const policy = await db.from("policies").upsert({
    version: expected.policy_version,
    label: expected.label,
    coverage_start: expected.matching.coverage_period.start,
    coverage_end: expected.matching.coverage_period.end,
    public_holidays: expected.filing.public_holidays_2026,
  })
  if (policy.error) throw policy.error
  const inserted = await db.from("claims").insert({
    id: CLAIM_ID,
    reference: CLAIM_REFERENCE,
    status: "submitted",
    policy_version: expected.policy_version,
    claimant_name: claim.claimant_name,
    policy_reference: claim.policy_reference,
    traveler_email: claim.traveler_email,
    return_date: claim.return_date,
    received_at: claim.received_at,
    assigned_officer_id: officerIds["officer-a@example.com"],
  })
  if (inserted.error) throw inserted.error

  for (const sample of expected.sample_documents) {
    const parse = JSON.parse(
      readFileSync(path.join(root, "fixtures/parses/complete", `${sample.file}.json`), "utf8"),
    )
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
    console.log(`seeded ${sample.file} (${parse.items.length} items)`)
  }

  console.log(`seeded ${CLAIM_REFERENCE} for officer-a@example.com`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
