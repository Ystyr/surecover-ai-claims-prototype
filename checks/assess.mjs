// Deterministic demo-2026.1 checks. Document roles come from the fixture
// filenames. The stored Jev label is not read by these checks.
export const ADAPTER = "fixture"
export const CHOICE_GATE = 0.6
export const MINIMUM_DELAY_HOURS = 6
export const CHECK_NAMES = [
  "completeness",
  "filing_deadline",
  "coverage",
  "claim_type",
  "consistency",
  "delay",
]

export const FIXTURE_ROLES = {
  "claim-form.pdf": "claim_form",
  "scheduled-itinerary.pdf": "scheduled_itinerary",
  "revised-itinerary.pdf": "revised_itinerary",
  "boarding-pass-sc101.pdf": "boarding_pass",
  "boarding-pass-sc101.png": "boarding_pass",
  "boarding-pass-sc202.pdf": "boarding_pass",
  "delay-letter.pdf": "delay_letter",
}

const REQUIRED_ROLES = [
  ["claim_form", "claim form"],
  ["scheduled_itinerary", "scheduled itinerary"],
  ["revised_itinerary", "revised itinerary"],
  ["delay_letter", "delay letter"],
]

const MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
}

const MONTH_NAMES = [
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

export function quotableItems(items, pages) {
  const allowed = new Set(pages.map((page) => `${page.document_id}:${page.page_number}`))
  return items.filter((item) => allowed.has(`${item.document_id}:${item.page_number}`))
}

export function singaporeDate(instant) {
  const date = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const year = parts.find((part) => part.type === "year").value
  const month = parts.find((part) => part.type === "month").value
  const day = parts.find((part) => part.type === "day").value
  return `${year}-${month}-${day}`
}

export function parseDisplayDate(text) {
  const match = normalize(text).match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/)
  if (!match) return null
  const month = MONTHS[match[2].toLowerCase()]
  const day = Number(match[1])
  const year = Number(match[3])
  if (!month || day < 1 || day > 31) return null
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  const check = new Date(Date.UTC(year, month - 1, day))
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null
  }
  return iso
}

export function displayDate(iso) {
  const [year, month, day] = iso.split("-").map(Number)
  return `${day} ${MONTH_NAMES[month - 1]} ${year}`
}

const LEG_FIELDS = ["flight_number", "departure_date", "origin", "destination"]

export function factKey(sourceFile, field, flight = null) {
  if (!flight) return `${sourceFile}#${field}`
  if (flight.sameDate) {
    return `${sourceFile}#${flight.flightNumber}#${flight.departureDate}#${flight.origin}#${flight.destination}#${field}`
  }
  if (flight.duplicate) return `${sourceFile}#${flight.flightNumber}#${flight.departureDate}#${field}`
  return `${sourceFile}#${flight.flightNumber}#${field}`
}

export function validateFactValue(field, value) {
  const text = normalize(value)
  if (!text) return null
  if (field === "flight_number") return flightNumber(text)
  if (field === "departure_date" || field === "return_date") return parseDisplayDate(text) ?? isoDate(text)
  if (field === "origin" || field === "destination") return iata(text)
  if (field === "hours") {
    if (!/^[0-9]+(?:\.[0-9]+)?$/.test(text)) return null
    const hours = Number(text)
    if (!Number.isFinite(hours) || hours < 0) return null
    return String(hours)
  }
  if (field === "claim_type" || field === "reason") return text
  return null
}

/**
 * @param {{
 *   receivedAt: string,
 *   policy: { coverage_start?: string, coverage_end?: string, public_holidays?: unknown },
 *   documents: { sourceFile?: string, items?: { text: string, pageNumber?: number }[] }[],
 *   corrections?: { factKey?: string, fact_key?: string, value?: string, corrected_value?: string }[],
 * }} input
 */
