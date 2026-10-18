"use client"

import { useEffect, useId, useRef, useState } from "react"

import { recordDecision, sendRequestMessage } from "@/app/claims/[id]/actions"

type Action = "request" | "approve" | "reject"
type Mode = Action | "send"

const LABELS: Record<Action, string> = {
  request: "Request",
  approve: "Approve",
  reject: "Reject",
}

export function DecisionPanel({
  claimId,
  assessmentId,
  actions,
  finished,
  preview,
  message,
  requestMessage,
}: {
  claimId: string
  assessmentId: string | null
  actions: Action[]
  finished: { label: string; rationale: string } | null
  preview: { subject: string; body: string; decisionId: string } | null
  message?: string
  requestMessage?: string
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [mode, setMode] = useState<Mode | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (mode && !dialog.open) dialog.showModal()
    if (!mode && dialog.open) dialog.close()
  }, [mode])

  const title = mode === "send" ? "Send request" : mode ? LABELS[mode] : "Decision"

  return (
    <div className="decision-panel">
      {message ? <p className="error">{message}</p> : null}
      {requestMessage ? <p className="error">{requestMessage}</p> : null}
      {finished ? (
        <p>
          {finished.label} · {finished.rationale}
        </p>
      ) : null}
      <div className="decision-row">
        {preview ? (
          <button type="button" onClick={() => setMode("send")}>
            Review request
          </button>
        ) : null}
        {assessmentId
          ? actions.map((action) => (
              <button key={action} type="button" onClick={() => setMode(action)}>
                {LABELS[action]}
              </button>
            ))
          : null}
      </div>
      <dialog aria-labelledby={titleId} onClose={() => setMode(null)} ref={dialogRef}>
        <h2 id={titleId}>{title}</h2>
        {mode === "send" && preview ? (
          <form action={sendRequestMessage} className="decision">
            <p>{preview.subject}</p>
            <p className="message-body">{preview.body}</p>
            <input name="claim_id" type="hidden" value={claimId} />
            <input name="decision_id" type="hidden" value={preview.decisionId} />
            <p>
              <button type="submit">Send request</button>
            </p>
          </form>
        ) : null}
        {mode && mode !== "send" && assessmentId ? (
          <form action={recordDecision} className="decision">
            <input name="claim_id" type="hidden" value={claimId} />
            <input name="action" type="hidden" value={mode} />
            <input name="assessment_id" type="hidden" value={assessmentId} />
            <label htmlFor={`decision-${mode}-why`}>{LABELS[mode]} rationale</label>
            <input id={`decision-${mode}-why`} name="rationale" required />
            <p>
              <button type="submit">{LABELS[mode]}</button>
            </p>
          </form>
        ) : null}
        <p>
          <button className="quiet" type="button" onClick={() => setMode(null)}>
            Close
          </button>
        </p>
      </dialog>
    </div>
  )
}
