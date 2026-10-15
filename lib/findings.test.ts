import assert from "node:assert/strict"
import test from "node:test"

import {
  CLAIM_ABSENT_MESSAGE,
  CLAIM_READ_ERROR_MESSAGE,
  claimPageMessage,
  expandQuotes,
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
  assert.deepEqual(links, [{ text: "Claim type: Flight delay", sourceFile: "claim-form.pdf" }])
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
  assert.deepEqual(expandQuotes("7 August 2026"), [{ text: "7 August 2026", sourceFile: null }])
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