export function assessClaim({ receivedAt, policy, documents, corrections = [] }) {
  const parsed = parseDocuments(documents)
  applyCorrections(parsed, corrections)
  const arrival = singaporeArrival(parsed.revisedLegs.legs)
  return {
    adapter: ADAPTER,
    facts: parsed.facts,
    checks: [
      completeness({
        prepared: parsed.prepared,
        unclassified: parsed.unclassified,
        formLegs: parsed.formLegs,
        passLegs: parsed.passLegs,
      }),
      filingDeadline({ receivedAt, policy, returnDate: parsed.returnDate, arrival }),
      coverage({ policy, formLegs: parsed.formLegs }),
      claimTypeCheck({ prepared: parsed.prepared, claimType: parsed.claimType }),
      consistency({ formLegs: parsed.formLegs, passLegs: parsed.passLegs, returnDate: parsed.returnDate, arrival }),
      delayCheck(parsed.delay),
    ],
  }
}

function parseDocuments(documents) {
  const prepared = documents.map((document) => ({
    ...document,
    role: establishedRole(document),
  }))
  const form = prepared.find((document) => document.role === "claim_form")
  const revised = prepared.find((document) => document.role === "revised_itinerary")
  const letter = prepared.find((document) => document.role === "delay_letter")
  const passes = prepared.filter((document) => document.role === "boarding_pass")
  const parsed = {
    prepared,
    unclassified: prepared.some((document) => document.role === null),
    form,
    revised,
    letter,
    formLegs: form ? readLegs(form) : { legs: [], unreadable: false },
    revisedLegs: revised ? readLegs(revised) : { legs: [], unreadable: false },
    passLegs: passes.map((document) => ({ document, ...readLegs(document) })),
    returnDate: form ? readReturnDate(form) : null,
    claimType: form ? readClaimType(form) : null,
    delay: letter ? readDelay(letter) : readDelay(null),
    facts: [],
  }
  if (parsed.form) assignFactKeys(parsed.form.sourceFile, parsed.formLegs.legs)
  if (parsed.revised) assignFactKeys(parsed.revised.sourceFile, parsed.revisedLegs.legs)
  for (const pass of parsed.passLegs) assignFactKeys(pass.document.sourceFile, pass.legs)
  parsed.facts = collectFacts(parsed)
  return parsed
}

function assignFactKeys(sourceFile, legs) {
  const flightCounts = new Map()
  const routeCounts = new Map()
  for (const leg of legs) {
    flightCounts.set(leg.flight_number, (flightCounts.get(leg.flight_number) ?? 0) + 1)
    const route = `${leg.flight_number}#${leg.departure_date}`
    routeCounts.set(route, (routeCounts.get(route) ?? 0) + 1)
  }
  for (const leg of legs) {
    const route = `${leg.flight_number}#${leg.departure_date}`
    const flight = {
      flightNumber: leg.flight_number,
      departureDate: leg.departure_date,
      origin: leg.origin,
      destination: leg.destination,
      duplicate: (flightCounts.get(leg.flight_number) ?? 0) > 1,
      sameDate: (routeCounts.get(route) ?? 0) > 1,
    }
    leg.originalDepartureDate = leg.departure_date
    leg.factKeyFor = (field) => factKey(sourceFile, field, flight)
  }
}

