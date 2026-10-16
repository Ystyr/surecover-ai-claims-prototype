// Classifies each file on CLM-DEMO-1001 once. A later run keeps the stored Jev row.
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createClient } from "@supabase/supabase-js"

import { FIXTURE_ROLES } from "../../checks/assess.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const CLAIM_REFERENCE = "CLM-DEMO-1001"
const QUESTION_SET = "jev-questions-demo-2026.1"
const MODEL = "jev-1.13.0"
const LABELS = {
  claim_form: "The traveler's claim form",
  scheduled_itinerary: "The itinerary as originally scheduled",
  revised_itinerary: "The itinerary after a change",
  boarding_pass: "A boarding pass for one flight",
  delay_letter: "A letter from the airline or handling agent about a delay",
  other: "None of these documents",
}

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
  const apiKey = env.TYPESAFE_API_KEY
  if (!url || !serviceRole) throw new Error(".env must set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
  if (!apiKey) throw new Error(".env must set TYPESAFE_API_KEY")
  return { url, serviceRole, apiKey }
}

function pageState(pages) {
  return pages
    .slice()
    .sort((left, right) => left.page_number - right.page_number)
    .map((page) => `page ${page.id}\n${page.text}`)
    .join("\n\n")
}

async function classifyDocument(apiKey, state) {
  const response = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      state,
      model: MODEL,
      questions: {
        document_role: {
          type: "choice",
          instructions: "Which kind of claim document is this?",
          criteria: LABELS,
        },
      },
    }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = body && typeof body.message === "string" ? body.message : body && typeof body.error === "string" ? body.error : ""
    throw new Error(`Jev returned ${response.status}${detail ? `: ${detail}` : ""}`)
  }
  const answer = body?.answers?.document_role
  const probability = answer?.probabilities?.[answer?.choice]
  if (!answer || answer.type !== "choice" || typeof answer.choice !== "string" || typeof probability !== "number") {
    throw new Error("Jev did not return a document role choice")
  }
  if (!Object.hasOwn(LABELS, answer.choice)) throw new Error(`Jev returned an unknown label ${answer.choice}`)
  return { body, answer, probability }
}

async function main() {
  const { url, serviceRole, apiKey } = projectEnv()
  const db = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const claim = await db.from("claims").select("id").eq("reference", CLAIM_REFERENCE).single()
  if (claim.error) throw claim.error
  const documents = await db.from("claim_documents").select("id, source_file").eq("claim_id", claim.data.id).order("source_file")
  if (documents.error) throw documents.error
  const documentIds = documents.data.map((document) => document.id)
  const pages = await db
    .from("document_pages")
    .select("id, document_id, page_number, text, text_source")
    .in("document_id", documentIds)
    .in("text_source", ["embedded", "ocr"])
    .order("page_number")
  if (pages.error) throw pages.error
  const stored = await db
    .from("document_classifications")
    .select("document_id, adapter, label, probability, input_tokens, output_tokens, created_at")
    .eq("claim_id", claim.data.id)
    .order("created_at", { ascending: false })
  if (stored.error) throw stored.error

  const pagesByDocument = new Map(documentIds.map((id) => [id, []]))
  for (const page of pages.data) pagesByDocument.get(page.document_id)?.push(page)
  const existing = new Map()
  for (const row of stored.data) {
    const key = `${row.document_id}:${row.adapter}`
    if (!existing.has(key)) existing.set(key, row)
  }

  for (const document of documents.data) {
    const fixtureLabel = FIXTURE_ROLES[document.source_file]
    if (!fixtureLabel) throw new Error(`${document.source_file} has no fixture label`)
    if (!existing.has(`${document.id}:fixture`)) {
      const saved = await db.from("document_classifications").insert({
        claim_id: claim.data.id,
        document_id: document.id,
        adapter: "fixture",
        question_set: QUESTION_SET,
        label: fixtureLabel,
        probability: 1,
      })
      if (saved.error) throw saved.error
    }

    let jev = existing.get(`${document.id}:jev`)
    const kept = Boolean(jev)
    if (!jev) {
      const state = pageState(pagesByDocument.get(document.id) ?? [])
      if (!state) throw new Error(`${document.source_file} has no readable page text`)
      const classified = await classifyDocument(apiKey, state)
      const saved = await db
        .from("document_classifications")
        .insert({
          claim_id: claim.data.id,
          document_id: document.id,
          adapter: "jev",
          model: classified.body.model ?? MODEL,
          question_set: QUESTION_SET,
          label: classified.answer.choice,
          probability: classified.probability,
          probabilities: classified.answer.probabilities,
          confidence: classified.answer.confidence ?? null,
          input_tokens: classified.body.usage?.input_tokens ?? null,
          output_tokens: classified.body.usage?.output_tokens ?? null,
          raw: classified.body,
        })
        .select("label, probability, input_tokens, output_tokens")
        .single()
      if (saved.error) throw saved.error
      jev = saved.data
    }

    console.log(
      `${document.source_file} fixture ${fixtureLabel} jev ${jev.label} ${jev.probability} tokens ${jev.input_tokens ?? 0}/${jev.output_tokens ?? 0}${kept ? " kept" : ""}`,
    )
  }
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
