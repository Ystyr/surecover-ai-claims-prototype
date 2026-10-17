import { spawn } from "node:child_process"

import { createClient } from "@supabase/supabase-js"
import { NextResponse, type NextRequest } from "next/server"

import { listReceivedAttachments, MAX_ATTACHMENT_BYTES, verifyResendSignature } from "@/lib/email"

const INBOUND_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function queueReceive(inboundId: string) {
  if (!INBOUND_ID.test(inboundId)) return
  const child = spawn(process.execPath, ["--experimental-strip-types", "supabase/seed/receive-mail.mjs", inboundId], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  })
  child.unref()
}

export async function POST(request: NextRequest) {
  const payload = await request.text()
  const secret = process.env.RESEND_WEBHOOK_SECRET
  const verified = Boolean(
    secret &&
      verifyResendSignature({
        payload,
        secret,
        id: request.headers.get("svix-id"),
        timestamp: request.headers.get("svix-timestamp"),
        signature: request.headers.get("svix-signature"),
      }),
  )
  if (!verified) return new NextResponse("Unauthorized", { status: 401 })

  let event: { type?: string; data?: { email_id?: string; from?: string; subject?: string } }
  try {
    event = JSON.parse(payload) as { type?: string; data?: { email_id?: string; from?: string; subject?: string } }
  } catch {
    return new NextResponse("Unauthorized", { status: 401 })
  }
  if (event.type !== "email.received") return new NextResponse("ok", { status: 200 })
  const emailId = event.data?.email_id?.trim()
  const from = event.data?.from?.trim()
  const subject = event.data?.subject?.trim() || "Received email"
  if (!emailId || !from) return new NextResponse("Unauthorized", { status: 401 })

  const url = process.env.SUPABASE_URL
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRole) return new NextResponse("unavailable", { status: 500 })
  const db = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })

  const existing = await db.from("inbound_messages").select("id").eq("provider_email_id", emailId).maybeSingle()
  if (existing.error) return new NextResponse("unavailable", { status: 500 })
  if (existing.data) return new NextResponse("ok", { status: 200 })

  const apiKey = process.env.RESEND_API_KEY
  if (apiKey) {
    try {
      const files = await listReceivedAttachments({ apiKey, emailId })
      for (const file of files) {
        const downloaded = await fetch(file.downloadUrl)
        if (!downloaded.ok) return new NextResponse("unavailable", { status: 500 })
        const bytes = new Uint8Array(await downloaded.arrayBuffer())
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) continue
        const uploaded = await db.storage.from("claim-files").upload(`inbound/${emailId}/${file.filename}`, bytes, {
          contentType: file.contentType,
          upsert: true,
        })
        if (uploaded.error) return new NextResponse("unavailable", { status: 500 })
      }
    } catch {
      return new NextResponse("unavailable", { status: 500 })
    }
  }

  const inserted = await db
    .from("inbound_messages")
    .insert({
      provider: "resend",
      provider_email_id: emailId,
      from_address: from,
      subject,
    })
    .select("id")
    .single()
  if (inserted.error) {
    if (inserted.error.code === "23505") {
      const existing = await db.from("inbound_messages").select("id, claim_id").eq("provider_email_id", emailId).maybeSingle()
      if (existing.data && !existing.data.claim_id) queueReceive(existing.data.id)
      return new NextResponse("ok", { status: 200 })
    }
    return new NextResponse("unavailable", { status: 500 })
  }
  queueReceive(inserted.data.id)
  return new NextResponse("ok", { status: 200 })
}