function collectFacts(parsed) {
  const facts = []
  const addLegs = (sourceFile, legs) => {
    legs.forEach((entry, index) => {
      for (const field of LEG_FIELDS) {
        const source = entry.sources?.[field]
        facts.push({
          factKey: entry.factKeyFor(field),
          sourceFile,
          field,
          legIndex: index,
          originalValue: String(entry[field]),
          quoteText: source?.text ?? null,
          pageNumber: source?.pageNumber ?? null,
        })
      }
    })
  }
  if (parsed.form) addLegs(parsed.form.sourceFile, parsed.formLegs.legs)
  if (parsed.revised) addLegs(parsed.revised.sourceFile, parsed.revisedLegs.legs)
  for (const pass of parsed.passLegs) addLegs(pass.document.sourceFile, pass.legs)
  if (parsed.form && parsed.returnDate) {
    facts.push({
      factKey: factKey(parsed.form.sourceFile, "return_date"),
      sourceFile: parsed.form.sourceFile,
      field: "return_date",
      legIndex: null,
      originalValue: parsed.returnDate.date,
      quoteText: parsed.returnDate.quote?.text ?? null,
      pageNumber: parsed.returnDate.pageNumber ?? null,
    })
  }
  if (parsed.form && parsed.claimType) {
    facts.push({
      factKey: factKey(parsed.form.sourceFile, "claim_type"),
      sourceFile: parsed.form.sourceFile,
      field: "claim_type",
      legIndex: null,
      originalValue: parsed.claimType.value,
      quoteText: parsed.claimType.quote?.text ?? null,
      pageNumber: parsed.claimType.pageNumber ?? null,
    })
  }
  if (parsed.letter && parsed.delay?.hours !== null && parsed.delay?.hours !== undefined) {
    facts.push({
      factKey: factKey(parsed.letter.sourceFile, "hours"),
      sourceFile: parsed.letter.sourceFile,
      field: "hours",
      legIndex: null,
      originalValue: String(parsed.delay.hours),
      quoteText: parsed.delay.quote?.text ?? null,
      pageNumber: parsed.delay.hoursPage ?? null,
    })
  }
  if (parsed.letter && parsed.delay?.reason) {
    facts.push({
      factKey: factKey(parsed.letter.sourceFile, "reason"),
      sourceFile: parsed.letter.sourceFile,
      field: "reason",
      legIndex: null,
      originalValue: parsed.delay.reason,
      quoteText: parsed.delay.reason_quote?.text ?? null,
      pageNumber: parsed.delay.reasonPage ?? null,
    })
  }
  const seen = new Set()
  return facts.filter((fact) => {
    if (seen.has(fact.factKey)) return false
    seen.add(fact.factKey)
    return true
  })
}

function applyCorrections(parsed, corrections) {
  const values = new Map()
  for (const correction of corrections) {
    const key = correction.factKey ?? correction.fact_key
    const value = correction.value ?? correction.corrected_value
    if (typeof key === "string" && value !== undefined && value !== null) values.set(key, String(value))
  }
  const applyLegs = (sourceFile, legs) => {
    if (!sourceFile) return
    legs.forEach((entry) => {
      for (const field of LEG_FIELDS) {
        const value = values.get(entry.factKeyFor?.(field))
        if (value !== undefined) entry[field] = value
      }
    })
  }
  if (parsed.form) applyLegs(parsed.form.sourceFile, parsed.formLegs.legs)
  if (parsed.revised) applyLegs(parsed.revised.sourceFile, parsed.revisedLegs.legs)
  for (const pass of parsed.passLegs) applyLegs(pass.document.sourceFile, pass.legs)
  if (parsed.form && parsed.returnDate) {
    const date = values.get(factKey(parsed.form.sourceFile, "return_date"))
    if (date !== undefined) parsed.returnDate.date = date
  }
  if (parsed.form && parsed.claimType) {
    const value = values.get(factKey(parsed.form.sourceFile, "claim_type"))
    if (value !== undefined) {
      parsed.claimType.value = value
      parsed.claimType.flight_delay = isFlightDelay(value)
    }
  }
  if (parsed.letter && parsed.delay) {
    const hours = values.get(factKey(parsed.letter.sourceFile, "hours"))
    if (hours !== undefined) {
      const parsedHours = Number(hours)
      parsed.delay.hours = parsedHours
      parsed.delay.outcome = parsedHours >= MINIMUM_DELAY_HOURS ? "pass" : "fail"
    }
    const reason = values.get(factKey(parsed.letter.sourceFile, "reason"))
    if (reason !== undefined) parsed.delay.reason = reason
  }
}

function isoDate(text) {
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null
  return text
}

function isFlightDelay(value) {
  return normalize(value).replace(/_/g, " ").replace(/\s+/g, " ").toLowerCase() === "flight delay"
}

