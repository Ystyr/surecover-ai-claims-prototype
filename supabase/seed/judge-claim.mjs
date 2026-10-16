// Asks the delay letter on CLM-DEMO-1001 whether it states a reason and a duration.
// A later run keeps a stored answer and does not ask that question again.
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createClient } from "@supabase/supabase-js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const CLAIM_REFERENCE = "CLM-DEMO-1001"
const SOURCE_FILE = "delay-letter.pdf"
const QUESTION_SET = "jev-questions-demo-2026.1"
const MODEL = "jev-1.13.0"
const QUESTIONS = {
  delay_reason: "Does this letter state a reason for the delay?",
  delay_duration: "Does this letter state a duration for the delay?",
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

async function judgeDocument(apiKey, state, questions) {
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
        Object.entries(questions).map(([id, instructions]) => [id, { type: "noul", instructions }]),
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
    if (!answer || answer.type !== "noul" || typeof answer.noul !== "number") {
      throw new Error(`Jev did not return a noul for ${id}`)
    }
    answers[id] = answer.noul
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
  const stored = await db
    .from("document_judgments")
    .select("question, noul, input_tokens, output_tokens")
    .eq("document_id", document.data.id)
  if (stored.error) throw stored.error

  const existing = new Map(stored.data.map((row) => [row.question, row]))
  const missing = Object.keys(QUESTIONS).filter((id) => !existing.has(id))
  let tokens = stored.data[0] ? { input: stored.data[0].input_tokens, output: stored.data[0].output_tokens } : null
  if (missing.length > 0) {
    const state = pageState(pages.data)
    if (!state) throw new Error(`${SOURCE_FILE} has no readable page text`)
    const questions = Object.fromEntries(missing.map((id) => [id, QUESTIONS[id]]))
    const judged = await judgeDocument(apiKey, state, questions)
    tokens = {
      input: judged.body.usage?.input_tokens ?? null,
      output: judged.body.usage?.output_tokens ?? null,
    }
    for (const id of missing) {
      const saved = await db.from("document_judgments").insert({
        claim_id: claim.data.id,
        document_id: document.data.id,
        adapter: "jev",
        model: judged.body.model ?? MODEL,
        question_set: QUESTION_SET,
        question: id,
        instructions: QUESTIONS[id],
        noul: judged.answers[id],
        input_tokens: tokens.input,
        output_tokens: tokens.output,
        raw: judged.body,
      }).select("question, noul").single()
      if (saved.error) throw saved.error
      existing.set(id, saved.data)
    }
  }

  const reason = existing.get("delay_reason")
  const duration = existing.get("delay_duration")
  const kept = missing.length === 0 ? " kept" : ""
  console.log(
    `${SOURCE_FILE} delay_reason ${reason.noul} delay_duration ${duration.noul} tokens ${tokens?.input ?? 0}/${tokens?.output ?? 0}${kept}`,
  )
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
