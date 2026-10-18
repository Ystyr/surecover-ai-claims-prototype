import { displayInstant } from "@/lib/findings"
import { createClient } from "@/lib/supabase/server"

export default async function UnmatchedPage() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("inbound_messages")
    .select("id, from_address, subject, body, created_at, documents_reply_subject, documents_reply_body, documents_reply_provider, documents_reply_status")
    .is("claim_id", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })

  return (
    <section>
      <div className="place-head">
        <h2>Mail without a claim</h2>
        <a href="/">Queue</a>
      </div>
      <p className="muted">These messages did not become claims.</p>
      {error ? <p className="error">This list could not be read.</p> : null}
      {!error && data?.length === 0 ? <p>No messages are waiting here.</p> : null}
      {!error && data?.map((mail) => (
        <article className="claim-row" key={mail.id}>
          <div className="row-head">
            <strong>{mail.subject}</strong>
            <span className="muted">{displayInstant(mail.created_at)}</span>
          </div>
          <p className="muted">From {mail.from_address}</p>
          {mail.body ? <div className="message-body">{mail.body}</div> : null}
          {mail.documents_reply_body ? (
            <div>
              <p className="muted">
                {mail.documents_reply_subject} · {mail.documents_reply_provider} · {mail.documents_reply_status}
              </p>
              <div className="message-body">{mail.documents_reply_body}</div>
            </div>
          ) : null}
        </article>
      ))}
    </section>
  )
}
