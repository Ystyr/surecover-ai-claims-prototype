import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
import test from "node:test"

import {
  assessClaim,
  deadlineDate,
  displayDate,
  quotableItems,
  singaporeDate,
  workingDayCount,
} from "./assess.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const expected = JSON.parse(readFileSync(path.join(root, "fixtures/expected/complete-claim.json"), "utf8"))

const policy = {
  coverage_start: expected.matching.coverage_period.start,
  coverage_end: expected.matching.coverage_period.end,
  public_holidays: expected.filing.public_holidays_2026,
}

function item(text) {
  return { text }
}

function table(flights) {
  const items = [item("Flight"), item("Date"), item("From"), item("To")]
  for (const flight of flights) items.push(item(flight.flight), item(flight.date), item(flight.from), item(flight.to))
  return items
}

const flights = [
  { flight: "SC101", date: "1 August 2026", from: "SIN", to: "NRT" },
  { flight: "SC202", date: "7 August 2026", from: "NRT", to: "SIN" },
]

function pass(file, flight, date, from, to) {
  return {
    sourceFile: file,
    items: [item(`Flight: ${flight}`), item(`Date: ${date}`), item(`From: ${from}`), item(`To: ${to}`)],
  }
}

function letter(duration = "Delay duration: 8 hours.") {
  return {
    sourceFile: "delay-letter.pdf",
    items: [
      item("Flight SC202 from NRT to SIN on 7 August 2026 was delayed because of a late inbound aircraft."),
      item(duration),
    ],
  }
}

function bundle(overrides = {}) {
  const documents = [
    {
      sourceFile: "claim-form.pdf",
      items: [
        item(overrides.claimType ?? "Claim type: Flight delay"),
        item(overrides.returnText ?? "Return to Singapore: Friday 7 August 2026"),
        ...table(overrides.flights ?? flights),
      ],
    },
    { sourceFile: "scheduled-itinerary.pdf", items: [item("Scheduled itinerary"), ...table(flights)] },
    { sourceFile: "revised-itinerary.pdf", items: [item("Revised itinerary"), ...table(overrides.revised ?? flights)] },
    pass("boarding-pass-sc101.pdf", "SC101", "1 August 2026", "SIN", "NRT"),
    pass("boarding-pass-sc101.png", "SC101", "1 August 2026", "SIN", "NRT"),
    pass("boarding-pass-sc202.pdf", "SC202", "7 August 2026", "NRT", "SIN"),
    letter(overrides.duration),
  ]
  return assessClaim({
    receivedAt: overrides.receivedAt ?? "2026-08-12T09:00:00+08:00",
    policy: overrides.policy === undefined ? policy : overrides.policy,
    documents: overrides.documents ?? documents,
    corrections: overrides.corrections ?? [],
  })
}

function outcome(result, name) {
  const found = result.checks.find((entry) => entry.check_name === name)
  assert.ok(found, `missing ${name}`)
  return found
}

test("the complete fixture passes every check", () => {
  const documents = expected.sample_documents.map((sample) => {
    const parse = JSON.parse(readFileSync(path.join(root, "fixtures/parses/complete", `${sample.file}.json`), "utf8"))
    return {
      sourceFile: sample.file,
      items: parse.items.map((entry) => ({ text: entry.text, pageNumber: entry.page_number })),
    }
  })
  const result = assessClaim({
    receivedAt: expected.claim.received_at,
    policy,
    documents,
  })
  assert.deepEqual(result.checks.map((entry) => entry.outcome), ["pass", "pass", "pass", "pass", "pass", "pass"])
  const filing = outcome(result, "filing_deadline").detail
  assert.equal(filing.return_date, "2026-08-07")
  assert.equal(filing.received_date, "2026-08-12")
  assert.equal(filing.working_days, 2)
  assert.equal(filing.deadline, "2026-09-21")
  const delay = outcome(result, "delay")
  assert.equal(delay.outcome, "pass")
  assert.equal(delay.detail.hours, 8)
  assert.equal(delay.detail.reason, "late inbound aircraft")
  assert.equal(result.adapter, "fixture")
})

