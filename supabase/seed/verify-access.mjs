import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createClient } from "@supabase/supabase-js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const CLAIM_REFERENCE = "CLM-DEMO-1001"
const PASSWORD = "local-officer-demo"

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
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "")
  }
  const url = env.SUPABASE_URL
  const anonKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error(".env must set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY")
  }
  return { url, anonKey }
}

function require(condition, message) {
  if (!condition) throw new Error(message)
}

async function signIn(url, anonKey, email) {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const signedIn = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (signedIn.error) throw signedIn.error
  return client
}

async function main() {
  const { url, anonKey } = projectEnv()
  const officerA = await signIn(url, anonKey, "officer-a@example.com")
  const claims = await officerA.from("claims").select("reference, claimant_name, status, assigned_officer_id")
  if (claims.error) throw claims.error
  require(claims.data.length === 1, `officer A saw ${claims.data.length} claims`)
  require(claims.data[0].reference === CLAIM_REFERENCE, `officer A saw ${claims.data[0].reference}`)
  require(claims.data[0].claimant_name === "Jamie Lee", "officer A did not see Jamie Lee")
  require(claims.data[0].status === "submitted", `claim status is ${claims.data[0].status}`)

  const documents = await officerA
    .from("claim_documents")
    .select("id, source_file, storage_path, text_source, media_type")
  if (documents.error) throw documents.error
  require(documents.data.length === 6, `officer A saw ${documents.data.length} documents`)

  const pages = await officerA.from("document_pages").select("text_source, text")
  if (pages.error) throw pages.error
  require(pages.data.some((page) => page.text_source === "embedded" && page.text.includes("Jamie Lee")), "officer A has no embedded page text")
  require(pages.data.some((page) => page.text_source === "ocr"), "officer A has no OCR page")

  const items = await officerA.from("document_items").select("text, confidence, review, label")
  if (items.error) throw items.error
  require(items.data.some((item) => item.text === "Claimant: Jamie Lee" && item.confidence === null), "embedded item is missing or has an OCR score")
  require(items.data.some((item) => item.text === "Jamie Lee" && typeof item.confidence === "number" && typeof item.review === "boolean"), "OCR item is missing its review signal")

  const pass = documents.data.find((document) => document.source_file === "boarding-pass-sc101.png")
  const downloaded = await officerA.storage.from("claim-files").download(pass.storage_path)
  if (downloaded.error) throw downloaded.error
  const bytes = Buffer.from(await downloaded.data.arrayBuffer())
  require(bytes.length > 1000, "officer A downloaded an empty boarding pass")

  const officerB = await signIn(url, anonKey, "officer-b@example.com")
  for (const table of ["claims", "claim_documents", "document_pages", "document_items"]) {
    const result = await officerB.from(table).select("*")
    if (result.error) throw result.error
    require(result.data.length === 0, `officer B saw ${result.data.length} ${table} rows`)
  }
  const deniedFile = await officerB.storage.from("claim-files").download(pass.storage_path)
  require(deniedFile.error || !deniedFile.data, "officer B downloaded the boarding pass")

  const ownProfile = await officerA.from("officers").select("email")
  if (ownProfile.error) throw ownProfile.error
  require(ownProfile.data.length === 1 && ownProfile.data[0].email === "officer-a@example.com", "officer A saw another officer profile")

  const profiles = await officerB.from("officers").select("email")
  if (profiles.error) throw profiles.error
  require(profiles.data.length === 1 && profiles.data[0].email === "officer-b@example.com", "officer B saw another officer profile")

  const policy = await officerB.from("policies").select("version").eq("version", "demo-2026.1")
  if (policy.error) throw policy.error
  require(policy.data.length === 1, "the shared policy row was not readable")

  console.log("officer A can read CLM-DEMO-1001 and its files")
  console.log("officer B receives no claim rows and no file bytes")
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
