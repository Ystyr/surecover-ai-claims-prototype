import assert from "node:assert/strict"
import test from "node:test"

import { claimFormIdentity, claimReferenceInSubject, emailAddress, isDemoReference, liveClaimReference } from "./inbound.ts"

test("a sender address is read from a bare address or a named address", () => {
  assert.equal(emailAddress("jamie.lee@example.com"), "jamie.lee@example.com")
  assert.equal(emailAddress("Jamie Lee <Jamie.Lee@Example.com>"), "jamie.lee@example.com")
  assert.equal(emailAddress("Jamie Lee"), null)
})

test("a subject names one claim reference", () => {
  assert.equal(claimReferenceInSubject("Re: Information requested for CLM-DEMO-1002"), "CLM-DEMO-1002")
  assert.equal(claimReferenceInSubject("Re: Information requested for clm-live-abc123"), "CLM-LIVE-ABC123")
  assert.equal(claimReferenceInSubject("Flight delay documents"), null)
  assert.equal(isDemoReference("CLM-DEMO-1001"), true)
  assert.equal(isDemoReference("CLM-LIVE-ABC12345"), false)
})

test("a live reference is stable and a short email id is refused", () => {
  assert.equal(liveClaimReference("dry-run-complete-20261017"), "CLM-LIVE-DRYRUNCOMPLE")
  assert.equal(liveClaimReference("dry-run-complete-20261017"), liveClaimReference("dry-run-complete-20261017"))
  assert.equal(liveClaimReference("short"), null)
})

test("a claim form supplies the name, policy, and return date", () => {
  assert.deepEqual(
    claimFormIdentity([
      { text: "Claimant: Jamie Lee" },
      { text: "Policy reference: SC-DEMO-1001" },
      { text: "Return to Singapore: Friday 7 August 2026" },
    ]),
    { claimantName: "Jamie Lee", policyReference: "SC-DEMO-1001", returnDate: "2026-08-07" },
  )
  assert.equal(claimFormIdentity([{ text: "Claimant: Jamie Lee" }]), null)
})
