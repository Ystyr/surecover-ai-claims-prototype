import { CHOICE_GATE } from "../checks/assess.mjs"

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

export function displayDate(value: string | null | undefined) {
  if (!value) return ""
  const [year, month, day] = value.slice(0, 10).split("-").map(Number)
  if (!year || !month || !day) return value
  return `${day} ${MONTHS[month - 1]} ${year}`
}

export function displayInstant(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value))
}

export const CHECK_ORDER = [
  "completeness",
  "filing_deadline",
  "coverage",
  "claim_type",
  "consistency",
  "delay",
] as const

export const CHECK_LABELS: Record<string, string> = {
  completeness: "Completeness",
  filing_deadline: "Filing deadline",
  coverage: "Coverage",
  claim_type: "Claim type",
  consistency: "Consistency",
  delay: "Delay",
}

export type CheckRow = {
  check_name: string
  outcome: string
  detail: Record<string, unknown>
}

export type DocumentRow = {
  id: string
  source_file: string
  media_type: string
}

export function sortChecks(checks: CheckRow[]) {
  return [...checks].sort((left, right) => {
    const leftIndex = CHECK_ORDER.indexOf(left.check_name as (typeof CHECK_ORDER)[number])
    const rightIndex = CHECK_ORDER.indexOf(right.check_name as (typeof CHECK_ORDER)[number])
    return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex)
  })
}

