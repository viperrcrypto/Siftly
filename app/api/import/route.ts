import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { parseBookmarksJson } from '@/lib/parser'
import { enqueueIncompleteArchives, ensureArchiveRecord } from '@/lib/archive/pipeline'
import { createImportedBookmark } from '@/lib/media-import'

export async function POST(request: NextRequest): Promise<NextResponse> {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Failed to parse form data' }, { status: 400 })
  }

  const sourceParam = (formData.get('source') as string | null)?.trim()
  const file = formData.get('file')
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json(
      { error: 'Missing required field: file' },
      { status: 400 }
    )
  }

  const filename =
    file instanceof File ? file.name : 'bookmarks.json'

  let jsonString: string
  try {
    jsonString = await file.text()
  } catch {
    return NextResponse.json({ error: 'Failed to read file content' }, { status: 400 })
  }

  // Create an import job to track progress
  const importJob = await prisma.importJob.create({
    data: {
      filename,
      status: 'processing',
      totalCount: 0,
      processedCount: 0,
    },
  })

  let parsedBookmarks
  try {
    parsedBookmarks = parseBookmarksJson(jsonString)
  } catch (err) {
    await prisma.importJob.update({
      where: { id: importJob.id },
      data: {
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    })
    return NextResponse.json(
      { error: `Failed to parse bookmarks JSON: ${err instanceof Error ? err.message : String(err)}` },
      { status: 422 }
    )
  }

  // Determine source: formData param > JSON field > default "bookmark"
  let jsonSource: string | undefined
  try {
    const parsed = JSON.parse(jsonString)
    if (typeof parsed?.source === 'string') jsonSource = parsed.source
  } catch { /* already parsed above */ }
  const source = (sourceParam === 'like' || sourceParam === 'bookmark')
    ? sourceParam
    : (jsonSource === 'like' ? 'like' : 'bookmark')

  await prisma.importJob.update({
    where: { id: importJob.id },
    data: { totalCount: parsedBookmarks.length },
  })

  let importedCount = 0
  let skippedCount = 0
  const archiveIds: string[] = []

  for (const bookmark of parsedBookmarks) {
    try {
      const existing = await prisma.bookmark.findUnique({
        where: { tweetId: bookmark.tweetId },
        select: { id: true, deletedAt: true },
      })

      if (existing) {
        if (existing.deletedAt) await prisma.bookmark.update({ where: { id: existing.id }, data: { deletedAt: null } })
        await ensureArchiveRecord(existing.id)
        archiveIds.push(existing.id)
        skippedCount++
        continue
      }

      const created = await createImportedBookmark(
        prisma,
        {
          tweetId: bookmark.tweetId,
          text: bookmark.text,
          authorHandle: bookmark.authorHandle,
          authorName: bookmark.authorName,
          tweetCreatedAt: bookmark.tweetCreatedAt,
          rawJson: bookmark.rawJson,
          source,
          archive: { create: {} },
        },
        bookmark.media,
      )

      importedCount++
      archiveIds.push(created.id)
    } catch (err) {
      console.error(`Failed to import tweet ${bookmark.tweetId}:`, err)
      skippedCount++
    }
  }

  await prisma.importJob.update({
    where: { id: importJob.id },
    data: {
      status: 'done',
      processedCount: importedCount,
    },
  })

  await enqueueIncompleteArchives(archiveIds)

  return NextResponse.json({
    jobId: importJob.id,
    imported: importedCount,
    skipped: skippedCount,
    parsed: parsedBookmarks.length,
  })
}
