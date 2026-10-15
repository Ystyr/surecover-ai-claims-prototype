import { displayDate, displayInstant } from "@/lib/findings"
import { createClient } from "@/lib/supabase/server"

export default async function QueuePage() {
  const supabase = await createClient()
  const { data: claims, error } = await supabase
    .from("claims")
    .select("id, reference, claimant_name, status, received_at, return_date")
    .order("received_at", { ascending: false })

  return (
    <section>
      <h2>Queue</h2>
      {error ? <p className="error">The queue could not be read.</p> : null}
      {!error && claims?.length === 0 ? <p>No claims are assigned to you.</p> : null}
      {claims?.map((claim) => (
        <a className="claim-row" href={`/claims/${claim.id}`} key={claim.id}>
          <div className="row-head">
            <strong>{claim.reference}</strong>
            <span>{claim.status}</span>
            {claim.status === "needs review" ? <span className="needed">Action needed</span> : null}
          </div>
          <p>
            {claim.claimant_name} · return {displayDate(claim.return_date)}
          </p>
          <p className="muted">Received {displayInstant(claim.received_at)}</p>
        </a>
      ))}
    </section>
  )
}