test("working day 30 is in time and the next working day is late", () => {
  assert.equal(deadlineDate("2026-08-07", policy.public_holidays), "2026-09-21")
  assert.equal(workingDayCount("2026-08-07", "2026-08-12", policy.public_holidays), 2)
  assert.equal(workingDayCount("2026-08-07", "2026-09-21", policy.public_holidays), 30)
  assert.equal(workingDayCount("2026-08-07", "2026-09-22", policy.public_holidays), 31)
  assert.equal(outcome(bundle({ receivedAt: "2026-09-21T09:00:00+08:00" }), "filing_deadline").outcome, "pass")
  const late = outcome(bundle({ receivedAt: "2026-09-22T09:00:00+08:00" }), "filing_deadline")
  assert.equal(late.outcome, "fail")
  assert.equal(late.detail.deadline, "2026-09-21")
  assert.equal(late.detail.working_days, 31)
})

test("the received instant uses the Asia/Singapore calendar date", () => {
  assert.equal(singaporeDate("2026-08-11T17:00:00Z"), "2026-08-12")
  const filing = outcome(bundle({ receivedAt: "2026-08-11T17:00:00Z" }), "filing_deadline")
  assert.equal(filing.detail.received_date, "2026-08-12")
  assert.equal(filing.detail.working_days, 2)
})

test("a missing 7 August pass fails completeness and names that flight", () => {
  const result = assessClaim({
    receivedAt: "2026-08-12T09:00:00+08:00",
    policy,
    documents: [
      {
        sourceFile: "claim-form.pdf",
        items: [item("Claim type: Flight delay"), item("Return to Singapore: Friday 7 August 2026"), ...table(flights)],
      },
      { sourceFile: "scheduled-itinerary.pdf", items: table(flights) },
      { sourceFile: "revised-itinerary.pdf", items: table(flights) },
      pass("boarding-pass-sc101.pdf", "SC101", "1 August 2026", "SIN", "NRT"),
      letter(),
    ],
  })
  const completeness = outcome(result, "completeness")
  assert.equal(completeness.outcome, "fail")
  assert.deepEqual(completeness.detail.gaps, ["SC202 on 7 August 2026 from NRT to SIN"])
  assert.equal(displayDate("2026-08-07"), "7 August 2026")
})

test("two passes for the same flight still satisfy that flight", () => {
  const result = bundle()
  assert.equal(outcome(result, "completeness").outcome, "pass")
})

test("a 3-hour delay fails and an unparseable duration is unknown", () => {
  const short = bundle({ duration: "Delay duration: 3 hours." })
  assert.equal(outcome(short, "completeness").outcome, "pass")
  assert.equal(outcome(short, "delay").outcome, "fail")
  assert.equal(outcome(short, "delay").detail.hours, 3)
  const messy = bundle({ duration: "Delay duration: several hours." })
  assert.equal(outcome(messy, "completeness").outcome, "pass")
  assert.equal(outcome(messy, "delay").outcome, "unknown")
  assert.equal(outcome(messy, "delay").detail.hours, null)
})

test("a departure outside the seeded coverage period fails", () => {
  const outside = flights.map((flight) =>
    flight.flight === "SC101" ? { ...flight, date: "1 June 2026" } : flight,
  )
  const result = bundle({
    flights: outside,
    documents: [
      {
        sourceFile: "claim-form.pdf",
        items: [item("Claim type: Flight delay"), item("Return to Singapore: Friday 7 August 2026"), ...table(outside)],
      },
      { sourceFile: "scheduled-itinerary.pdf", items: table(flights) },
      { sourceFile: "revised-itinerary.pdf", items: table(flights) },
      pass("boarding-pass-sc101.pdf", "SC101", "1 June 2026", "SIN", "NRT"),
      pass("boarding-pass-sc202.pdf", "SC202", "7 August 2026", "NRT", "SIN"),
      letter(),
    ],
  })
  const covered = outcome(result, "coverage")
  assert.equal(covered.outcome, "fail")
  assert.equal(covered.detail.legs[0].departure_date, "2026-06-01")
  assert.equal(covered.detail.legs[0].inside, false)
})

test("a missing policy record or an unreadable departure is unknown", () => {
  assert.equal(outcome(bundle({ policy: null }), "coverage").outcome, "unknown")
  assert.equal(outcome(bundle({ policy: null }), "filing_deadline").outcome, "unknown")
  const unreadable = flights.map((flight) => (flight.flight === "SC101" ? { ...flight, date: "not a date" } : flight))
  const result = bundle({
    documents: [
      {
        sourceFile: "claim-form.pdf",
        items: [item("Claim type: Flight delay"), item("Return to Singapore: Friday 7 August 2026"), ...table(unreadable)],
      },
      { sourceFile: "scheduled-itinerary.pdf", items: table(flights) },
      { sourceFile: "revised-itinerary.pdf", items: table(flights) },
      pass("boarding-pass-sc202.pdf", "SC202", "7 August 2026", "NRT", "SIN"),
      letter(),
    ],
  })
  assert.equal(outcome(result, "coverage").outcome, "unknown")
  assert.equal(outcome(result, "completeness").outcome, "unknown")
})