function text(detail: Record<string, unknown>, key: string) {
  const value = detail[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

export function findingSummary(check: CheckRow) {
  const detail = check.detail ?? {}
  if (check.check_name === "completeness") return completenessSummary(check.outcome, detail)
  if (check.check_name === "filing_deadline") return filingSummary(check.outcome, detail)
  if (check.check_name === "coverage") return coverageSummary(check.outcome, detail)
  if (check.check_name === "claim_type") return claimTypeSummary(check.outcome, detail)
  if (check.check_name === "consistency") return consistencySummary(check.outcome, detail)
  if (check.check_name === "delay") return delaySummary(check.outcome, detail)
  return check.outcome
}

function completenessSummary(outcome: string, detail: Record<string, unknown>) {
  const gaps = Array.isArray(detail.gaps) ? detail.gaps.filter((gap) => typeof gap === "string") : []
  if (outcome === "pass") {
    return "Every required document is present, and each affected flight has a matching boarding pass."
  }
  if (outcome === "fail") {
    return gaps.length > 0 ? `Missing ${gaps.join("; ")}.` : "A required document is missing."
  }
  if (typeof detail.reason === "string") return detail.reason
  return "A required document is not established."
}

function filingSummary(outcome: string, detail: Record<string, unknown>) {
  const returned = displayDate(text(detail, "return_date"))
  const arrival = displayDate(text(detail, "revised_arrival"))
  const deadline = displayDate(text(detail, "deadline"))
  const workingDays = detail.working_days
  if (outcome === "unknown" && expandQuotes(detail.revised_quote).length > 1) {
    return "The revised Singapore dates disagree. Both dates stay visible."
  }
  if (outcome === "unknown" && returned && arrival && returned !== arrival) {
    return `The form return date ${returned} disagrees with the revised Singapore arrival ${arrival}. Both dates stay visible.`
  }
  if (outcome === "unknown") return "The filing deadline could not be established."
  const counted = typeof workingDays === "number" ? `Working day ${workingDays}.` : ""
  if (outcome === "fail") {
    return `Returned ${returned}. ${counted} Filed after the deadline ${deadline}. This is the assignment's 30-working-day rule.`
  }
  return `Returned ${returned}. ${counted} Deadline ${deadline}. This is the assignment's 30-working-day rule.`
}

function coverageSummary(outcome: string, detail: Record<string, unknown>) {
  const start = displayDate(text(detail, "coverage_start"))
  const end = displayDate(text(detail, "coverage_end"))
  if (outcome === "unknown") {
    return typeof detail.reason === "string" ? detail.reason : "Coverage could not be established."
  }
  const legs = Array.isArray(detail.legs) ? detail.legs : []
  const outside = legs.filter((leg) => isRecord(leg) && leg.inside === false)
  if (outcome === "fail") {
    const names = outside.map((leg) => (isRecord(leg) ? String(leg.flight_number ?? "A leg") : "A leg"))
    return `${names.join(", ")} departs outside the seeded period, ${start} through ${end}. Demo assumption.`
  }
  return `Departures fall inside the seeded period, ${start} through ${end}. Demo assumption.`
}

function claimTypeSummary(outcome: string, detail: Record<string, unknown>) {
  const value = text(detail, "value")
  if (outcome === "fail") return `The form names ${value ?? "another claim type"}, which is not flight delay.`
  if (outcome === "unknown") {
    return typeof detail.reason === "string" ? detail.reason : "The claim type could not be established."
  }
  const letter = text(detail, "letter_source_file")
  return `The form says ${value ?? "flight delay"}. The check treated ${letter ?? "the filename"} as the delay letter.`
}

function consistencySummary(outcome: string, detail: Record<string, unknown>) {
  if (outcome === "pass") {
    return "The boarding-pass routes agree with the form, and the form return date agrees with the revised Singapore arrival."
  }
  const dates = isRecord(detail.return_date) ? detail.return_date : null
  const formDate = dates ? displayDate(text(dates, "form_return_date")) : ""
  const arrival = dates ? displayDate(text(dates, "revised_arrival")) : ""
  if (formDate && arrival && formDate !== arrival) {
    return `The form return date ${formDate} disagrees with the revised Singapore arrival ${arrival}.`
  }
  if (dates && expandQuotes(dates.revised_quote).length > 1) {
    return "The revised Singapore dates disagree. Both dates stay visible."
  }
  return "A compared route or date disagrees. Both values stay visible."
}

function delaySummary(outcome: string, detail: Record<string, unknown>) {
  const hours = typeof detail.hours === "number" ? detail.hours : null
  const reason = text(detail, "reason")
  if (outcome === "pass") {
    return `${hours} hours${reason ? `, reason “${reason}”` : ""}. Meets the fictional 6-hour minimum. Demo assumption.`
  }
  if (outcome === "fail") {
    return `${hours} hours is below the fictional 6-hour minimum. Demo assumption.`
  }
  return "The delay duration could not be read."
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export type QuoteLink = {
  text: string
  sourceFile: string | null
  flightNumber: string | null
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string) {
  return UUID_PATTERN.test(value)
}

export const CLAIM_ABSENT_MESSAGE = "This claim is not in your queue."
export const CLAIM_READ_ERROR_MESSAGE = "This claim could not be read."
export const FILE_ABSENT_MESSAGE = "Not found"
export const FILE_READ_ERROR_MESSAGE = "This file could not be read."
export const MATCHING_STORED_DETAIL = "Outcomes and the stored detail match the earlier assessment."
export const DIFFERING_STORED_DETAIL = "Outcomes match the earlier assessment, and the stored detail differs."

export function latestCheckFailed(outcomes: string[]) {
  return outcomes.some((outcome) => outcome === "fail" || outcome === "unknown")
}

export function fileFailure(input: {
  claimId?: string
  documentId?: string
  selectError: unknown
  document: unknown
  downloadError: unknown
}) {
  const claimId = input.claimId
  const documentId = input.documentId
  if ((claimId !== undefined && !isUuid(claimId)) || (documentId !== undefined && !isUuid(documentId))) {
    return { status: 404, message: FILE_ABSENT_MESSAGE }
  }
  if (input.selectError) return { status: 500, message: FILE_READ_ERROR_MESSAGE }
  if (!input.document) return { status: 404, message: FILE_ABSENT_MESSAGE }
  if (input.downloadError) return { status: 500, message: FILE_READ_ERROR_MESSAGE }
  return null
}

export function assessmentOutcomeLine(checks: CheckRow[]) {
  return sortChecks(checks)
    .map((check) => `${CHECK_LABELS[check.check_name] ?? check.check_name} ${check.outcome}`)
    .join(", ")
}

export function claimPageMessage(input: {
  claimId?: string
  claimError: unknown
  claim: unknown
  documentError: unknown
  assessmentError: unknown
}) {
  if (input.claimId !== undefined && !isUuid(input.claimId)) return CLAIM_ABSENT_MESSAGE
  if (input.claimError || input.documentError || input.assessmentError) return CLAIM_READ_ERROR_MESSAGE
  if (!input.claim) return CLAIM_ABSENT_MESSAGE
  return null
}

export const ROLE_LABELS: Record<string, string> = {
  claim_form: "Claim form",
  scheduled_itinerary: "Scheduled itinerary",
  revised_itinerary: "Revised itinerary",
  boarding_pass: "Boarding pass",
  delay_letter: "Delay letter",
  other: "Other",
}

export function classificationEstablished(label: string, probability: number) {
  return label !== "other" && probability >= CHOICE_GATE
}

export function requestMessageText(input: { reference: string; claimantName: string; rationale: string }) {
  return {
    subject: `Information requested for ${input.reference}`,
    body: [
      `Hello ${input.claimantName},`,
      "",
      `We need more information to continue claim ${input.reference}.`,
      "",
      input.rationale,
      "",
      "Fictional demonstration data. Not a SureCover policy document.",
    ].join("\n"),
  }
}

export function timelineNewestFirst<
  D extends { id: string; created_at: string },
  A extends { id: string; created_at: string },
  M extends { id: string; created_at: string },
>(decisions: D[], assessments: A[], messages: M[] = []) {
  const events: Array<{ kind: "decision"; item: D } | { kind: "assessment"; item: A } | { kind: "message"; item: M }> = [
    ...decisions.map((item) => ({ kind: "decision" as const, item })),
    ...assessments.map((item) => ({ kind: "assessment" as const, item })),
    ...messages.map((item) => ({ kind: "message" as const, item })),
  ]
  return events.sort((left, right) => {
    const byTime = Date.parse(right.item.created_at) - Date.parse(left.item.created_at)
    if (byTime !== 0) return byTime
    return right.item.id < left.item.id ? -1 : right.item.id > left.item.id ? 1 : 0
  })
}

export function assessmentHistoryNote(current: CheckRow[], earlier: CheckRow[] | null | undefined) {
  if (!earlier) return null
  if (assessmentOutcomeLine(current) !== assessmentOutcomeLine(earlier)) return null
  return storedDetailLine(current) === storedDetailLine(earlier) ? MATCHING_STORED_DETAIL : DIFFERING_STORED_DETAIL
}

function storedDetailLine(checks: CheckRow[]) {
  return JSON.stringify(sortChecks(checks).map((check) => [check.check_name, stableValue(check.detail ?? {})]))
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry))
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
  }
  return value ?? null
}

