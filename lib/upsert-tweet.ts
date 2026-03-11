import prisma from '@/lib/db'

export interface IncomingTweet {
  tweetId: string
  text: string
  authorHandle: string
  authorName: string
  tweetCreatedAt: Date | null
  rawJson: string | null
  source: string
  media: { type: string; url: string; thumbnailUrl?: string | null }[]
}

export interface UpsertResult {
  imported: number
  skipped: number
  updated: number
  errored: number
}

/**
 * Checks whether incoming tweet data is richer than what's already stored.
 * Returns true if the incoming data has longer text, a real author handle
 * where we had 'unknown', or new media where we had none.
 */
function isIncomingRicher(
  incoming: IncomingTweet,
  existing: { text: string | null; authorHandle: string | null; _count: { mediaItems: number } },
): boolean {
  return (
    (incoming.text !== (existing.text ?? '') && incoming.text.length >= (existing.text?.length ?? 0)) ||
    (existing.authorHandle === 'unknown' && incoming.authorHandle !== 'unknown') ||
    (existing._count.mediaItems === 0 && incoming.media.length > 0)
  )
}

/**
 * Upserts a single tweet inside a transaction:
 * - New tweet → create + media
 * - Existing but incoming is richer → update + clear enrichment + replace media
 * - Existing and equal/worse → skip
 */
async function upsertOne(
  tweet: IncomingTweet,
): Promise<'imported' | 'updated' | 'skipped'> {
  const existing = await prisma.bookmark.findUnique({
    where: { tweetId: tweet.tweetId },
    select: {
      id: true,
      text: true,
      authorHandle: true,
      tweetCreatedAt: true,
      _count: { select: { mediaItems: true } },
    },
  })

  if (existing) {
    if (!isIncomingRicher(tweet, existing)) return 'skipped'

    const addMedia = existing._count.mediaItems === 0 && tweet.media.length > 0

    await prisma.$transaction([
      prisma.bookmark.update({
        where: { id: existing.id },
        data: {
          text: tweet.text,
          authorHandle: tweet.authorHandle,
          authorName: tweet.authorName,
          rawJson: tweet.rawJson ?? undefined,
          tweetCreatedAt:
            existing.tweetCreatedAt == null ? tweet.tweetCreatedAt : undefined,
          enrichedAt: null,
          semanticTags: null,
          entities: null,
          enrichmentMeta: null,
        },
      }),
      prisma.bookmarkCategory.deleteMany({ where: { bookmarkId: existing.id } }),
      ...(addMedia
        ? [
            prisma.mediaItem.createMany({
              data: tweet.media.map((m) => ({
                bookmarkId: existing.id,
                type: m.type,
                url: m.url,
                thumbnailUrl: m.thumbnailUrl ?? null,
              })),
            }),
          ]
        : []),
    ])

    return 'updated'
  }

  // New tweet — create in a transaction
  await prisma.$transaction(async (tx) => {
    const created = await tx.bookmark.create({
      data: {
        tweetId: tweet.tweetId,
        text: tweet.text,
        authorHandle: tweet.authorHandle,
        authorName: tweet.authorName,
        tweetCreatedAt: tweet.tweetCreatedAt,
        rawJson: tweet.rawJson ?? '',
        source: tweet.source,
      },
    })

    if (tweet.media.length > 0) {
      await tx.mediaItem.createMany({
        data: tweet.media.map((m) => ({
          bookmarkId: created.id,
          type: m.type,
          url: m.url,
          thumbnailUrl: m.thumbnailUrl ?? null,
        })),
      })
    }
  })

  return 'imported'
}

/**
 * Upserts a batch of tweets. Each tweet is processed individually so a single
 * failure doesn't roll back the entire import. Returns aggregate counts.
 */
export async function upsertTweets(tweets: IncomingTweet[]): Promise<UpsertResult> {
  const result: UpsertResult = { imported: 0, skipped: 0, updated: 0, errored: 0 }

  for (const tweet of tweets) {
    try {
      const outcome = await upsertOne(tweet)
      result[outcome]++
    } catch (err) {
      console.error(`Failed to import tweet ${tweet.tweetId}:`, err)
      result.errored++
    }
  }

  return result
}