test("a missing delay letter fails completeness when a flight date cannot be read", () => {
  const unreadable = flights.map((flight) => (flight.flight === "SC101" ? { ...flight, date: "not a date" } : flight))
  const result = assessClaim({
    receivedAt: "2026-08-12T09:00:00+08:00",
    policy,
    documents: [
      {
        sourceFile: "claim-form.pdf",
        items: [item("Claim type: Flight delay"), item("Return to Singapore: Friday 7 August 2026"), ...table(unreadable)],
      },
      { sourceFile: "scheduled-itinerary.pdf", items: table(flights) },
      { sourceFile: "revised-itinerary.pdf", items: table(flights) },
      pass("boarding-pass-sc202.pdf", "SC202", "7 August 2026", "NRT", "SIN"),
    ],
  })
  const completeness = outcome(result, "completeness")
  assert.equal(completeness.outcome, "fail")
  assert.ok(completeness.detail.gaps.includes("delay letter"))
})

test("no Singapore arrival is not a date conflict", () => {
  const revised = flights.map((flight) => (flight.flight === "SC202" ? { ...flight, to: "HND" } : flight))
  const result = bundle({ revised })
  assert.equal(outcome(result, "consistency").outcome, "pass")
  assert.equal(outcome(result, "filing_deadline").outcome, "pass")
  assert.equal(outcome(result, "filing_deadline").detail.return_date, "2026-08-07")
  assert.equal(outcome(result, "filing_deadline").detail.revised_arrival, null)
})

test("a return-date conflict keeps both dates and does not pick one", () => {
  const revised = flights.map((flight) =>
    flight.flight === "SC202" ? { ...flight, date: "8 August 2026" } : flight,
  )
  const result = bundle({ revised })
  const filing = outcome(result, "filing_deadline")
  const compared = outcome(result, "consistency")
  assert.equal(filing.outcome, "unknown")
  assert.equal(filing.detail.deadline, undefined)
  assert.equal(filing.detail.return_date, "2026-08-07")
  assert.equal(filing.detail.revised_arrival, "2026-08-08")
  assert.equal(compared.outcome, "unknown")
  assert.equal(compared.detail.return_date.form_return_date, "2026-08-07")
  assert.equal(compared.detail.return_date.revised_arrival, "2026-08-08")
})

test("a route mismatch on a matching pass is unknown", () => {
  const result = bundle({
    documents: [
      {
        sourceFile: "claim-form.pdf",
        items: [item("Claim type: Flight delay"), item("Return to Singapore: Friday 7 August 2026"), ...table(flights)],
      },
      { sourceFile: "scheduled-itinerary.pdf", items: table(flights) },
      { sourceFile: "revised-itinerary.pdf", items: table(flights) },
      pass("boarding-pass-sc101.pdf", "SC101", "1 August 2026", "SIN", "HND"),
      pass("boarding-pass-sc202.pdf", "SC202", "7 August 2026", "NRT", "SIN"),
      letter(),
    ],
  })
  assert.equal(outcome(result, "completeness").outcome, "pass")
  const compared = outcome(result, "consistency")
  assert.equal(compared.outcome, "unknown")
  assert.equal(compared.detail.routes[0].form.destination, "NRT")
  assert.equal(compared.detail.routes[0].pass.destination, "HND")
})

