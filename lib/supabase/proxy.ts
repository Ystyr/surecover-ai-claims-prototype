import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

type PendingCookie = { name: string; value: string; options: CookieOptions }

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })
  let pendingCookies: PendingCookie[] = []
  let pendingHeaders: Record<string, string> = {}
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return response

  const applySession = (target: NextResponse) => {
    pendingCookies.forEach(({ name, value, options }) => target.cookies.set(name, value, options))
    Object.entries(pendingHeaders).forEach(([name, value]) => target.headers.set(name, value))
    return target
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        pendingCookies = cookiesToSet
        pendingHeaders = headers
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        applySession(response)
      },
    },
  })

  const { data } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname
  const signedIn = Boolean(data.user)

  const redirectTo = (pathname: string) => {
    const destination = request.nextUrl.clone()
    destination.pathname = pathname
    destination.search = ""
    return applySession(NextResponse.redirect(destination))
  }

  const onLogin = path === "/login" || path.startsWith("/login/")
  if (!signedIn && !onLogin) return redirectTo("/login")
  if (signedIn && path === "/login") return redirectTo("/")
  return response
}
