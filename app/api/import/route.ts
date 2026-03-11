import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { parseTweetsJson, parseTweetsWithMeta } from '@/lib/parser'
import type { ParsedTweet } from '@/lib/parser'
import { upsertTweets, type IncomingTweet } from '@/lib/upsert-tweet'
import JSZip from 'jszip'

async function extractArchiveFiles(zipBuffer: ArrayBuffer): Promise<{ filename: string; content: string }[]> {
  const zip = await JSZip.loadAsync(zipBuffer)
  const results: { filename: string; content: string }[] = []
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    const name = path.split('/').pop() ?? ''
    // Match like.js, bookmark.js, and partitioned files like like.part0.js
    if (/^(like|bookmark)(\.part\d+)?\.js$/.test(name)) {
      const content = await entry.async('string')
      results.push({ filename: name, content })
    }
  }
  return results
}

function toIncomingTweets(bookmarks: ParsedTweet[], source: string): IncomingTweet[] {
  return bookmarks.map((b) => ({
    tweetId: b.tweetId,
    text: b.text,
    authorHandle: b.authorHandle,
    authorName: b.authorName,
    tweetCreatedAt: b.tweetCreatedAt,
    rawJson: b.rawJson,
    source,
    media: b.media,
  }))
}

function resolveSource(
  sourceParam: string | undefined,
  detectedSource: 'like' | 'bookmark' | undefined,
  jsonSource: string | undefined,
): string {
  if (detectedSource) return detectedSource
  if (sourceParam === 'like' || sourceParam === 'bookmark') return sourceParam
  if (jsonSource === 'like') return 'like'
  return 'bookmark'
}

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
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''

  // Create an import job to track progress
  const importJob = await prisma.importJob.create({
    data: {
      filename,
      status: 'processing',
      totalCount: 0,
      processedCount: 0,
    },
  })

  try {
    let totalParsed = 0
    let importedCount = 0
    let skippedCount = 0
    let updatedCount = 0
    let erroredCount = 0

    if (ext === 'zip') {
      // --- ZIP archive: extract like.js / bookmark.js files ---
      const zipBuffer = await file.arrayBuffer()
      const archiveFiles = await extractArchiveFiles(zipBuffer)

      if (archiveFiles.length === 0) {
        await prisma.importJob.update({
          where: { id: importJob.id },
          data: { status: 'error', errorMessage: 'No like.js or bookmark.js files found in ZIP' },
        })
        return NextResponse.json(
          { error: 'No like.js or bookmark.js files found in ZIP' },
          { status: 422 }
        )
      }

      for (const archiveFile of archiveFiles) {
        const { tweets, detectedSource } = parseTweetsWithMeta(archiveFile.content)
        const source = resolveSource(sourceParam ?? undefined, detectedSource, undefined)
        const result = await upsertTweets(toIncomingTweets(tweets, source))
        totalParsed += tweets.length
        importedCount += result.imported
        skippedCount += result.skipped
        updatedCount += result.updated
        erroredCount += result.errored
      }
    } else if (ext === 'js') {
      // --- Archive .js file (like.js, bookmark.js) ---
      const content = await file.text()
      const { tweets, detectedSource } = parseTweetsWithMeta(content)
      const source = resolveSource(sourceParam ?? undefined, detectedSource, undefined)
      totalParsed = tweets.length
      const result = await upsertTweets(toIncomingTweets(tweets, source))
      importedCount = result.imported
      skippedCount = result.skipped
      updatedCount = result.updated
      erroredCount = result.errored
    } else {
      // --- JSON file ---
      let jsonString: string
      try {
        jsonString = await file.text()
      } catch {
        await prisma.importJob.update({
          where: { id: importJob.id },
          data: { status: 'error', errorMessage: 'Failed to read file content' },
        })
        return NextResponse.json({ error: 'Failed to read file content' }, { status: 400 })
      }

      const parsedTweets = parseTweetsJson(jsonString)

      // Detect source from JSON payload
      let jsonSource: string | undefined
      try {
        const parsed = JSON.parse(jsonString)
        if (typeof parsed?.source === 'string') jsonSource = parsed.source
      } catch { /* already parsed above */ }
      const source = resolveSource(sourceParam ?? undefined, undefined, jsonSource)

      totalParsed = parsedTweets.length
      const result = await upsertTweets(toIncomingTweets(parsedTweets, source))
      importedCount = result.imported
      skippedCount = result.skipped
      updatedCount = result.updated
      erroredCount = result.errored
    }

    await prisma.importJob.update({
      where: { id: importJob.id },
      data: {
        status: 'done',
        totalCount: totalParsed,
        processedCount: importedCount,
      },
    })

    return NextResponse.json({
      jobId: importJob.id,
      imported: importedCount,
      skipped: skippedCount,
      updated: updatedCount,
      errored: erroredCount,
      parsed: totalParsed,
    })
  } catch (err) {
    await prisma.importJob.update({
      where: { id: importJob.id },
      data: {
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    })
    return NextResponse.json(
      { error: `Import failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 422 }
    )
  }
}
