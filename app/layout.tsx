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
          <div className="top-bar">
            <h1>
              <a className="brand" href="/">
                <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
                  <rect width="32" height="32" rx="8" />
                  <path d="M10 12.5h12M10 17h8M10 21.5h5" />
                </svg>
                <span className="wordmark">SureCover</span>
                <span className="product">claims</span>
              </a>
            </h1>
            {data.user ? (
              <div className="session">
                <form action={signOut}>
                  <span className="muted">{data.user.email}</span>{" "}
                  <button className="quiet" type="submit">Sign out</button>
                </form>
              </div>
            ) : null}
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  )
}
