import { createClient } from "@/lib/supabase/server"

export async function GET(_request: Request, context: { params: Promise<{ id: string; documentId: string }> }) {
  const { id, documentId } = await context.params
  const supabase = await createClient()
  const { data: document } = await supabase
    .from("claim_documents")
    .select("source_file, media_type, storage_path")
    .eq("id", documentId)
    .eq("claim_id", id)
    .maybeSingle()

  if (!document) return new Response("Not found", { status: 404 })

  const downloaded = await supabase.storage.from("claim-files").download(document.storage_path)
  if (downloaded.error || !downloaded.data) return new Response("Not found", { status: 404 })

  const filename = document.source_file.replace(/["\r\n]/g, "")
  return new Response(await downloaded.data.arrayBuffer(), {
    headers: {
      "Content-Type": document.media_type,
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  })
}
