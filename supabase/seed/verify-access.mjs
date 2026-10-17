import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createClient } from "@supabase/supabase-js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const CLAIM_REFERENCE = "CLM-DEMO-1001"
const MISSING_REFERENCE = "CLM-DEMO-1002"
const MISSING_GAP = "SC202 on 7 August 2026 from NRT to SIN"
const CONFLICT_REFERENCE = "CLM-DEMO-1003"
const UNREADABLE_REFERENCE = "CLM-DEMO-1004"
const INBOUND_REFERENCE = "CLM-DEMO-1005"
const INBOUND_EMAIL = "fixture-email-1005"
const REPLY_EMAIL = "fixture-reply-1002"
const REPLY_SUBJECT = "Re: Information requested for CLM-DEMO-1002"
const PHOTO_REPLY_EMAIL = "fixture-reply-1004"
const PHOTO_REPLY_SUBJECT = "Re: Information requested for CLM-DEMO-1004"
const DATE_REPLY_EMAIL = "fixture-reply-1003"
const DATE_REPLY_SUBJECT = "Re: Information requested for CLM-DEMO-1003"
const MISSING_SENTENCE = "The boarding pass for SC202 on 7 August 2026 from NRT to SIN is not on file."
const PHOTO_SENTENCE = "Please send a clearer photo of the boarding pass for SC202 on 7 August 2026 from NRT to SIN."
const DATE_SENTENCE = "The form return date 7 August 2026 disagrees with the revised Singapore arrival 8 August 2026. Both dates stay visible."

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
  const claims = await officerA.from("claims").select("id, reference, claimant_name, status, assigned_officer_id")
  if (claims.error) throw claims.error
  const demoClaims = claims.data.filter((claim) => claim.reference.startsWith("CLM-DEMO-"))
  const liveClaims = claims.data.filter((claim) => !claim.reference.startsWith("CLM-DEMO-"))
  require(demoClaims.length === 5, `officer A saw ${demoClaims.length} demo claims`)
  require(liveClaims.every((claim) => claim.reference.startsWith("CLM-LIVE-")), "a claim is neither a demo nor a live claim")
  const complete = claims.data.find((claim) => claim.reference === CLAIM_REFERENCE)
  const missing = claims.data.find((claim) => claim.reference === MISSING_REFERENCE)
  const conflict = claims.data.find((claim) => claim.reference === CONFLICT_REFERENCE)
  const unreadable = claims.data.find((claim) => claim.reference === UNREADABLE_REFERENCE)
  const inbound = claims.data.find((claim) => claim.reference === INBOUND_REFERENCE)
  require(complete, `officer A did not see ${CLAIM_REFERENCE}`)
  require(missing, `officer A did not see ${MISSING_REFERENCE}`)
  require(conflict, `officer A did not see ${CONFLICT_REFERENCE}`)
  require(unreadable, `officer A did not see ${UNREADABLE_REFERENCE}`)
  require(inbound, `officer A did not see ${INBOUND_REFERENCE}`)
  require(complete.claimant_name === "Jamie Lee", "officer A did not see Jamie Lee")
  require(complete.status === "information requested", `claim status is ${complete.status}`)
  require(missing.claimant_name === "Jamie Lee", `${MISSING_REFERENCE} claimant is ${missing.claimant_name}`)
  require(missing.status === "approved", `${MISSING_REFERENCE} status is ${missing.status}`)
  require(inbound.claimant_name === "Jamie Lee", `${INBOUND_REFERENCE} claimant is ${inbound.claimant_name}`)
  require(inbound.status === "needs review", `${INBOUND_REFERENCE} status is ${inbound.status}`)
  require(conflict.claimant_name === "Jamie Lee", `${CONFLICT_REFERENCE} claimant is ${conflict.claimant_name}`)
  require(conflict.status === "needs review", `${CONFLICT_REFERENCE} status is ${conflict.status}`)
  require(unreadable.claimant_name === "Jamie Lee", `${UNREADABLE_REFERENCE} claimant is ${unreadable.claimant_name}`)
  require(unreadable.status === "needs review", `${UNREADABLE_REFERENCE} status is ${unreadable.status}`)

  const documents = await officerA
    .from("claim_documents")
    .select("id, claim_id, source_file, storage_path, text_source, media_type")
  if (documents.error) throw documents.error
  const completeFiles = documents.data.filter((document) => document.claim_id === complete.id)
  const missingFiles = documents.data.filter((document) => document.claim_id === missing.id)
  const conflictFiles = documents.data.filter((document) => document.claim_id === conflict.id)
  const unreadableFiles = documents.data.filter((document) => document.claim_id === unreadable.id)
  const inboundFiles = documents.data.filter((document) => document.claim_id === inbound.id)
  require(completeFiles.length === 7, `officer A saw ${completeFiles.length} files on ${CLAIM_REFERENCE}`)
  require(missingFiles.length === 7, `officer A saw ${missingFiles.length} files on ${MISSING_REFERENCE}`)
  require(conflictFiles.length === 8, `officer A saw ${conflictFiles.length} files on ${CONFLICT_REFERENCE}`)
  require(unreadableFiles.length === 8, `officer A saw ${unreadableFiles.length} files on ${UNREADABLE_REFERENCE}`)
  require(inboundFiles.length === 7, `officer A saw ${inboundFiles.length} files on ${INBOUND_REFERENCE}`)
  require(
    conflictFiles.some((document) => document.source_file === "revised-itinerary.pdf"),
    `${CONFLICT_REFERENCE} has no agreeing revised itinerary`,
  )
  require(
    conflictFiles.some((document) => document.source_file === "revised-itinerary-8-august.pdf"),
    `${CONFLICT_REFERENCE} lost the 8 August itinerary`,
  )
  require(
    unreadableFiles.some((document) => document.source_file === "return-pass.png" && document.text_source === "unreadable"),
    `${UNREADABLE_REFERENCE} has no unreadable return pass`,
  )
  require(
    unreadableFiles.some((document) => document.source_file === "boarding-pass-sc202.pdf"),
    `${UNREADABLE_REFERENCE} is still missing the readable 7 August pass`,
  )
  require(
    missingFiles.some((document) => document.source_file === "boarding-pass-sc202.pdf"),
    `${MISSING_REFERENCE} is still missing the 7 August boarding pass`,
  )

  const pages = await officerA.from("document_pages").select("document_id, text_source, text")
  if (pages.error) throw pages.error
  require(pages.data.some((page) => page.text_source === "embedded" && page.text.includes("Jamie Lee")), "officer A has no embedded page text")
  require(pages.data.some((page) => page.text_source === "ocr"), "officer A has no OCR page")
  const returnPass = unreadableFiles.find((document) => document.source_file === "return-pass.png")
  const returnPage = pages.data.find((page) => page.document_id === returnPass?.id)
  require(returnPage?.text_source === "unreadable" && returnPage.text === "", "the return pass page is readable")

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
    .select("claim_id, to_address, subject, body, provider, status, provider_message_id")
  if (messages.error) throw messages.error
  const demoClaimIds = new Set([complete.id, missing.id, conflict.id, unreadable.id, inbound.id])
  require(messages.data.filter((message) => demoClaimIds.has(message.claim_id)).length === 5, "a demo claim gained or lost a message")
  const completeMessage = messages.data.find((message) => message.claim_id === complete.id)
  const missingMessage = messages.data.find((message) => message.claim_id === missing.id)
  const inboundMessage = messages.data.find((message) => message.claim_id === inbound.id)
  const photoMessage = messages.data.find((message) => message.claim_id === unreadable.id)
  const conflictMessage = messages.data.find((message) => message.claim_id === conflict.id)
  require(completeMessage, "the recorded message is not on CLM-DEMO-1001")
  require(completeMessage.to_address === "jamie.lee@example.com", `message address is ${completeMessage.to_address}`)
  require(completeMessage.subject === "Information requested for CLM-DEMO-1001", `message subject is ${completeMessage.subject}`)
  require(completeMessage.provider === "simulated", `message provider is ${completeMessage.provider}`)
  require(completeMessage.status === "recorded", `message status is ${completeMessage.status}`)
  require(String(completeMessage.provider_message_id).startsWith("simulated-"), "message id is not simulated")
  require(
    completeMessage.body.includes("Ask the traveler for the original boarding pass for the delayed return. This records the request only."),
    "message body omitted the stored rationale",
  )
  require(completeMessage.body.startsWith("Hello Jamie Lee,"), "message body omitted the greeting")
  require(!completeMessage.body.includes(MISSING_SENTENCE), "the complete claim message names a missing boarding pass")
  require(missingMessage?.body.includes(MISSING_SENTENCE), "the missing-pass request does not name that flight")
  require(missingMessage.provider === "simulated" && missingMessage.status === "recorded", "the missing-pass request was not recorded")
  require(inboundMessage?.subject === "Received CLM-DEMO-1005", `acknowledgment subject is ${inboundMessage?.subject}`)
  require(inboundMessage.body.includes("We received claim CLM-DEMO-1005."), "the acknowledgment does not name the claim")
  require(inboundMessage.provider === "simulated" && inboundMessage.status === "recorded", "the acknowledgment was not recorded")
  require(photoMessage, `the clearer-photo request is not on ${UNREADABLE_REFERENCE}`)
  require(photoMessage.body.includes(PHOTO_SENTENCE), "the clearer-photo request does not name that flight")
  require(!photoMessage.body.includes(MISSING_SENTENCE), "the clearer-photo request calls the boarding pass missing")
  require(photoMessage.provider === "simulated" && photoMessage.status === "recorded", "the clearer-photo request was not recorded")
  require(photoMessage.subject === "Information requested for CLM-DEMO-1004", `clearer-photo subject is ${photoMessage.subject}`)
  require(conflictMessage, `the date request is not on ${CONFLICT_REFERENCE}`)
  require(conflictMessage.body.includes(DATE_SENTENCE), "the date request does not name both return dates")
  require(!conflictMessage.body.includes(MISSING_SENTENCE), "the date request calls a boarding pass missing")
  require(!conflictMessage.body.includes(PHOTO_SENTENCE), "the date request asks for a clearer photo")
  require(conflictMessage.provider === "simulated" && conflictMessage.status === "recorded", "the date request was not recorded")
  require(conflictMessage.subject === "Information requested for CLM-DEMO-1003", `date request subject is ${conflictMessage.subject}`)

  const inboundMail = await officerA.from("inbound_messages").select("provider, provider_email_id, claim_id, from_address, subject")
  if (inboundMail.error) throw inboundMail.error
  const fixtureMail = new Set([INBOUND_EMAIL, REPLY_EMAIL, PHOTO_REPLY_EMAIL, DATE_REPLY_EMAIL])
  require(inboundMail.data.filter((row) => fixtureMail.has(row.provider_email_id)).length === 4, "a fixture email is missing")
  require(
    inboundMail.data.filter((row) => !fixtureMail.has(row.provider_email_id)).every((row) => row.provider === "resend"),
    "a live inbound email is not from Resend",
  )
  const receivedMail = inboundMail.data.find((row) => row.provider_email_id === INBOUND_EMAIL)
  const replyMail = inboundMail.data.find((row) => row.provider_email_id === REPLY_EMAIL)
  const photoReply = inboundMail.data.find((row) => row.provider_email_id === PHOTO_REPLY_EMAIL)
  const dateReply = inboundMail.data.find((row) => row.provider_email_id === DATE_REPLY_EMAIL)
  require(receivedMail?.claim_id === inbound.id, "the inbound email is not on CLM-DEMO-1005")
  require(receivedMail.from_address === "jamie.lee@example.com", "the inbound email is not from the traveler")
  require(replyMail?.claim_id === missing.id, "the reply is not on CLM-DEMO-1002")
  require(replyMail.provider === "simulated", "the reply provider is not simulated")
  require(replyMail.subject === REPLY_SUBJECT, `reply subject is ${replyMail.subject}`)
  require(replyMail.from_address === "jamie.lee@example.com", "the reply is not from the traveler")
  require(photoReply?.claim_id === unreadable.id, "the clearer-photo reply is not on CLM-DEMO-1004")
  require(photoReply.provider === "simulated", "the clearer-photo reply provider is not simulated")
  require(photoReply.subject === PHOTO_REPLY_SUBJECT, `clearer-photo reply subject is ${photoReply.subject}`)
  require(photoReply.from_address === "jamie.lee@example.com", "the clearer-photo reply is not from the traveler")
  require(dateReply?.claim_id === conflict.id, "the date reply is not on CLM-DEMO-1003")
  require(dateReply.provider === "simulated", "the date reply provider is not simulated")
  require(dateReply.subject === DATE_REPLY_SUBJECT, `date reply subject is ${dateReply.subject}`)
  require(dateReply.from_address === "jamie.lee@example.com", "the date reply is not from the traveler")

  const classifications = await officerA.from("document_classifications").select("adapter, document_id")
  if (classifications.error) throw classifications.error
  for (const adapter of ["fixture", "jev"]) {
    const rows = classifications.data.filter((row) => row.adapter === adapter)
    const documents = new Set(rows.map((row) => row.document_id))
    require(rows.length === 7, `officer A saw ${rows.length} ${adapter} classifications`)
    require(documents.size === 7, `officer A saw ${adapter} classifications for ${documents.size} files`)
    require(
      rows.every((row) => completeFiles.some((document) => document.id === row.document_id)),
      `a ${adapter} classification is not on ${CLAIM_REFERENCE}`,
    )
  }

  const judgments = await officerA.from("document_judgments").select("question, document_id")
  if (judgments.error) throw judgments.error
  const questions = new Set(judgments.data.map((row) => row.question))
  const judgmentDocuments = new Set(judgments.data.map((row) => row.document_id))
  require(judgments.data.length === 2, `officer A saw ${judgments.data.length} judgments`)
  require(questions.has("delay_reason") && questions.has("delay_duration"), "officer A is missing a delay judgment")
  require(judgmentDocuments.size === 1, `officer A saw judgments for ${judgmentDocuments.size} files`)
  const judgedFile = documents.data.find((document) => document.id === judgments.data[0].document_id)
  require(judgedFile?.source_file === "delay-letter.pdf", "the delay judgments are not on the delay letter")

  const spans = await officerA.from("document_span_choices").select("question, document_id")
  if (spans.error) throw spans.error
  const spanQuestions = new Set(spans.data.map((row) => row.question))
  const spanDocuments = new Set(spans.data.map((row) => row.document_id))
  require(spans.data.length === 2, `officer A saw ${spans.data.length} span choices`)
  require(spanQuestions.has("delay_reason_span") && spanQuestions.has("delay_duration_span"), "officer A is missing a delay span")
  require(spanDocuments.size === 1, `officer A saw span choices for ${spanDocuments.size} files`)
  const spannedFile = documents.data.find((document) => document.id === spans.data[0].document_id)
  require(spannedFile?.source_file === "delay-letter.pdf", "the delay spans are not on the delay letter")

  const missingAssessments = await officerA
    .from("assessments")
    .select("id, created_at, policy_checks(check_name, outcome, detail)")
    .eq("claim_id", missing.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
  if (missingAssessments.error) throw missingAssessments.error
  require(missingAssessments.data.length === 2, `${MISSING_REFERENCE} has ${missingAssessments.data.length} assessments`)
  const latestChecks = missingAssessments.data[0].policy_checks
  const earlierChecks = missingAssessments.data[1].policy_checks
  require(latestChecks.length === 6, `${MISSING_REFERENCE} latest assessment has ${latestChecks.length} checks`)
  for (const name of ["completeness", "filing_deadline", "coverage", "claim_type", "consistency", "delay"]) {
    const check = latestChecks.find((entry) => entry.check_name === name)
    require(check?.outcome === "pass", `${MISSING_REFERENCE} latest ${name} is ${check?.outcome}`)
  }
  const earlierCompleteness = earlierChecks.find((check) => check.check_name === "completeness")
  require(earlierCompleteness?.outcome === "fail", `${MISSING_REFERENCE} earlier completeness is ${earlierCompleteness?.outcome}`)
  require(
    JSON.stringify(earlierCompleteness.detail.gaps) === JSON.stringify([MISSING_GAP]),
    `${MISSING_REFERENCE} earlier gap is ${JSON.stringify(earlierCompleteness.detail.gaps)}`,
  )
  const missingDecisions = await officerA.from("claim_decisions").select("action, rationale").eq("claim_id", missing.id)
  if (missingDecisions.error) throw missingDecisions.error
  const approvals = missingDecisions.data.filter((decision) => decision.action === "approve")
  require(approvals.length === 1, `${MISSING_REFERENCE} has ${approvals.length} approvals`)
  require(
    approvals[0].rationale === "The missing boarding pass is now on file and the latest checks pass.",
    "the approval rationale changed",
  )
  require(missingDecisions.data.some((decision) => decision.action === "request"), `${MISSING_REFERENCE} lost its request`)

  const conflictAssessments = await officerA
    .from("assessments")
    .select("id, created_at, policy_checks(check_name, outcome, detail)")
    .eq("claim_id", conflict.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
  if (conflictAssessments.error) throw conflictAssessments.error
  require(conflictAssessments.data.length === 2, `${CONFLICT_REFERENCE} has ${conflictAssessments.data.length} assessments`)
  const latestConflict = conflictAssessments.data[0].policy_checks
  const earlierConflict = conflictAssessments.data[1].policy_checks
  require(latestConflict.length === 6, `${CONFLICT_REFERENCE} latest assessment has ${latestConflict.length} checks`)
  for (const name of ["completeness", "filing_deadline", "coverage", "claim_type", "consistency", "delay"]) {
    const check = latestConflict.find((entry) => entry.check_name === name)
    require(check?.outcome === "pass", `${CONFLICT_REFERENCE} latest ${name} is ${check?.outcome}`)
  }
  const filing = earlierConflict.find((check) => check.check_name === "filing_deadline")
  const compared = earlierConflict.find((check) => check.check_name === "consistency")
  require(filing?.outcome === "unknown", `${CONFLICT_REFERENCE} earlier filing is ${filing?.outcome}`)
  require(filing.detail.return_date === "2026-08-07", `${CONFLICT_REFERENCE} form date is ${filing.detail.return_date}`)
  require(filing.detail.revised_arrival === "2026-08-08", `${CONFLICT_REFERENCE} revised arrival is ${filing.detail.revised_arrival}`)
  require(filing.detail.deadline === undefined, `${CONFLICT_REFERENCE} stored a deadline`)
  require(filing.detail.revised_quote?.source_file === "revised-itinerary-8-august.pdf", "the earlier quote left the 8 August file")
  require(compared?.outcome === "unknown", `${CONFLICT_REFERENCE} earlier consistency is ${compared?.outcome}`)
  require(compared.detail.return_date?.form_return_date === "2026-08-07", "the compared form date moved")
  require(compared.detail.return_date?.revised_arrival === "2026-08-08", "the compared revised date moved")
  require(compared.detail.return_date?.revised_quote?.source_file === "revised-itinerary-8-august.pdf", "the compared quote left the 8 August file")

  const unreadableAssessments = await officerA
    .from("assessments")
    .select("id, created_at, policy_checks(check_name, outcome, detail)")
    .eq("claim_id", unreadable.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
  if (unreadableAssessments.error) throw unreadableAssessments.error
  require(unreadableAssessments.data.length === 2, `${UNREADABLE_REFERENCE} has ${unreadableAssessments.data.length} assessments`)
  const latestUnreadable = unreadableAssessments.data[0].policy_checks
  const earlierUnreadable = unreadableAssessments.data[1].policy_checks
  require(latestUnreadable.length === 6, `${UNREADABLE_REFERENCE} latest assessment has ${latestUnreadable.length} checks`)
  for (const name of ["completeness", "filing_deadline", "coverage", "claim_type", "consistency", "delay"]) {
    const check = latestUnreadable.find((entry) => entry.check_name === name)
    require(check?.outcome === "pass", `${UNREADABLE_REFERENCE} latest ${name} is ${check?.outcome}`)
  }
  const earlierUnreadableCompleteness = earlierUnreadable.find((check) => check.check_name === "completeness")
  require(earlierUnreadableCompleteness?.outcome === "unknown", `${UNREADABLE_REFERENCE} earlier completeness is ${earlierUnreadableCompleteness?.outcome}`)
  require(earlierUnreadableCompleteness.detail.unclassified === true, `${UNREADABLE_REFERENCE} treated the return pass as a known type`)
  require(
    JSON.stringify(earlierUnreadableCompleteness.detail.gaps) === JSON.stringify([MISSING_GAP]),
    `${UNREADABLE_REFERENCE} earlier gap is ${JSON.stringify(earlierUnreadableCompleteness.detail.gaps)}`,
  )

  const inboundChecks = await officerA.from("policy_checks").select("check_name, outcome").eq("claim_id", inbound.id)
  if (inboundChecks.error) throw inboundChecks.error
  require(inboundChecks.data.length === 6, `${INBOUND_REFERENCE} has ${inboundChecks.data.length} checks`)
  for (const name of ["completeness", "filing_deadline", "coverage", "claim_type", "consistency", "delay"]) {
    const check = inboundChecks.data.find((entry) => entry.check_name === name)
    require(check?.outcome === "pass", `${INBOUND_REFERENCE} ${name} is ${check?.outcome}`)
  }

  const officerB = await signIn(url, anonKey, "officer-b@example.com", password)
  for (const table of ["claims", "claim_documents", "document_pages", "document_items", "quotable_pages", "assessments", "policy_checks", "claim_decisions", "claim_messages", "inbound_messages", "document_classifications", "document_judgments", "document_span_choices"]) {
    const result = await officerB.from(table).select("*")
    if (result.error) throw result.error
    require(result.data.length === 0, `officer B saw ${result.data.length} ${table} rows`)
  }

  for (const document of documents.data) {
    const local = document.claim_id === conflict.id && document.source_file === "revised-itinerary-8-august.pdf"
      ? readFileSync(path.join(root, "fixtures/samples/conflict/revised-itinerary.pdf"))
      : readFileSync(path.join(
          root,
          "fixtures/samples",
          document.claim_id === unreadable.id && document.source_file === "return-pass.png" ? "unreadable" : "complete",
          document.source_file,
        ))
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

  console.log("officer A can read the five demo claims, and the stored files match the fixtures")
  console.log("CLM-DEMO-1002 is approved and keeps the failed check, the request, and the reply")
  console.log("CLM-DEMO-1003 reply agrees the return date and keeps the 8 August file")
  console.log("CLM-DEMO-1004 keeps the unknown check and the reply makes the latest check pass")
  console.log("CLM-DEMO-1005 records the inbound email and the acknowledgment")
  console.log("officer B receives no claim rows and no file bytes")
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