function completeness({ prepared, unclassified, formLegs, passLegs }) {
  const roles = new Set(prepared.map((document) => document.role).filter(Boolean))
  const missing = REQUIRED_ROLES.filter(([role]) => !roles.has(role)).map(([, label]) => label)
  if (missing.length > 0) {
    return check("completeness", unclassified ? "unknown" : "fail", {
      gaps: missing,
      unclassified,
      ...(unclassified ? { reason: "A file is present but its document type is not established." } : {}),
    })
  }

  if (roles.has("claim_form") && (formLegs.unreadable || formLegs.legs.length === 0)) {
    return check("completeness", "unknown", {
      gaps: [],
      unclassified,
      reason: "The affected flights could not be read.",
    })
  }

  const gaps = []
  for (const flight of formLegs.legs) {
    const matched = passLegs.some((pass) =>
      pass.legs.some(
        (leg) => leg.flight_number === flight.flight_number && leg.departure_date === flight.departure_date,
      ),
    )
    if (!matched) gaps.push(flightGap(flight))
  }

  if (unclassified && gaps.length > 0) {
    return check("completeness", "unknown", {
      gaps,
      unclassified: true,
      reason: "A file is present but its document type is not established.",
    })
  }
  if (gaps.length > 0) return check("completeness", "fail", { gaps, unclassified: false })
  return check("completeness", "pass", { gaps: [], unclassified: false })
}

function filingDeadline({ receivedAt, policy, returnDate, arrival }) {
  const receivedDate = singaporeDate(receivedAt)
  const holidays = policy?.public_holidays ?? null
  if (!returnDate || !receivedDate || !holidays) {
    return check("filing_deadline", "unknown", {
      return_date: returnDate?.date ?? null,
      return_quote: returnDate?.quote ?? null,
      received_date: receivedDate,
      revised_arrival: arrival?.date ?? null,
      revised_quote: arrival?.quote ?? null,
    })
  }
  if (arrival && arrival.date !== returnDate.date) {
    return check("filing_deadline", "unknown", {
      return_date: returnDate.date,
      return_quote: returnDate.quote,
      revised_arrival: arrival.date,
      revised_quote: arrival.quote,
      received_date: receivedDate,
    })
  }
  const deadline = deadlineDate(returnDate.date, holidays)
  const workingDays = workingDayCount(returnDate.date, receivedDate, holidays)
  return check("filing_deadline", receivedDate <= deadline ? "pass" : "fail", {
    return_date: returnDate.date,
    return_quote: returnDate.quote,
    revised_arrival: arrival?.date ?? null,
    revised_quote: arrival?.quote ?? null,
    received_date: receivedDate,
    working_days: workingDays,
    deadline,
  })
}

function coverage({ policy, formLegs }) {
  if (!policy?.coverage_start || !policy?.coverage_end) {
    return check("coverage", "unknown", { reason: "The policy record is missing." })
  }
  const legs = formLegs.legs.map((flight) => ({
    flight_number: flight.flight_number,
    departure_date: flight.departure_date,
    origin: flight.origin,
    destination: flight.destination,
    quote: flight.quotes[1],
    inside: flight.departure_date >= policy.coverage_start && flight.departure_date <= policy.coverage_end,
  }))
  if (legs.some((leg) => !leg.inside)) {
    return check("coverage", "fail", {
      coverage_start: policy.coverage_start,
      coverage_end: policy.coverage_end,
      legs,
    })
  }
  if (formLegs.unreadable || legs.length === 0) {
    return check("coverage", "unknown", {
      coverage_start: policy.coverage_start,
      coverage_end: policy.coverage_end,
      legs,
      reason: "A departure date could not be read.",
    })
  }
  return check("coverage", "pass", {
    coverage_start: policy.coverage_start,
    coverage_end: policy.coverage_end,
    legs,
  })
}

