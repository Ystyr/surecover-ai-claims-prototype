import { FILE_ABSENT_MESSAGE, FILE_READ_ERROR_MESSAGE, fileFailure } from "@/lib/findings"
import { createClient } from "@/lib/supabase/server"

function failed(input: { claimId?: string; documentId?: string; selectError: unknown; document: unknown; downloadError: unknown }) {
  const failure = fileFailure(input)
  if (!failure) return null
  return new Response(failure.message, { status: failure.status, headers: { "Content-Type": "text/plain; charset=utf-8" } })
}

export async function GET(_request: Request, context: { params: Promise<{ id: string; documentId: string }> }) {
  const { id, documentId } = await context.params
  const invalid = failed({ claimId: id, documentId, selectError: null, document: { id: documentId }, downloadError: null })
  if (invalid) return invalid

  const supabase = await createClient()
  const selected = await supabase
    .from("claim_documents")
    .select("source_file, media_type, storage_path")
    .eq("id", documentId)
    .eq("claim_id", id)
    .maybeSingle()

  const missing = failed({ selectError: selected.error, document: selected.data, downloadError: null })
  if (missing) return missing

  const document = selected.data
  if (!document) return new Response(FILE_ABSENT_MESSAGE, { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } })

  const downloaded = await supabase.storage.from("claim-files").download(document.storage_path)
  const unread = failed({
    selectError: null,
    document,
    downloadError: downloaded.error || !downloaded.data ? downloaded.error ?? { missing: true } : null,
  })
  if (unread || !downloaded.data) return unread ?? new Response(FILE_READ_ERROR_MESSAGE, { status: 500 })

  const filename = document.source_file.replace(/["\r\n]/g, "")
  return new Response(await downloaded.data.arrayBuffer(), {
    headers: {
      "Content-Type": document.media_type,
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  })
}
