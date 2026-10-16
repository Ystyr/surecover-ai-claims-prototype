import assert from "node:assert/strict"
import test from "node:test"

import {
  CLAIM_ABSENT_MESSAGE,
  CLAIM_READ_ERROR_MESSAGE,
  FILE_ABSENT_MESSAGE,
  FILE_READ_ERROR_MESSAGE,
  DIFFERING_STORED_DETAIL,
  MATCHING_STORED_DETAIL,
  assessmentHistoryNote,
  claimPageMessage,
  classificationEstablished,
  judgmentReading,
  latestCheckFailed,
  requestMessageText,
  timelineNewestFirst,
  expandQuotes,
  fileFailure,
  findingQuotes,
  findingSummary,
  type CheckRow,
} from "./findings.ts"

function check(checkName: string, outcome: string, detail: Record<string, unknown>): CheckRow {
  return { check_name: checkName, outcome, detail }
}

test("a claim-type pass links the form sentence to the claim form", () => {
  const links = findingQuotes(
    check("claim_type", "pass", {
      quote: { text: "Claim type: Flight delay", source_file: "claim-form.pdf" },
      value: "Flight delay",
      letter_source_file: "delay-letter.pdf",
    }),
  )
  assert.deepEqual(links, [{ text: "Claim type: Flight delay", sourceFile: "claim-form.pdf", flightNumber: null }])
  assert.equal(
    findingSummary(check("claim_type", "pass", { value: "Flight delay", letter_source_file: "delay-letter.pdf" })),
    "The form says Flight delay. The check treated delay-letter.pdf as the delay letter.",
  )
})

test("delay and boarding-pass quotes use their own files", () => {
  const delay = findingQuotes(
    check("delay", "pass", {
      hours: 8,
      quote: { text: "Delay duration: 8 hours.", source_file: "delay-letter.pdf" },
      reason_quote: {
        text: "Flight SC202 from NRT to SIN on 7 August 2026 was delayed because of a late inbound aircraft.",
        source_file: "delay-letter.pdf",
      },
    }),
  )
  assert.deepEqual(
    delay.map((link) => link.sourceFile),
    ["delay-letter.pdf", "delay-letter.pdf"],
  )

  const compared = findingQuotes(
    check("consistency", "pass", {
      routes: [
        {
          form: { quote: [{ text: "SIN", source_file: "claim-form.pdf" }] },
          pass: { quote: [{ text: "From: SIN", source_file: "boarding-pass-sc101.pdf" }], source_file: "delay-letter.pdf" },
        },
      ],
      return_date: {},
    }),
  )
  assert.deepEqual(
    compared.map((link) => link.sourceFile),
    ["claim-form.pdf", "boarding-pass-sc101.pdf"],
  )
})

test("two Singapore arrivals stay visible and one quote stays one link", () => {
  const detail = {
    return_date: "2026-08-07",
    return_quote: { text: "Return to Singapore: Friday 7 August 2026", source_file: "claim-form.pdf" },
    revised_arrival: null,
    revised_quote: [
      { text: "7 August 2026", source_file: "revised-itinerary.pdf" },
      { text: "8 August 2026", source_file: "revised-itinerary.pdf" },
    ],
  }
  const links = findingQuotes(check("filing_deadline", "unknown", detail))
  assert.deepEqual(
    links.map((link) => link.text),
    ["Return to Singapore: Friday 7 August 2026", "7 August 2026", "8 August 2026"],
  )
  assert.match(findingSummary(check("filing_deadline", "unknown", detail)), /disagree/)

  const dates = {
    form_return_date: "2026-08-07",
    form_quote: { text: "Return to Singapore: Friday 7 August 2026", source_file: "claim-form.pdf" },
    revised_arrival: null,
    revised_quote: detail.revised_quote,
  }
  assert.match(findingSummary(check("consistency", "unknown", { routes: [], return_date: dates })), /disagree/)
  assert.deepEqual(expandQuotes("7 August 2026"), [{ text: "7 August 2026", sourceFile: null, flightNumber: null }])
})

