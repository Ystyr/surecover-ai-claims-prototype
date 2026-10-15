import type { Metadata } from "next"

import { signOut } from "@/app/login/actions"
import { createClient } from "@/lib/supabase/server"

import "./globals.css"

export const metadata: Metadata = {
  title: "SureCover claims",
  description: "Officer workbench for fictional flight-delay claims.",
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()

  return (
    <html lang="en">
      <body>
        <p className="banner">Fictional demonstration data. Not a SureCover policy document.</p>
        <header className="top">
          <h1>
            <a href="/">SureCover claims</a>
          </h1>
          {data.user ? (
            <form action={signOut}>
              <span className="muted">{data.user.email}</span>{" "}
              <button type="submit">Sign out</button>
            </form>
          ) : null}
        </header>
        <main>{children}</main>
      </body>
    </html>
  )
}