function claimTypeCheck({ prepared, claimType }) {
  if (claimType && !claimType.flight_delay) {
    return check("claim_type", "fail", {
      quote: claimType.quote,
      value: claimType.value,
    })
  }
  const letter = prepared.find((document) => document.role === "delay_letter")
  if (!letter) {
    const attempt = prepared.find((document) => (document.choice ?? FIXTURE_ROLES[document.sourceFile]) === "delay_letter" || document.choice === "other")
    return check("claim_type", "unknown", {
      quote: claimType?.quote ?? null,
      value: claimType?.value ?? null,
      label: attempt?.choice ?? null,
      choice_probability: attempt?.choiceProbability ?? null,
      reason: "The delay letter is missing, labeled other, or below the 0.60 gate.",
    })
  }
  if (!claimType) {
    return check("claim_type", "unknown", { reason: "The claim type field could not be read." })
  }
  return check("claim_type", "pass", {
    quote: claimType.quote,
    value: claimType.value,
    letter_source_file: letter.sourceFile,
  })
}

function consistency({ formLegs, passLegs, returnDate, arrival }) {
  const routes = []
  for (const flight of formLegs.legs) {
    for (const pass of passLegs) {
      for (const leg of pass.legs) {
        if (leg.flight_number !== flight.flight_number || leg.departure_date !== flight.departure_date) continue
        const same = leg.origin === flight.origin && leg.destination === flight.destination
        routes.push({
          flight_number: flight.flight_number,
          departure_date: flight.departure_date,
          form: { origin: flight.origin, destination: flight.destination, quote: flight.quotes.slice(2) },
          pass: { origin: leg.origin, destination: leg.destination, quote: leg.quotes.slice(2), source_file: pass.document.sourceFile },
          outcome: same ? "pass" : "unknown",
        })
      }
    }
  }
  const datesDisagree = Boolean(arrival) && (arrival.date == null || (returnDate && arrival.date !== returnDate.date))
  const dates = {
    form_return_date: returnDate?.date ?? null,
    form_quote: returnDate?.quote ?? null,
    revised_arrival: arrival?.date ?? null,
    revised_quote: arrival?.quote ?? null,
    outcome: datesDisagree ? "unknown" : "pass",
  }
  const outcome = routes.some((route) => route.outcome === "unknown") || dates.outcome === "unknown" ? "unknown" : "pass"
  return check("consistency", outcome, { routes, return_date: dates })
}

export function deadlineDate(returnDate, holidays) {
  const holidaySet = holidayDates(holidays)
  let cursor = returnDate
  let counted = 0
  while (counted < 30) {
    cursor = addDays(cursor, 1)
    if (!isWorkingDay(cursor, holidaySet)) continue
    counted += 1
  }
  return cursor
}

export function workingDayCount(returnDate, receivedDate, holidays) {
  if (receivedDate <= returnDate) return 0
  const holidaySet = holidayDates(holidays)
  let cursor = returnDate
  let counted = 0
  while (cursor < receivedDate) {
    cursor = addDays(cursor, 1)
    if (isWorkingDay(cursor, holidaySet)) counted += 1
  }
  return counted
}

function establishedRole(document) {
  const fallback = FIXTURE_ROLES[document.sourceFile] ?? null
  const choice = document.choice === undefined ? fallback : document.choice
  const probability = document.choiceProbability === undefined ? (choice ? 1 : 0) : document.choiceProbability
  if (!choice || choice === "other" || !(probability >= CHOICE_GATE)) return null
  return choice
}

function readLegs(document) {
  const items = document.items ?? []
  let read = { legs: readLabeledPass(items), unreadable: false }
  if (read.legs.length === 0) {
    const table = readTable(items)
    read = table.legs.length > 0 || table.unreadable ? table : { legs: readPhotoPass(items), unreadable: false }
  }
  const sourceFile = document.sourceFile ?? null
  return {
    unreadable: read.unreadable,
    legs: read.legs.map((entry) => ({
      ...entry,
      quotes: entry.quotes.map((text) => storedQuote(text, sourceFile)),
    })),
  }
}

function storedQuote(text, sourceFile) {
  if (typeof text !== "string" || text.length === 0) return null
  return { text, source_file: sourceFile ?? null }
}

