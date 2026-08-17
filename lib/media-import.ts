import type { Prisma, PrismaClient } from '@/app/generated/prisma/client'

export interface ImportedMedia {
  type: string
  url?: string
  thumbnailUrl?: string | null
  mediaKey?: string | null
  sourceTweetId?: string | null
  sourceTweetUrl?: string | null
  sourceMediaIndex?: number | null
  sourceAuthorId?: string | null
  sourceAuthorHandle?: string | null
}

function xMediaIdentity(url: string): string | null {
  try {
    const parsed = new URL(url)
    return /(^|\.)((pbs|video)\.twimg\.com)$/i.test(parsed.hostname)
      ? `${parsed.origin}${parsed.pathname}`
      : null
  } catch {
    return null
  }
}

/** Import-boundary normalization: preserve source order and the first exact URL. */
export function importedMediaData(
  bookmarkId: string,
  media: ImportedMedia[],
): Prisma.MediaItemCreateManyInput[] {
  const seen = new Set<string>()
  const seenMediaKeys = new Set<string>()
  const seenXMedia = new Set<string>()
  const data: Prisma.MediaItemCreateManyInput[] = []

  for (const [index, item] of media.entries()) {
    const url = item.url?.trim()
    const mediaKey = item.mediaKey?.trim() || null
    const xIdentity = url ? xMediaIdentity(url) : null
    if (!url || seen.has(url) || (mediaKey && seenMediaKeys.has(mediaKey)) || (xIdentity && seenXMedia.has(xIdentity))) continue
    seen.add(url)
    if (mediaKey) seenMediaKeys.add(mediaKey)
    if (xIdentity) seenXMedia.add(xIdentity)
    data.push({
      bookmarkId,
      type: item.type,
      url,
      thumbnailUrl: item.thumbnailUrl ?? null,
      mediaKey,
      sourceTweetId: item.sourceTweetId ?? null,
      sourceTweetUrl: item.sourceTweetUrl ?? null,
      sourceMediaIndex: item.sourceMediaIndex ?? index,
      sourceAuthorId: item.sourceAuthorId ?? null,
      sourceAuthorHandle: item.sourceAuthorHandle ?? null,
    })
  }

  return data
}

type ImportedBookmarkData = Prisma.BookmarkCreateArgs['data']

/**
 * Keep the bookmark and its media in one Prisma transaction. SQLite does not
 * support createMany({ skipDuplicates }), so inputs are normalized beforehand.
 */
export async function createImportedBookmark(
  db: Pick<PrismaClient, '$transaction'>,
  data: ImportedBookmarkData,
  media: ImportedMedia[],
): Promise<{ id: string }> {
  return db.$transaction(async (tx) => {
    const bookmark = await tx.bookmark.create({ data })
    const mediaData = importedMediaData(bookmark.id, media.map((item, sourceMediaIndex) => ({
      ...item,
      sourceTweetId: item.sourceTweetId ?? data.tweetId,
      sourceTweetUrl: item.sourceTweetUrl ?? `https://x.com/${data.authorHandle}/status/${data.tweetId}`,
      sourceMediaIndex: item.sourceMediaIndex ?? sourceMediaIndex,
      sourceAuthorHandle: item.sourceAuthorHandle ?? data.authorHandle,
    })))
    if (mediaData.length) await tx.mediaItem.createMany({ data: mediaData })
    return bookmark
  })
}
