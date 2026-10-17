import { createHmac, timingSafeEqual } from "node:crypto"

export const MAX_ATTACHMENT_BYTES = 26_214_400
const ACCEPTED_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"])
const SIGNATURE_WINDOW_MS = 5 * 60 * 1000

export function verifyResendSignature(input: {
  payload: string
  secret: string
  id: string | null
  timestamp: string | null
  signature: string | null
  now?: number
}) {
  if (!input.payload || !input.secret || !input.id || !input.timestamp || !input.signature) return false
  const seconds = Number(input.timestamp)
  if (!Number.isFinite(seconds)) return false
  const now = input.now ?? Date.now()
  if (Math.abs(now - seconds * 1000) > SIGNATURE_WINDOW_MS) return false
  const encoded = input.secret.startsWith("whsec_") ? input.secret.slice("whsec_".length) : input.secret
  const key = Buffer.from(encoded, "base64")
  if (key.length === 0) return false
  const expected = createHmac("sha256", key).update(`${input.id}.${input.timestamp}.${input.payload}`).digest("base64")
  return input.signature.split(" ").some((part) => {
    const split = part.indexOf(",")
    if (split === -1 || part.slice(0, split) !== "v1") return false
    const value = part.slice(split + 1)
    const actual = Buffer.from(value)
    const wanted = Buffer.from(expected)
    return actual.length === wanted.length && timingSafeEqual(actual, wanted)
  })
}

export function acceptedAttachment(file: { filename?: string; contentType?: string; size?: number }) {
  const filename = safeFilename(file.filename)
  const contentType = file.contentType && ACCEPTED_TYPES.has(file.contentType) ? file.contentType : typeFromName(filename)
  if (!filename || !contentType || !ACCEPTED_TYPES.has(contentType)) return null
  if (typeof file.size === "number" && (file.size < 0 || file.size > MAX_ATTACHMENT_BYTES)) return null
  return { filename, contentType }
}

export function safeFilename(value: string | undefined) {
  if (!value) return null
  const name = value.replaceAll("\\", "/").split("/").at(-1)?.replace(/["\r\n]/g, "").trim() ?? ""
  if (!name || name === "." || name === "..") return null
  return name
}

function typeFromName(filename: string | null) {
  const lower = filename?.toLowerCase() ?? ""
  if (lower.endsWith(".pdf")) return "application/pdf"
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  return null
}

export async function sendResendEmail(input: {
  apiKey: string
  from: string
  to: string
  subject: string
  text: string
  fetchImpl?: typeof fetch
}) {
  const fetchImpl = input.fetchImpl ?? fetch
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: input.from, to: [input.to], subject: input.subject, text: input.text }),
  })
  if (!response.ok) throw new Error("resend send failed")
  const body = (await response.json()) as { id?: unknown }
  if (typeof body.id !== "string" || body.id.trim().length === 0) throw new Error("resend send failed")
  return body.id
}

export async function listReceivedAttachments(input: { apiKey: string; emailId: string; fetchImpl?: typeof fetch }) {
  const fetchImpl = input.fetchImpl ?? fetch
  const response = await fetchImpl(`https://api.resend.com/emails/receiving/${encodeURIComponent(input.emailId)}/attachments`, {
    headers: { Authorization: `Bearer ${input.apiKey}` },
  })
  if (!response.ok) throw new Error("resend attachments failed")
  const body = (await response.json()) as { data?: unknown }
  if (!Array.isArray(body.data)) return []
  return body.data.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const row = entry as { filename?: unknown; content_type?: unknown; size?: unknown; download_url?: unknown }
    const accepted = acceptedAttachment({
      filename: typeof row.filename === "string" ? row.filename : undefined,
      contentType: typeof row.content_type === "string" ? row.content_type : undefined,
      size: typeof row.size === "number" ? row.size : undefined,
    })
    if (!accepted || typeof row.download_url !== "string" || row.download_url.length === 0) return []
    return [{ ...accepted, downloadUrl: row.download_url }]
  })
}
