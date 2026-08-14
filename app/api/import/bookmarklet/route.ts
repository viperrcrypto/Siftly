import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { enqueueIncompleteArchives, ensureArchiveRecord } from '@/lib/archive/pipeline'
import { createImportedBookmark } from '@/lib/media-import'

const ALLOWED_ORIGINS = new Set(['https://x.com', 'https://twitter.com'])

function corsHeaders(request: NextRequest) {
  const origin = request.headers.get('Origin') ?? ''
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : 'https://x.com'
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}

interface MediaVariant {
  content_type?: string
  bitrate?: number
  url?: string
}

interface MediaEntity {
  type?: string
  media_url_https?: string
  media_key?: string
  id_str?: string
  video_info?: { variants?: MediaVariant[] }
}

interface ArticleResult {
  title?: string
  preview_image?: { url?: string }
  cover_media?: { media_info?: { original_img_url?: string } }
  content?: string
}

interface TweetResult {
  __typename?: string
  rest_id?: string
  legacy?: {
    full_text?: string
    created_at?: string
    extended_entities?: { media?: MediaEntity[] }
    entities?: { media?: MediaEntity[] }
  }
  core?: {
    user_results?: {
      result?: { legacy?: { screen_name?: string; name?: string } }
    }
  }
  note_tweet?: { note_tweet_results?: { result?: { text?: string } } }
  article?: { article_results?: { result?: ArticleResult } }
  tweet?: TweetResult
}

function bestVideoUrl(variants: MediaVariant[]): string | null {
  return (
    variants
      .filter((v) => v.content_type === 'video/mp4' && v.url)
      .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0]?.url ?? null
  )
}

function tweetFullText(tweet: TweetResult): string {
  if (tweet.note_tweet?.note_tweet_results?.result?.text) {
    return tweet.note_tweet.note_tweet_results.result.text
  }
  const article = tweet.article?.article_results?.result
  if (article) {
    const parts: string[] = []
    if (article.title) parts.push(article.title)
    if (article.content) parts.push(article.content)
    if (parts.length > 0) return parts.join('\n\n')
  }
  return tweet.legacy?.full_text ?? ''
}

function extractMedia(tweet: TweetResult) {
  const entities =
    tweet.legacy?.extended_entities?.media ?? tweet.legacy?.entities?.media ?? []
  const results = entities
    .map((m, sourceMediaIndex) => {
      const thumb = m.media_url_https ?? ''
      if (m.type === 'video' || m.type === 'animated_gif') {
        const url = bestVideoUrl(m.video_info?.variants ?? []) ?? thumb
        if (!url) return null
        return { type: m.type === 'animated_gif' ? 'gif' : 'video', url, thumbnailUrl: thumb, mediaKey: m.media_key ?? m.id_str ?? null, sourceTweetId: tweet.rest_id ?? null, sourceMediaIndex }
      }
      if (!thumb) return null
      return { type: 'photo' as const, url: thumb, thumbnailUrl: thumb, mediaKey: m.media_key ?? m.id_str ?? null, sourceTweetId: tweet.rest_id ?? null, sourceMediaIndex }
    })
    .filter(Boolean) as { type: string; url: string; thumbnailUrl: string; mediaKey: string | null; sourceTweetId: string | null; sourceMediaIndex: number }[]

  if (results.length === 0) {
    const article = tweet.article?.article_results?.result
    const coverUrl =
      article?.cover_media?.media_info?.original_img_url ??
      article?.preview_image?.url
    if (coverUrl) {
      results.push({ type: 'photo', url: coverUrl, thumbnailUrl: coverUrl, mediaKey: null, sourceTweetId: tweet.rest_id ?? null, sourceMediaIndex: 0 })
    }
  }

  return results
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const cors = corsHeaders(request)
  let body: { tweets?: TweetResult[]; source?: string } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: cors })
  }

  const source = body.source === 'like' ? 'like' : 'bookmark'
  const tweets = body.tweets ?? []
  if (!Array.isArray(tweets) || tweets.length === 0) {
    return NextResponse.json({ error: 'No tweets provided' }, { status: 400, headers: cors })
  }

  let imported = 0
  let skipped = 0
  const archiveIds: string[] = []

  for (let tweet of tweets) {
    // Unwrap TweetWithVisibilityResults
    if (tweet.__typename === 'TweetWithVisibilityResults' && tweet.tweet) {
      tweet = tweet.tweet
    }
    if (!tweet.rest_id) continue

    const exists = await prisma.bookmark.findUnique({
      where: { tweetId: tweet.rest_id },
      select: { id: true },
    })

    if (exists) {
      await ensureArchiveRecord(exists.id)
      archiveIds.push(exists.id)
      skipped++
      continue
    }

    const userLegacy = tweet.core?.user_results?.result?.legacy ?? {}
    const media = extractMedia(tweet)

    const created = await createImportedBookmark(
      prisma,
      {
        tweetId: tweet.rest_id,
        text: tweetFullText(tweet),
        authorHandle: userLegacy.screen_name ?? 'unknown',
        authorName: userLegacy.name ?? 'Unknown',
        tweetCreatedAt: tweet.legacy?.created_at
          ? new Date(tweet.legacy.created_at)
          : null,
        rawJson: JSON.stringify(tweet),
        source,
        archive: { create: {} },
      },
      media,
    )

    imported++
    archiveIds.push(created.id)
  }

  await enqueueIncompleteArchives(archiveIds)
  return NextResponse.json({ imported, skipped }, { headers: cors })
}