test("a flight's form quote is kept once and the other flight stays", () => {
  const links = findingQuotes(
    check("consistency", "pass", {
      routes: [
        {
          flight_number: "SC101",
          departure_date: "2026-08-01",
          form: {
            quote: [
              { text: "SIN", source_file: "claim-form.pdf" },
              { text: "NRT", source_file: "claim-form.pdf" },
            ],
          },
          pass: { quote: [{ text: "From: SIN", source_file: "boarding-pass-sc101.pdf" }] },
        },
        {
          flight_number: "SC101",
          departure_date: "2026-08-01",
          form: {
            quote: [
              { text: "SIN", source_file: "claim-form.pdf" },
              { text: "NRT", source_file: "claim-form.pdf" },
            ],
          },
          pass: { quote: [{ text: "SIN", source_file: "boarding-pass-sc101.png" }] },
        },
        {
          flight_number: "SC202",
          departure_date: "2026-08-07",
          form: {
            quote: [
              { text: "NRT", source_file: "claim-form.pdf" },
              { text: "SIN", source_file: "claim-form.pdf" },
            ],
          },
          pass: { quote: [{ text: "From: NRT", source_file: "boarding-pass-sc202.pdf" }] },
        },
      ],
      return_date: {},
    }),
  )
  assert.deepEqual(
    links.map((link) => `${link.text} ${link.flightNumber} ${link.sourceFile}`),
    [
      "SIN SC101 claim-form.pdf",
      "NRT SC101 claim-form.pdf",
      "From: SIN SC101 boarding-pass-sc101.pdf",
      "SIN SC101 boarding-pass-sc101.png",
      "NRT SC202 claim-form.pdf",
      "SIN SC202 claim-form.pdf",
      "From: NRT SC202 boarding-pass-sc202.pdf",
    ],
  )
  const formSin = links.filter((link) => link.text === "SIN" && link.sourceFile === "claim-form.pdf")
  assert.deepEqual(
    formSin.map((link) => link.flightNumber),
    ["SC101", "SC202"],
  )
})

test("a missing file and a failed file read are different results", () => {
  assert.deepEqual(fileFailure({ selectError: { message: "unavailable" }, document: null, downloadError: null }), {
    status: 500,
    message: FILE_READ_ERROR_MESSAGE,
  })
  assert.deepEqual(fileFailure({ selectError: null, document: null, downloadError: null }), {
    status: 404,
    message: FILE_ABSENT_MESSAGE,
  })
  assert.deepEqual(fileFailure({ selectError: null, document: { id: "file" }, downloadError: { message: "unavailable" } }), {
    status: 500,
    message: FILE_READ_ERROR_MESSAGE,
  })
  assert.equal(fileFailure({ selectError: null, document: { id: "file" }, downloadError: null }), null)
})

test("matching outcomes say whether the stored detail matches", () => {
  const earlier = [
    check("completeness", "pass", { quote: "old" }),
    check("delay", "pass", { hours: 8 }),
  ]
  const sameDetail = [
    check("delay", "pass", { hours: 8 }),
    check("completeness", "pass", { quote: "old" }),
  ]
  const differentDetail = [
    check("completeness", "pass", { quote: { text: "new", source_file: "claim-form.pdf" } }),
    check("delay", "pass", { hours: 8 }),
  ]
  const fewerChecks = [check("completeness", "pass", { quote: "old" })]
  assert.equal(assessmentHistoryNote(sameDetail, earlier), MATCHING_STORED_DETAIL)
  assert.equal(assessmentHistoryNote(differentDetail, earlier), DIFFERING_STORED_DETAIL)
  assert.equal(assessmentHistoryNote(fewerChecks, earlier), null)
})

test("a non-uuid id is missing and a select error is a failed read", () => {
  assert.equal(
    claimPageMessage({ claimId: "not-a-uuid", claimError: null, claim: null, documentError: null, assessmentError: null }),
    CLAIM_ABSENT_MESSAGE,
  )
  assert.deepEqual(
    fileFailure({
      claimId: "c1a10001-de10-4000-a000-000000001001",
      documentId: "not-a-uuid",
      selectError: null,
      document: null,
      downloadError: null,
    }),
    { status: 404, message: FILE_ABSENT_MESSAGE },
  )
  assert.deepEqual(
    fileFailure({
      claimId: "c1a10001-de10-4000-a000-000000001001",
      documentId: "00000000-0000-4000-a000-000000000000",
      selectError: { message: "unavailable" },
      document: null,
      downloadError: null,
    }),
    { status: 500, message: FILE_READ_ERROR_MESSAGE },
  )
})

