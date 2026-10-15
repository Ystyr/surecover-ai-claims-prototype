import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

const SERVER_COMPONENT_COOKIE_ERROR = "Cookies can only be modified in a Server Action or Route Handler"

export async function createClient() {
  const cookieStore = await cookies()
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required")
  }

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        } catch (error) {
          if (isServerComponentCookieError(error)) return
          throw error
        }
      },
    },
  })
}

function isServerComponentCookieError(error: unknown) {
  return error instanceof Error && error.message.startsWith(SERVER_COMPONENT_COOKIE_ERROR)
}