test("claim type fails for another readable type and is unknown below the gate", () => {
  assert.equal(outcome(bundle({ claimType: "Claim type: Trip cancellation" }), "claim_type").outcome, "fail")
  const other = bundle({
    documents: [
      {
        sourceFile: "claim-form.pdf",
        items: [item("Claim type: Flight delay"), item("Return to Singapore: Friday 7 August 2026"), ...table(flights)],
      },
      { sourceFile: "scheduled-itinerary.pdf", items: table(flights) },
      { sourceFile: "revised-itinerary.pdf", items: table(flights) },
      pass("boarding-pass-sc101.pdf", "SC101", "1 August 2026", "SIN", "NRT"),
      pass("boarding-pass-sc202.pdf", "SC202", "7 August 2026", "NRT", "SIN"),
      { ...letter(), choice: "other", choiceProbability: 0.9 },
    ],
  })
  assert.equal(outcome(other, "claim_type").outcome, "unknown")
  assert.equal(outcome(other, "completeness").outcome, "unknown")
  const low = bundle({
    documents: [
      {
        sourceFile: "claim-form.pdf",
        items: [item("Claim type: Flight delay"), item("Return to Singapore: Friday 7 August 2026"), ...table(flights)],
      },
      { sourceFile: "scheduled-itinerary.pdf", items: table(flights) },
      { sourceFile: "revised-itinerary.pdf", items: table(flights) },
      pass("boarding-pass-sc101.pdf", "SC101", "1 August 2026", "SIN", "NRT"),
      pass("boarding-pass-sc202.pdf", "SC202", "7 August 2026", "NRT", "SIN"),
      { ...letter(), choice: "delay_letter", choiceProbability: 0.59 },
    ],
  })
  assert.equal(outcome(low, "claim_type").outcome, "unknown")
  assert.equal(outcome(low, "claim_type").detail.choice_probability, 0.59)
})

test("a quote records the file that produced it", () => {
  const result = bundle()
  const filing = outcome(result, "filing_deadline").detail
  assert.equal(filing.return_quote.source_file, "claim-form.pdf")
  assert.equal(filing.revised_quote.source_file, "revised-itinerary.pdf")
  const claimType = outcome(result, "claim_type").detail
  assert.equal(claimType.quote.text, "Claim type: Flight delay")
  assert.equal(claimType.quote.source_file, "claim-form.pdf")
  assert.equal(claimType.letter_source_file, "delay-letter.pdf")
  const delay = outcome(result, "delay").detail
  assert.equal(delay.quote.source_file, "delay-letter.pdf")
  assert.equal(delay.reason_quote.source_file, "delay-letter.pdf")
  const coverage = outcome(result, "coverage").detail
  assert.equal(coverage.legs[0].quote.source_file, "claim-form.pdf")
  const compared = outcome(result, "consistency").detail
  assert.equal(compared.routes[0].form.quote[0].source_file, "claim-form.pdf")
  assert.equal(compared.routes[0].pass.quote[0].source_file, "boarding-pass-sc101.pdf")
})

test("two Singapore arrivals keep both date quotes", () => {
  const revised = [
    ...flights,
    { flight: "SC303", date: "8 August 2026", from: "BKK", to: "SIN" },
  ]
  const result = bundle({ revised })
  const filing = outcome(result, "filing_deadline")
  const compared = outcome(result, "consistency")
  assert.equal(filing.outcome, "unknown")
  assert.equal(filing.detail.revised_arrival, null)
  assert.equal(filing.detail.revised_quote.length, 2)
  assert.deepEqual(
    filing.detail.revised_quote.map((quote) => quote.text),
    ["7 August 2026", "8 August 2026"],
  )
  assert.equal(filing.detail.revised_quote[0].source_file, "revised-itinerary.pdf")
  assert.equal(compared.outcome, "unknown")
  assert.equal(compared.detail.return_date.revised_quote.length, 2)
})

test("a corrected delay of 3 hours fails and keeps the letter quote", () => {
  const result = bundle({ corrections: [{ factKey: "delay-letter.pdf#hours", value: "3" }] })
  const delay = outcome(result, "delay")
  assert.equal(delay.outcome, "fail")
  assert.equal(delay.detail.hours, 3)
  assert.equal(delay.detail.quote.text, "Delay duration: 8 hours.")
  assert.equal(delay.detail.quote.source_file, "delay-letter.pdf")
})

test("a departure moved outside the seeded period fails coverage", () => {
  const result = bundle({ corrections: [{ factKey: "claim-form.pdf#SC101#departure_date", value: "2026-06-01" }] })
  const coverage = outcome(result, "coverage")
  assert.equal(coverage.outcome, "fail")
  assert.equal(coverage.detail.legs[0].departure_date, "2026-06-01")
  assert.equal(coverage.detail.legs[0].quote.text, "1 August 2026")
  assert.equal(coverage.detail.legs[0].quote.source_file, "claim-form.pdf")
})

