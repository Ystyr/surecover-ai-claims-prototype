"use client"

import { useState, type ReactNode } from "react"

export function Fold({
  startOpen = false,
  className,
  id,
  summary,
  children,
}: {
  startOpen?: boolean
  className?: string
  id?: string
  summary: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(startOpen)
  return (
    <details
      className={className}
      id={id}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{summary}</summary>
      {children}
    </details>
  )
}
