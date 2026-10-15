import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return response

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value)
        })
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options)
        })
      },
    },
  })

  const { data } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname
  const signedIn = Boolean(data.user)

  if (!signedIn && path !== "/login") {
    const login = request.nextUrl.clone()
    login.pathname = "/login"
    login.search = ""
    return NextResponse.redirect(login)
  }
  if (signedIn && path === "/login") {
    const home = request.nextUrl.clone()
    home.pathname = "/"
    home.search = ""
    return NextResponse.redirect(home)
  }
  return response
}