export function findingQuotes(check: CheckRow): QuoteLink[] {
  return storedQuotes(check)
}

function storedQuotes(check: CheckRow): QuoteLink[] {
  const detail = check.detail ?? {}
  if (check.check_name === "filing_deadline") {
    return [...expandQuotes(detail.return_quote), ...expandQuotes(detail.revised_quote)]
  }
  if (check.check_name === "coverage") {
    const legs = Array.isArray(detail.legs) ? detail.legs : []
    return legs.flatMap((leg) => (isRecord(leg) ? expandQuotes(leg.quote) : []))
  }
  if (check.check_name === "claim_type") return expandQuotes(detail.quote)
  if (check.check_name === "consistency") {
    const links: QuoteLink[] = []
    const routes = Array.isArray(detail.routes) ? detail.routes : []
    const shownFlights = new Set<string>()
    for (const route of routes) {
      if (!isRecord(route)) continue
      const flightNumber = typeof route.flight_number === "string" && route.flight_number.length > 0 ? route.flight_number : null
      const flightKey = `${flightNumber ?? ""}\0${typeof route.departure_date === "string" ? route.departure_date : ""}`
      if (isRecord(route.form) && !shownFlights.has(flightKey)) {
        links.push(...withFlight(expandQuotes(route.form.quote), flightNumber))
        shownFlights.add(flightKey)
      }
      if (isRecord(route.pass)) links.push(...withFlight(expandQuotes(route.pass.quote), flightNumber))
    }
    const dates = isRecord(detail.return_date) ? detail.return_date : null
    if (dates) links.push(...expandQuotes(dates.form_quote), ...expandQuotes(dates.revised_quote))
    return links
  }
  if (check.check_name === "delay") {
    return [...expandQuotes(detail.quote), ...expandQuotes(detail.reason_quote)]
  }
  return []
}

export function expandQuotes(value: unknown): QuoteLink[] {
  if (typeof value === "string" && value.length > 0) return [{ text: value, sourceFile: null, flightNumber: null }]
  if (Array.isArray(value)) return value.flatMap((entry) => expandQuotes(entry))
  if (isRecord(value) && typeof value.text === "string" && value.text.length > 0) {
    return [
      {
        text: value.text,
        sourceFile: typeof value.source_file === "string" ? value.source_file : null,
        flightNumber: null,
      },
    ]
  }
  return []
}

function withFlight(links: QuoteLink[], flightNumber: string | null) {
  return links.map((link) => ({ ...link, flightNumber }))
}
