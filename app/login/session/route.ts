import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

type PendingCookie = { name: string; value: string; options: CookieOptions }

const SESSION_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
}

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const email = String(formData.get("email") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_PUBLISHABLE_KEY
  if (!url || !key || !email || !password) return reject(request)

  const response = NextResponse.redirect(new URL("/", request.url), 303)
  let stored = false
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        writeSessionHeaders(response, headers)
        stored = cookiesToSet.length > 0
      },
    },
  })

  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !stored) {
    if (!error && !stored) throw new Error("The session cookie was not stored.")
    return reject(request)
  }
  return response
}

function writeSessionHeaders(response: NextResponse, headers: Record<string, string> | undefined) {
  const outgoing = { ...SESSION_HEADERS, ...headers }
  Object.entries(outgoing).forEach(([name, value]) => response.headers.set(name, value))
}

function reject(request: NextRequest) {
  return NextResponse.redirect(new URL("/login?error=1", request.url), 303)
}
