import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createClient } from "@supabase/supabase-js"

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
  const claims = await officerA.from("claims").select("reference, claimant_name, status, assigned_officer_id")
  if (claims.error) throw claims.error
  require(claims.data.length === 1, `officer A saw ${claims.data.length} claims`)
  require(claims.data[0].reference === CLAIM_REFERENCE, `officer A saw ${claims.data[0].reference}`)
  require(claims.data[0].claimant_name === "Jamie Lee", "officer A did not see Jamie Lee")
  require(claims.data[0].status === "information requested", `claim status is ${claims.data[0].status}`)

  const documents = await officerA
    .from("claim_documents")
    .select("id, source_file, storage_path, text_source, media_type")
  if (documents.error) throw documents.error
  require(documents.data.length === 7, `officer A saw ${documents.data.length} documents`)

  const pages = await officerA.from("document_pages").select("text_source, text")
  if (pages.error) throw pages.error
  require(pages.data.some((page) => page.text_source === "embedded" && page.text.includes("Jamie Lee")), "officer A has no embedded page text")
  require(pages.data.some((page) => page.text_source === "ocr"), "officer A has no OCR page")

  const quotable = await officerA.from("quotable_pages").select("text_source, text")
  if (quotable.error) throw quotable.error
  const expectedQuotable = pages.data.filter((page) => page.text_source === "embedded" || page.text_source === "ocr")
  require(quotable.data.length === expectedQuotable.length, `quotable pages are ${quotable.data.length}, expected ${expectedQuotable.length}`)
  require(quotable.data.every((page) => page.text_source === "embedded" || page.text_source === "ocr"), "quotable view returned a page that must not be quoted")

  const items = await officerA.from("document_items").select("text, confidence, review, label")
  if (items.error) throw items.error
  require(items.data.some((item) => item.text === "Claimant: Jamie Lee" && item.confidence === null), "embedded item is missing or has an OCR score")
  require(items.data.some((item) => item.text === "Jamie Lee" && typeof item.confidence === "number" && typeof item.review === "boolean"), "OCR item is missing its review signal")

  const messages = await officerA
    .from("claim_messages")
    .select("to_address, subject, body, provider, status, provider_message_id")
  if (messages.error) throw messages.error
  require(messages.data.length === 1, `officer A saw ${messages.data.length} messages`)
  require(messages.data[0].to_address === "jamie.lee@example.com", `message address is ${messages.data[0].to_address}`)
  require(messages.data[0].subject === "Information requested for CLM-DEMO-1001", `message subject is ${messages.data[0].subject}`)
  require(messages.data[0].provider === "simulated", `message provider is ${messages.data[0].provider}`)
  require(messages.data[0].status === "recorded", `message status is ${messages.data[0].status}`)
  require(String(messages.data[0].provider_message_id).startsWith("simulated-"), "message id is not simulated")
  require(
    messages.data[0].body.includes("Ask the traveler for the original boarding pass for the delayed return. This records the request only."),
    "message body omitted the stored rationale",
  )
  require(messages.data[0].body.startsWith("Hello Jamie Lee,"), "message body omitted the greeting")

  const classifications = await officerA.from("document_classifications").select("adapter, document_id")
  if (classifications.error) throw classifications.error
  for (const adapter of ["fixture", "jev"]) {
    const rows = classifications.data.filter((row) => row.adapter === adapter)
    const documents = new Set(rows.map((row) => row.document_id))
    require(rows.length === 7, `officer A saw ${rows.length} ${adapter} classifications`)
    require(documents.size === 7, `officer A saw ${adapter} classifications for ${documents.size} files`)
  }

  const officerB = await signIn(url, anonKey, "officer-b@example.com", password)
  for (const table of ["claims", "claim_documents", "document_pages", "document_items", "quotable_pages", "claim_decisions", "claim_messages", "document_classifications"]) {
    const result = await officerB.from(table).select("*")
    if (result.error) throw result.error
    require(result.data.length === 0, `officer B saw ${result.data.length} ${table} rows`)
  }

  for (const document of documents.data) {
    const local = readFileSync(path.join(root, "fixtures/samples/complete", document.source_file))
    const downloaded = await officerA.storage.from("claim-files").download(document.storage_path)
    if (downloaded.error) throw downloaded.error
    const bytes = Buffer.from(await downloaded.data.arrayBuffer())
    require(bytes.equals(local), `${document.source_file} does not match the fixture bytes`)

    const denied = await officerB.storage.from("claim-files").download(document.storage_path)
    require(denied.error || !denied.data, `officer B downloaded ${document.source_file}`)
  }

  const ownProfile = await officerA.from("officers").select("email")
  if (ownProfile.error) throw ownProfile.error
  require(ownProfile.data.length === 1 && ownProfile.data[0].email === "officer-a@example.com", "officer A saw another officer profile")

  const profiles = await officerB.from("officers").select("email")
  if (profiles.error) throw profiles.error
  require(profiles.data.length === 1 && profiles.data[0].email === "officer-b@example.com", "officer B saw another officer profile")

  const policy = await officerB.from("policies").select("version").eq("version", "demo-2026.1")
  if (policy.error) throw policy.error
  require(policy.data.length === 1, "the shared policy row was not readable")

  console.log("officer A can read CLM-DEMO-1001 and all seven files match the fixtures")
  console.log("officer B receives no claim rows and no file bytes")
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