function readLabeledPass(items) {
  const flightItem = items.find((item) => /^Flight:\s*\S+/i.test(normalize(item.text)))
  const dateItem = items.find((item) => /^Date:\s+/i.test(normalize(item.text)))
  const fromItem = items.find((item) => /^From:\s+/i.test(normalize(item.text)))
  const toItem = items.find((item) => /^To:\s+/i.test(normalize(item.text)))
  if (!flightItem || !dateItem || !fromItem || !toItem) return []
  const flight = flightNumber(normalize(flightItem.text).replace(/^Flight:\s*/i, ""))
  const date = parseDisplayDate(dateItem.text)
  const origin = iata(normalize(fromItem.text).replace(/^From:\s*/i, ""))
  const destination = iata(normalize(toItem.text).replace(/^To:\s*/i, ""))
  if (!flight || !date || !origin || !destination) return []
  return [
    leg(flight, date, origin, destination, [flightItem.text, dateItem.text, fromItem.text, toItem.text], {
      flight_number: fieldSource(flightItem),
      departure_date: fieldSource(dateItem),
      origin: fieldSource(fromItem),
      destination: fieldSource(toItem),
    }),
  ]
}

function readTable(items) {
  for (let index = 0; index < items.length - 3; index += 1) {
    if (!isLabel(items[index], "flight") || !isLabel(items[index + 1], "date") || !isLabel(items[index + 2], "from") || !isLabel(items[index + 3], "to")) {
      continue
    }
    const legs = []
    let unreadable = false
    let cursor = index + 4
    while (cursor + 3 < items.length) {
      const flight = flightNumber(items[cursor].text)
      const date = parseDisplayDate(items[cursor + 1].text)
      const origin = iata(items[cursor + 2].text)
      const destination = iata(items[cursor + 3].text)
      if (flight && date && origin && destination) {
        const cells = items.slice(cursor, cursor + 4)
        legs.push(
          leg(
            flight,
            date,
            origin,
            destination,
            cells.map((item) => item.text),
            {
              flight_number: fieldSource(cells[0]),
              departure_date: fieldSource(cells[1]),
              origin: fieldSource(cells[2]),
              destination: fieldSource(cells[3]),
            },
          ),
        )
        cursor += 4
        continue
      }
      if (flight) {
        unreadable = true
        cursor += 4
        continue
      }
      break
    }
    return { legs, unreadable }
  }
  return { legs: [], unreadable: false }
}

function readPhotoPass(items) {
  for (let index = 0; index < items.length - 7; index += 1) {
    if (!isLabel(items[index], "flight") || !isLabel(items[index + 1], "date")) continue
    if (!isLabel(items[index + 4], "from") || !isLabel(items[index + 5], "to")) continue
    const flight = flightNumber(items[index + 2].text)
    const date = parseDisplayDate(items[index + 3].text)
    const origin = iata(items[index + 6].text)
    const destination = iata(items[index + 7].text)
    if (!flight || !date || !origin || !destination) continue
    return [
      leg(
        flight,
        date,
        origin,
        destination,
        [items[index + 2].text, items[index + 3].text, items[index + 6].text, items[index + 7].text],
        {
          flight_number: fieldSource(items[index + 2]),
          departure_date: fieldSource(items[index + 3]),
          origin: fieldSource(items[index + 6]),
          destination: fieldSource(items[index + 7]),
        },
      ),
    ]
  }
  return []
}

function readReturnDate(document) {
  const item = (document.items ?? []).find((entry) => /^Return to Singapore:/i.test(normalize(entry.text)))
  if (!item) return null
  const date = parseDisplayDate(item.text)
  if (!date) return null
  return { date, quote: storedQuote(item.text, document.sourceFile), pageNumber: pageNumber(item) }
}