test("an empty assignment and a failed read are different messages", () => {
  assert.equal(
    claimPageMessage({ claimError: null, claim: null, documentError: null, assessmentError: null }),
    CLAIM_ABSENT_MESSAGE,
  )
  assert.equal(
    claimPageMessage({ claimError: { message: "unavailable" }, claim: null, documentError: null, assessmentError: null }),
    CLAIM_READ_ERROR_MESSAGE,
  )
  assert.equal(
    claimPageMessage({
      claimError: null,
      claim: { id: "c1a10001-de10-4000-a000-000000001001" },
      documentError: null,
      assessmentError: { message: "unavailable" },
    }),
    CLAIM_READ_ERROR_MESSAGE,
  )
  assert.equal(
    claimPageMessage({
      claimError: null,
      claim: { id: "c1a10001-de10-4000-a000-000000001001" },
      documentError: null,
      assessmentError: null,
    }),
    null,
  )
})

test("a Jev label below the gate or other is not established", () => {
  assert.equal(classificationEstablished("boarding_pass", 0.6), true)
  assert.equal(classificationEstablished("boarding_pass", 0.59), false)
  assert.equal(classificationEstablished("other", 1), false)
})

test("a delay judgment supports, contradicts, or stays unestablished", () => {
  assert.equal(judgmentReading(0.75), "supports")
  assert.equal(judgmentReading(0.74), "not established")
  assert.equal(judgmentReading(0.25), "contradicts")
  assert.equal(judgmentReading(0.26), "not established")
})

test("the request message greets the claimant and keeps the rationale", () => {
  const message = requestMessageText({
    reference: "CLM-DEMO-1001",
    claimantName: "Jamie Lee",
    rationale: "Ask the traveler for the original boarding pass for the delayed return. This records the request only.",
  })
  assert.equal(message.subject, "Information requested for CLM-DEMO-1001")
  assert.equal(
    message.body,
    [
      "Hello Jamie Lee,",
      "",
      "We need more information to continue claim CLM-DEMO-1001.",
      "",
      "Ask the traveler for the original boarding pass for the delayed return. This records the request only.",
      "",
      "Fictional demonstration data. Not a SureCover policy document.",
    ].join("\n"),
  )
})

test("a later message stays above an earlier decision", () => {
  const events = timelineNewestFirst(
    [{ id: "bbbbbbbb-0000-4000-a000-000000000001", created_at: "2026-10-15T10:00:00.000Z" }],
    [],
    [{ id: "cccccccc-0000-4000-a000-000000000003", created_at: "2026-10-15T12:00:00.000Z" }],
  )
  assert.deepEqual(
    events.map((event) => event.kind + ":" + event.item.id),
    ["message:cccccccc-0000-4000-a000-000000000003", "decision:bbbbbbbb-0000-4000-a000-000000000001"],
  )
})

test("a later assessment stays above an earlier decision", () => {
  const events = timelineNewestFirst(
    [{ id: "bbbbbbbb-0000-4000-a000-000000000001", created_at: "2026-10-15T10:00:00.000Z" }],
    [{ id: "aaaaaaaa-0000-4000-a000-000000000002", created_at: "2026-10-15T11:00:00.000Z" }],
  )
  assert.deepEqual(
    events.map((event) => event.kind + ":" + event.item.id),
    ["assessment:aaaaaaaa-0000-4000-a000-000000000002", "decision:bbbbbbbb-0000-4000-a000-000000000001"],
  )
})

test("a failed or unknown latest check is marked on the queue", () => {
  assert.equal(latestCheckFailed(["pass", "pass"]), false)
  assert.equal(latestCheckFailed(["pass", "fail"]), true)
  assert.equal(latestCheckFailed(["unknown"]), true)
  assert.equal(latestCheckFailed([]), false)
})
