import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import test from "node:test"

import { acceptedAttachment, listReceivedAttachments, sendResendEmail, verifyResendSignature } from "./email.ts"

const secret = `whsec_${Buffer.from("test-secret-key-32-bytes-long!!").toString("base64")}`

function sign(payload: string, timestamp: string) {
  const key = Buffer.from(secret.slice("whsec_".length), "base64")
  return createHmac("sha256", key).update(`msg_test.${timestamp}.${payload}`).digest("base64")
}

test("a current Resend signature matches and a changed body does not", () => {
  const payload = JSON.stringify({ type: "email.received" })
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = `v1,${sign(payload, timestamp)}`
  assert.equal(verifyResendSignature({ payload, secret, id: "msg_test", timestamp, signature }), true)
  assert.equal(verifyResendSignature({ payload: `${payload} `, secret, id: "msg_test", timestamp, signature }), false)
  assert.equal(
    verifyResendSignature({
      payload,
      secret,
      id: "msg_test",
      timestamp: String(Math.floor(Date.now() / 1000) - 600),
      signature,
    }),
    false,
  )
})

test("pdf and png attachments are kept and other types are not", () => {
  assert.deepEqual(acceptedAttachment({ filename: "claim-form.pdf", contentType: "application/pdf", size: 10 }), {
    filename: "claim-form.pdf",
    contentType: "application/pdf",
  })
  assert.equal(acceptedAttachment({ filename: "notes.txt", contentType: "text/plain", size: 10 }), null)
  assert.equal(acceptedAttachment({ filename: "huge.pdf", contentType: "application/pdf", size: 26_214_401 }), null)
})

test("a Resend send returns the provider id and does not send without a success", async () => {
  const sent = await sendResendEmail({
    apiKey: "test-key",
    from: "claims@example.com",
    to: "jamie.lee@example.com",
    subject: "Received CLM-DEMO-1005",
    text: "We received claim CLM-DEMO-1005.",
    fetchImpl: async () => new Response(JSON.stringify({ id: "re_123" }), { status: 200 }),
  })
  assert.equal(sent, "re_123")
  await assert.rejects(
    sendResendEmail({
      apiKey: "test-key",
      from: "claims@example.com",
      to: "jamie.lee@example.com",
      subject: "Received CLM-DEMO-1005",
      text: "We received claim CLM-DEMO-1005.",
      fetchImpl: async () => new Response("no", { status: 403 }),
    }),
    /resend send failed/,
  )
})

test("attachment listing keeps only accepted files with a download url", async () => {
  const files = await listReceivedAttachments({
    apiKey: "test-key",
    emailId: "email-1",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          data: [
            { filename: "claim-form.pdf", content_type: "application/pdf", size: 12, download_url: "https://files.example/form" },
            { filename: "notes.txt", content_type: "text/plain", size: 4, download_url: "https://files.example/notes" },
          ],
        }),
        { status: 200 },
      ),
  })
  assert.deepEqual(files, [{ filename: "claim-form.pdf", contentType: "application/pdf", downloadUrl: "https://files.example/form" }])
})