function readClaimType(document) {
  const item = (document.items ?? []).find((entry) => /^Claim type:/i.test(normalize(entry.text)))
  if (!item) return null
  const value = normalize(item.text).replace(/^Claim type:\s*/i, "")
  return {
    value,
    flight_delay: isFlightDelay(value),
    quote: storedQuote(item.text, document.sourceFile),
    pageNumber: pageNumber(item),
  }
}

function delayCheck(delay) {
  const detail = { ...delay }
  delete detail.hoursPage
  delete detail.reasonPage
  return check("delay", delay.outcome, detail)
}

function readDelay(document) {
  const items = document?.items ?? []
  const durationItem = items.find((item) => /delay duration:/i.test(item.text))
  const reasonItem = items.find((item) => /delayed because of /i.test(item.text))
  const reasonMatch = reasonItem ? normalize(reasonItem.text).match(/delayed because of (?:a\s+)?(.+?)(?:\.|$)/i) : null
  const sourceFile = document?.sourceFile ?? null
  const base = {
    minimum_hours: MINIMUM_DELAY_HOURS,
    minimum_label: "Fictional demo assumption",
    quote: storedQuote(durationItem?.text, sourceFile),
    hoursPage: durationItem ? pageNumber(durationItem) : null,
    reason: reasonMatch ? reasonMatch[1] : null,
    reason_quote: storedQuote(reasonItem?.text, sourceFile),
    reasonPage: reasonItem ? pageNumber(reasonItem) : null,
  }
  if (!durationItem) return { ...base, outcome: "unknown", hours: null }
  const match = normalize(durationItem.text).match(/delay duration:\s*([0-9]+(?:\.[0-9]+)?)\s*hours?\b/i)
  if (!match) return { ...base, outcome: "unknown", hours: null }
  const hours = Number(match[1])
  return { ...base, outcome: hours >= MINIMUM_DELAY_HOURS ? "pass" : "fail", hours }
}

function singaporeArrival(legs) {
  const arrivals = legs.filter((flight) => flight.destination === "SIN")
  if (arrivals.length === 0) return null
  const quotes = arrivals.map((flight) => flight.quotes[1])
  const dates = new Set(arrivals.map((flight) => flight.departure_date))
  if (dates.size !== 1) return { date: null, quote: quotes }
  const shared = arrivals[0].departure_date
  const originalDates = new Set(arrivals.map((flight) => flight.originalDepartureDate ?? flight.departure_date))
  const quoteTexts = new Set(quotes.filter((quote) => quote?.text).map((quote) => quote.text))
  if (quoteTexts.size > 1 && originalDates.size > 1 && originalDates.has(shared)) {
    return { date: null, quote: quotes }
  }
  return { date: shared, quote: quotes[0] }
}

function flightGap(flight) {
  return `${flight.flight_number} on ${displayDate(flight.departure_date)} from ${flight.origin} to ${flight.destination}`
}

function leg(flight, date, origin, destination, quotes, sources) {
  return { flight_number: flight, departure_date: date, origin, destination, quotes, sources }
}

function fieldSource(item) {
  return { text: item.text, pageNumber: pageNumber(item) }
}

function pageNumber(item) {
  const value = item?.pageNumber ?? item?.page_number
  return Number.isInteger(value) ? value : null
}

function check(checkName, outcome, detail) {
  return { check_name: checkName, outcome, detail }
}

function holidayDates(holidays) {
  return new Set(holidays.map((holiday) => (typeof holiday === "string" ? holiday : holiday.date)))
}

function isWorkingDay(iso, holidays) {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay()
  return day !== 0 && day !== 6 && !holidays.has(iso)
}

function addDays(iso, count) {
  const [year, month, day] = iso.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}

function flightNumber(text) {
  const value = normalize(text).toUpperCase().replace(/\s+/g, "")
  return /^[A-Z]{2}\d{2,4}$/.test(value) ? value : null
}

function iata(text) {
  const value = normalize(text).toUpperCase().replace(/\s+/g, "")
  return /^[A-Z]{3}$/.test(value) ? value : null
}

function isLabel(item, word) {
  return normalize(item?.text).toLowerCase() === word
}

function normalize(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim()
}
