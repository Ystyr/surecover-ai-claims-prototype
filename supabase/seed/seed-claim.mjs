// Hosted demo. The officer password is only for the SureCover Claims project.
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createClient } from "@supabase/supabase-js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const CLAIM_ID = "c1a10001-de10-4000-a000-000000001001"
const CLAIM_REFERENCE = "CLM-DEMO-1001"
const PASSWORD = "local-officer-demo"
const OFFICERS = [
  { email: "officer-a@example.com", displayName: "Officer A" },
  { email: "officer-b@example.com", displayName: "Officer B" },
]

function projectEnv() {
  let raw
  try {
    raw = readFileSync(path.join(root, ".env"), "utf8")
  } catch {
    throw new Error("Missing .env with SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY")
  }
  const env = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "")
    env[trimmed.slice(0, eq).trim()] = value
  }
  const url = env.SUPABASE_URL
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !publishableKey) {
    throw new Error(".env must set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY")
  }
  return { url, publishableKey, serviceRole }
}

async function ensureUser(admin, email) {
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (listed.error) throw listed.error
  const existing = listed.data.users.find((user) => user.email === email)
  if (existing) {
    const updated = await admin.auth.admin.updateUserById(existing.id, {
      password: PASSWORD,
      email_confirm: true,
    })
    if (updated.error) throw updated.error
    return existing.id
  }
  const created = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  })
  if (created.error) throw created.error
  return created.data.user.id
}

async function main() {
  const { url, publishableKey, serviceRole } = projectEnv()
  const expected = JSON.parse(
    readFileSync(path.join(root, "fixtures/expected/complete-claim.json"), "utf8"),
  )
  const claim = expected.claim
  const db = createClient(url, serviceRole || publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  if (serviceRole) {
    const officerIds = {}
    for (const officer of OFFICERS) {
      officerIds[officer.email] = await ensureUser(db, officer.email)
    }
    const removed = await db.from("claims").delete().eq("reference", CLAIM_REFERENCE)
    if (removed.error) throw removed.error
    for (const officer of OFFICERS) {
      const cleared = await db.from("officers").delete().eq("email", officer.email)
      if (cleared.error) throw cleared.error
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
  } else {
    const signedIn = await db.auth.signInWithPassword({
      email: "officer-a@example.com",
      password: PASSWORD,
    })
    if (signedIn.error) throw signedIn.error
    const existingDocs = await db.from("claim_documents").select("id").eq("claim_id", CLAIM_ID)
    if (existingDocs.error) throw existingDocs.error
    const documentIds = existingDocs.data.map((document) => document.id)
    if (documentIds.length > 0) {
      const clearedItems = await db.from("document_items").delete().in("document_id", documentIds)
      if (clearedItems.error) throw clearedItems.error
      const clearedPages = await db.from("document_pages").delete().in("document_id", documentIds)
      if (clearedPages.error) throw clearedPages.error
      const clearedDocs = await db.from("claim_documents").delete().eq("claim_id", CLAIM_ID)
      if (clearedDocs.error) throw clearedDocs.error
    }
  }

  const listed = await db.storage.from("claim-files").list(CLAIM_ID)
  if (listed.error) throw listed.error
  if (listed.data.length > 0) {
    const paths = listed.data.map((file) => `${CLAIM_ID}/${file.name}`)
    const deleted = await db.storage.from("claim-files").remove(paths)
    if (deleted.error) throw deleted.error
  }

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
  process.exit(1)
})
