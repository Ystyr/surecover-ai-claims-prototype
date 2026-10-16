// Asks the delay letter which stored line is the reason and which is the duration.
// A later run keeps a stored choice and does not ask that question again.
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createClient } from "@supabase/supabase-js"

import { CHOICE_GATE } from "../../checks/assess.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const CLAIM_REFERENCE = "CLM-DEMO-1001"
const SOURCE_FILE = "delay-letter.pdf"
const QUESTION_SET = "jev-questions-demo-2026.1"
const MODEL = "jev-1.13.0"
const QUESTIONS = {
  delay_reason_span: "Which line states the reason for the delay?",
  delay_duration_span: "Which line states how long the delay lasted?",
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

function spanState(pages, items) {
  const candidates = items.map((item) => `${item.id}\n${item.text}`).join("\n\n")
  return `${pageState(pages)}\n\n${candidates}`
}

function criteriaFor(items) {
  return {
    ...Object.fromEntries(items.map((item) => [item.id, item.text])),
    none: "None of these lines",
  }
}

function settledChoice(choice, probability, items, pageText) {
  const item = items.find((candidate) => candidate.id === choice)
  if (!item) return { itemId: null, quote: null }
  const onPage = pageText.includes(item.text)
  const established = probability >= CHOICE_GATE && onPage
  return { itemId: item.id, quote: established ? item.text : null }
}

async function selectSpans(apiKey, state, questions, criteria) {
  const response = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      state,
      model: MODEL,
      questions: Object.fromEntries(
        Object.entries(questions).map(([id, instructions]) => [id, { type: "choice", instructions, criteria }]),
      ),
    }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = body && typeof body.message === "string" ? body.message : body && typeof body.error === "string" ? body.error : ""
    throw new Error(`Jev returned ${response.status}${detail ? `: ${detail}` : ""}`)
  }
  const answers = {}
  for (const id of Object.keys(questions)) {
    const answer = body?.answers?.[id]
    const probability = answer?.probabilities?.[answer?.choice]
    if (!answer || answer.type !== "choice" || typeof answer.choice !== "string" || typeof probability !== "number") {
      throw new Error(`Jev did not return a span choice for ${id}`)
    }
    answers[id] = { choice: answer.choice, probability, probabilities: answer.probabilities, confidence: answer.confidence ?? null }
  }
  return { body, answers }
}

async function main() {
  const { url, serviceRole, apiKey } = projectEnv()
  const db = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const claim = await db.from("claims").select("id").eq("reference", CLAIM_REFERENCE).single()
  if (claim.error) throw claim.error
  const document = await db
    .from("claim_documents")
    .select("id")
    .eq("claim_id", claim.data.id)
    .eq("source_file", SOURCE_FILE)
    .single()
  if (document.error) throw document.error
  const pages = await db
    .from("document_pages")
    .select("id, page_number, text, text_source")
    .eq("document_id", document.data.id)
    .in("text_source", ["embedded", "ocr"])
    .order("page_number")
  if (pages.error) throw pages.error
  const items = await db
    .from("document_items")
    .select("id, text, page_number, item_index")
    .eq("document_id", document.data.id)
    .order("page_number")
    .order("item_index")
  if (items.error) throw items.error
  const stored = await db
    .from("document_span_choices")
    .select("question, choice, quote, probability, input_tokens, output_tokens")
    .eq("document_id", document.data.id)
  if (stored.error) throw stored.error

  const existing = new Map(stored.data.map((row) => [row.question, row]))
  const missing = Object.keys(QUESTIONS).filter((id) => !existing.has(id))
  let tokens = stored.data[0] ? { input: stored.data[0].input_tokens, output: stored.data[0].output_tokens } : null
  if (missing.length > 0) {
    const text = pages.data.map((page) => page.text).join("\n")
    if (!text || !items.data.length) throw new Error(`${SOURCE_FILE} has no readable lines`)
    const questions = Object.fromEntries(missing.map((id) => [id, QUESTIONS[id]]))
    const selected = await selectSpans(apiKey, spanState(pages.data, items.data), questions, criteriaFor(items.data))
    tokens = {
      input: selected.body.usage?.input_tokens ?? null,
      output: selected.body.usage?.output_tokens ?? null,
    }
    for (const id of missing) {
      const answer = selected.answers[id]
      const settled = settledChoice(answer.choice, answer.probability, items.data, text)
      const saved = await db
        .from("document_span_choices")
        .insert({
          claim_id: claim.data.id,
          document_id: document.data.id,
          adapter: "jev",
          model: selected.body.model ?? MODEL,
          question_set: QUESTION_SET,
          question: id,
          instructions: QUESTIONS[id],
          choice: answer.choice,
          item_id: settled.itemId,
          quote: settled.quote,
          probability: answer.probability,
          probabilities: answer.probabilities,
          confidence: answer.confidence,
          input_tokens: tokens.input,
          output_tokens: tokens.output,
          raw: selected.body,
        })
        .select("question, choice, quote, probability")
        .single()
      if (saved.error) throw saved.error
      existing.set(id, saved.data)
    }
  }

  const reason = existing.get("delay_reason_span")
  const duration = existing.get("delay_duration_span")
  const kept = missing.length === 0 ? " kept" : ""
  console.log(
    `${SOURCE_FILE} delay_reason_span ${reason.quote ?? reason.choice} ${reason.probability} delay_duration_span ${duration.quote ?? duration.choice} ${duration.probability} tokens ${tokens?.input ?? 0}/${tokens?.output ?? 0}${kept}`,
  )
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