test("a corrected claim type other than flight delay fails", () => {
  const result = bundle({ corrections: [{ factKey: "claim-form.pdf#claim_type", value: "baggage" }] })
  const claimType = outcome(result, "claim_type")
  assert.equal(claimType.outcome, "fail")
  assert.equal(claimType.detail.value, "baggage")
  assert.equal(claimType.detail.quote.text, "Claim type: Flight delay")
  assert.equal(claimType.detail.quote.source_file, "claim-form.pdf")
})

test("correcting one Singapore date leaves the other date unknown", () => {
  const revised = [...flights, { flight: "SC303", date: "8 August 2026", from: "BKK", to: "SIN" }]
  const result = bundle({
    revised,
    corrections: [{ factKey: "revised-itinerary.pdf#SC303#departure_date", value: "2026-08-09" }],
  })
  const filing = outcome(result, "filing_deadline")
  assert.equal(filing.outcome, "unknown")
  assert.equal(filing.detail.revised_arrival, null)
  assert.deepEqual(
    filing.detail.revised_quote.map((quote) => quote.text),
    ["7 August 2026", "8 August 2026"],
  )
})

test("a repeated flight number keeps the original date in the fact key", () => {
  const doubled = [
    { flight: "SC101", date: "1 August 2026", from: "SIN", to: "NRT" },
    { flight: "SC101", date: "7 August 2026", from: "NRT", to: "SIN" },
  ]
  const result = bundle({
    flights: doubled,
    corrections: [{ factKey: "claim-form.pdf#SC101#2026-08-01#destination", value: "BKK" }],
  })
  const destinations = result.facts.filter((fact) => fact.sourceFile === "claim-form.pdf" && fact.field === "destination")
  assert.deepEqual(
    destinations.map((fact) => [fact.factKey, fact.originalValue]),
    [
      ["claim-form.pdf#SC101#2026-08-01#destination", "NRT"],
      ["claim-form.pdf#SC101#2026-08-07#destination", "SIN"],
    ],
  )
  const coverage = outcome(result, "coverage")
  assert.equal(coverage.detail.legs[0].destination, "BKK")
  assert.equal(coverage.detail.legs[1].destination, "SIN")
  const ignored = bundle({
    flights: doubled,
    corrections: [{ factKey: "claim-form.pdf#leg:0#destination", value: "BKK" }],
  })
  assert.equal(outcome(ignored, "coverage").detail.legs[0].destination, "NRT")
})

test("the same flight and date keep the route in the fact key", () => {
  const doubled = [
    { flight: "SC101", date: "1 August 2026", from: "SIN", to: "NRT" },
    { flight: "SC101", date: "1 August 2026", from: "NRT", to: "SIN" },
  ]
  const result = bundle({
    flights: doubled,
    corrections: [{ factKey: "claim-form.pdf#SC101#2026-08-01#SIN#NRT#destination", value: "BKK" }],
  })
  const destinations = result.facts.filter((fact) => fact.sourceFile === "claim-form.pdf" && fact.field === "destination")
  assert.deepEqual(
    destinations.map((fact) => [fact.factKey, fact.originalValue]),
    [
      ["claim-form.pdf#SC101#2026-08-01#SIN#NRT#destination", "NRT"],
      ["claim-form.pdf#SC101#2026-08-01#NRT#SIN#destination", "SIN"],
    ],
  )
  const coverage = outcome(result, "coverage")
  assert.equal(coverage.detail.legs[0].destination, "BKK")
  assert.equal(coverage.detail.legs[1].destination, "SIN")
  const identical = bundle({
    flights: [
      { flight: "SC101", date: "1 August 2026", from: "SIN", to: "NRT" },
      { flight: "SC101", date: "1 August 2026", from: "SIN", to: "NRT" },
    ],
    corrections: [{ factKey: "claim-form.pdf#SC101#2026-08-01#SIN#NRT#destination", value: "BKK" }],
  })
  const shared = identical.facts.filter((fact) => fact.sourceFile === "claim-form.pdf" && fact.field === "destination")
  assert.deepEqual(shared.map((fact) => fact.factKey), ["claim-form.pdf#SC101#2026-08-01#SIN#NRT#destination"])
  const sharedCoverage = outcome(identical, "coverage")
  assert.equal(sharedCoverage.detail.legs[0].destination, "BKK")
  assert.equal(sharedCoverage.detail.legs[1].destination, "BKK")
})

