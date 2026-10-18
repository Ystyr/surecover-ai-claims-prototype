import { parseDisplayDate } from "../checks/assess.mjs"

export function senderName(from: string) {
  const named = from.trim().match(/^([^<]+)</)
  const name = named?.[1]?.trim().replace(/^["']|["']$/g, "") ?? ""
  if (!name || name.includes("@")) return null
  return name
}

export function emailAddress(from: string) {
  const trimmed = from.trim()
  const wrapped = trimmed.match(/<([^<>\s]+@[^<>\s]+)>/)
  const bare = trimmed.match(/^([^<>\s]+@[^<>\s]+)$/)
  const value = (wrapped?.[1] ?? bare?.[1] ?? "").toLowerCase()
  return value.includes("@") ? value : null
}

export function claimReferenceInSubject(subject: string) {
  const match = subject.toUpperCase().match(/\b(CLM-[A-Z0-9]+(?:-[A-Z0-9]+)*)\b/)
  return match?.[1] ?? null
}

export function isDemoReference(reference: string) {
  return reference.startsWith("CLM-DEMO-")
}

export function liveClaimReference(providerEmailId: string) {
  const compact = providerEmailId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
  if (compact.length < 8) return null
  return `CLM-LIVE-${compact.slice(0, 12)}`
}

export function claimFormIdentity(items: { text: string }[]) {
  const claimantName = labeled(items, "Claimant:")
  const policyReference = labeled(items, "Policy reference:")
  const returnLine = items.find((item) => /^Return to Singapore:/i.test(item.text.trim()))
  const returnDate = returnLine ? parseDisplayDate(returnLine.text) : null
  if (!claimantName || !policyReference || !returnDate) return null
  return { claimantName, policyReference, returnDate }
}

function labeled(items: { text: string }[], prefix: string) {
  const item = items.find((entry) => entry.text.trim().toLowerCase().startsWith(prefix.toLowerCase()))
  if (!item) return null
  const value = item.text.trim().slice(prefix.length).trim()
  return value.length > 0 ? value : null
}