test("one departure on a shared flight and date leaves the other leg", () => {
  const doubled = [
    { flight: "SC101", date: "1 August 2026", from: "SIN", to: "NRT" },
    { flight: "SC101", date: "1 August 2026", from: "NRT", to: "SIN" },
  ]
  const result = bundle({
    flights: doubled,
    corrections: [{ factKey: "claim-form.pdf#SC101#2026-08-01#SIN#NRT#departure_date", value: "2026-08-02" }],
  })
  const coverage = outcome(result, "coverage")
  assert.equal(coverage.detail.legs[0].departure_date, "2026-08-02")
  assert.equal(coverage.detail.legs[0].flight_number, "SC101")
  assert.equal(coverage.detail.legs[0].origin, "SIN")
  assert.equal(coverage.detail.legs[0].destination, "NRT")
  assert.equal(coverage.detail.legs[0].quote.text, "1 August 2026")
  assert.equal(coverage.detail.legs[1].departure_date, "2026-08-01")
  assert.equal(coverage.detail.legs[1].origin, "NRT")
  assert.equal(coverage.detail.legs[1].destination, "SIN")
  const renamed = bundle({
    flights: doubled,
    corrections: [
      { factKey: "claim-form.pdf#SC101#2026-08-01#SIN#NRT#flight_number", value: "SC999" },
      { factKey: "claim-form.pdf#SC101#2026-08-01#SIN#NRT#departure_date", value: "2026-08-02" },
    ],
  })
  const renamedCoverage = outcome(renamed, "coverage")
  assert.equal(renamedCoverage.detail.legs[0].flight_number, "SC999")
  assert.equal(renamedCoverage.detail.legs[0].departure_date, "2026-08-02")
  assert.equal(renamedCoverage.detail.legs[1].flight_number, "SC101")
  assert.equal(renamedCoverage.detail.legs[1].departure_date, "2026-08-01")
})

test("copying one Singapore date onto the other leaves filing unknown", () => {
  const revised = [...flights, { flight: "SC303", date: "8 August 2026", from: "BKK", to: "SIN" }]
  const copied = bundle({
    revised,
    corrections: [{ factKey: "revised-itinerary.pdf#SC303#departure_date", value: "2026-08-07" }],
  })
  const filing = outcome(copied, "filing_deadline")
  assert.equal(filing.outcome, "unknown")
  assert.equal(filing.detail.revised_arrival, null)
  assert.deepEqual(
    filing.detail.revised_quote.map((quote) => quote.text),
    ["7 August 2026", "8 August 2026"],
  )
})

test("a shared date that is neither conflicting value can agree", () => {
  const revised = [...flights, { flight: "SC303", date: "8 August 2026", from: "BKK", to: "SIN" }]
  const agreed = bundle({
    revised,
    corrections: [
      { factKey: "revised-itinerary.pdf#SC202#departure_date", value: "2026-08-09" },
      { factKey: "revised-itinerary.pdf#SC303#departure_date", value: "2026-08-09" },
      { factKey: "claim-form.pdf#return_date", value: "2026-08-09" },
    ],
  })
  const filing = outcome(agreed, "filing_deadline")
  assert.equal(filing.detail.revised_arrival, "2026-08-09")
  assert.equal(filing.detail.return_date, "2026-08-09")
  assert.equal(filing.outcome, "pass")
  assert.equal(filing.detail.revised_quote.text, "7 August 2026")
})

test("delay detail omits page numbers that stay on the fact", () => {
  const result = assessClaim({
    receivedAt: "2026-08-12T09:00:00+08:00",
    policy,
    documents: [
      {
        sourceFile: "delay-letter.pdf",
        items: [
          { text: "The flight was delayed because of a late inbound aircraft.", pageNumber: 2 },
          { text: "Delay duration: 8 hours.", pageNumber: 1 },
        ],
      },
    ],
  })
  const delay = outcome(result, "delay")
  assert.equal(Object.hasOwn(delay.detail, "hoursPage"), false)
  assert.equal(Object.hasOwn(delay.detail, "reasonPage"), false)
  assert.equal(result.facts.find((fact) => fact.field === "hours").pageNumber, 1)
  assert.equal(result.facts.find((fact) => fact.field === "reason").pageNumber, 2)
})

test("quotes ignore a page that is not quotable", () => {
  const items = [
    { document_id: "doc", page_number: 1, text: "Delay duration: 8 hours." },
    { document_id: "doc", page_number: 2, text: "Delay duration: 3 hours." },
  ]
  const kept = quotableItems(items, [{ document_id: "doc", page_number: 1 }])
  assert.deepEqual(kept.map((entry) => entry.text), ["Delay duration: 8 hours."])
})
