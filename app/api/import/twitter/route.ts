import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'

const BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I%2BxMb1nYFAA%3DUognEfK4ZPxYowpr4nMskopkC%2FDO'

const FEATURES = JSON.stringify({
  graphql_timeline_v2_bookmark_timeline: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  tweetypie_unmention_optimization_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
})

// Query IDs for Twitter's internal GraphQL endpoints
// These can change when Twitter deploys updates — update if you get 400 errors
//
// To find the Likes query ID: open x.com/<username>/likes with DevTools Network tab,
// filter by "graphql", find the "Likes" request, and grab the ID from the URL path.
const ENDPOINTS = {
  bookmark: {
    queryId: 'j5KExFXy1niL_uGnBhHNxA',
    operationName: 'Bookmarks',
    referer: 'https://x.com/i/bookmarks',
    getInstructions: (d: Record<string, unknown>): unknown[] =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (d as any)?.data?.bookmark_timeline_v2?.timeline?.instructions ?? [],
  },
  like: {
    // PLACEHOLDER — you must replace this with the real query ID from x.com Network tab
    queryId: 'REPLACE_ME',
    operationName: 'Likes',
    referer: 'https://x.com',
    getInstructions: (d: Record<string, unknown>): unknown[] => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = d as any
      return a?.data?.user?.result?.timeline_v2?.timeline?.instructions
        ?? a?.data?.liked_tweets_timeline?.timeline?.instructions
        ?? []
    },
  },
} as const

type Source = keyof typeof ENDPOINTS

interface MediaVariant {
  content_type?: string
  bitrate?: number
  url?: string
}

interface MediaEntity {
  type?: string
  media_url_https?: string
  video_info?: { variants?: MediaVariant[] }
}

interface TweetLegacy {
  full_text?: string
  created_at?: string
  entities?: {
    hashtags?: unknown[]
    urls?: unknown[]
    user_mentions?: unknown[]
    media?: MediaEntity[]
  }
  extended_entities?: { media?: MediaEntity[] }
}

interface UserLegacy {
  screen_name?: string
  name?: string
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
  legacy?: TweetLegacy
  core?: { user_results?: { result?: { legacy?: UserLegacy } } }
  note_tweet?: { note_tweet_results?: { result?: { text?: string } } }
  article?: { article_results?: { result?: ArticleResult } }
  tweet?: TweetResult
}

async function fetchPage(authToken: string, ct0: string, source: Source, cursor?: string, userId?: string) {
  const cfg = ENDPOINTS[source]
  const variables = JSON.stringify({
    count: 100,
    includePromotedContent: false,
    ...(source === 'like' && userId ? { userId } : {}),
    ...(cursor ? { cursor } : {}),
  })

  const url = `https://x.com/i/api/graphql/${cfg.queryId}/${cfg.operationName}?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(FEATURES)}`

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${BEARER}`,
      'X-Csrf-Token': ct0,
      Cookie: `auth_token=${authToken}; ct0=${ct0}`,
      'X-Twitter-Auth-Type': 'OAuth2Session',
      'X-Twitter-Active-User': 'yes',
      'X-Twitter-Client-Language': 'en',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: cfg.referer,
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Twitter API ${res.status}: ${text.slice(0, 300)}`)
  }

  return res.json()
}

function parsePage(data: unknown, source: Source): { tweets: TweetResult[]; nextCursor: string | null } {
  const instructions = ENDPOINTS[source].getInstructions(data as Record<string, unknown>)

  const tweets: TweetResult[] = []
  let nextCursor: string | null = null

  for (const instruction of instructions as Array<Record<string, unknown>>) {
    if (instruction.type !== 'TimelineAddEntries') continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const entry of (instruction as any).entries ?? []) {
      const content = entry.content
      if (content?.entryType === 'TimelineTimelineItem') {
        let tweet: TweetResult = content?.itemContent?.tweet_results?.result
        if (tweet?.__typename === 'TweetWithVisibilityResults' && tweet.tweet) {
          tweet = tweet.tweet
        }
        if (tweet?.rest_id) tweets.push(tweet)
      } else if (
        content?.entryType === 'TimelineTimelineCursor' &&
        content?.cursorType === 'Bottom'
      ) {
        nextCursor = content.value ?? null
      }
    }
  }

  return { tweets, nextCursor }
}

function bestVideoUrl(variants: MediaVariant[]): string | null {
  const mp4 = variants
    .filter((v) => v.content_type === 'video/mp4' && v.url)
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))
  return mp4[0]?.url ?? null
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
}

type UrlEntity = { url?: string; expanded_url?: string; display_url?: string }

type StoredEntities = {
  urls: Array<{ short: string; expanded: string }>
  hashtags: string[]
  mentions: string[]
}

const MAX_URL_RESOLVE_CONCURRENCY = 5
let activeUrlResolves = 0
const urlResolveQueue: Array<() => void> = []

async function withUrlResolveSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeUrlResolves >= MAX_URL_RESOLVE_CONCURRENCY) {
    await new Promise<void>((resolve) => urlResolveQueue.push(resolve))
  }
  activeUrlResolves++
  try {
    return await fn()
  } finally {
    activeUrlResolves--
    urlResolveQueue.shift()?.()
  }
}

async function tryResolve(url: string, method: 'HEAD' | 'GET'): Promise<string | null> {
  try {
    const res = await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    return res.url || url
  } catch {
    return null
  }
}

async function resolveTco(url: string): Promise<string> {
  if (!url) return url
  // Only spend network calls on t.co shortlinks
  if (!/^https?:\/\/t\.co\//i.test(url)) return url

  return withUrlResolveSlot(async () => {
    const head = await tryResolve(url, 'HEAD')
    if (head) return head
    const get = await tryResolve(url, 'GET')
    if (get) return get
    return url
  })
}

async function extractEntities(tweet: TweetResult): Promise<StoredEntities> {
  const hashtags = (tweet.legacy?.entities?.hashtags ?? [])
    .map((h) => String((h as { text?: string })?.text ?? '').trim())
    .filter(Boolean)

  const mentions = (tweet.legacy?.entities?.user_mentions ?? [])
    .map((m) => String((m as { screen_name?: string })?.screen_name ?? '').trim())
    .filter(Boolean)

  const urlsRaw = (tweet.legacy?.entities?.urls ?? [])
    .map((u) => u as UrlEntity)
    .map((u) => {
      const short = String(u.url ?? '').trim()
      const expanded = String(u.expanded_url ?? u.url ?? '').trim()
      return short && expanded ? { short, expanded } : null
    })
    .filter(Boolean) as Array<{ short: string; expanded: string }>

  const urlsResolved = await Promise.all(
    urlsRaw.map(async (u) => ({ short: u.short, expanded: await resolveTco(u.expanded) }))
  )

  // de-dupe
  const map = new Map<string, { short: string; expanded: string }>()
  for (const u of urlsResolved) map.set(u.expanded, u)

  return { urls: Array.from(map.values()), hashtags, mentions }
}

function tweetFullText(tweet: TweetResult): string {
  if (tweet.note_tweet?.note_tweet_results?.result?.text) {
    return decodeHtmlEntities(tweet.note_tweet.note_tweet_results.result.text)
  }
  const article = tweet.article?.article_results?.result
  if (article) {
    const parts: string[] = []
    if (article.title) parts.push(article.title)
    if (article.content) parts.push(article.content)
    if (parts.length > 0) return decodeHtmlEntities(parts.join('\n\n'))
  }
  return decodeHtmlEntities(tweet.legacy?.full_text ?? '')
}

function extractMedia(tweet: TweetResult) {
  const entities =
    tweet.legacy?.extended_entities?.media ?? tweet.legacy?.entities?.media ?? []
  const results = entities
    .map((m) => {
      const thumb = m.media_url_https ?? ''
      if (m.type === 'video' || m.type === 'animated_gif') {
        const url = bestVideoUrl(m.video_info?.variants ?? []) ?? thumb
        if (!url) return null
        return { type: m.type === 'animated_gif' ? 'gif' : 'video', url, thumbnailUrl: thumb }
      }
      if (!thumb) return null
      return { type: 'photo' as const, url: thumb, thumbnailUrl: thumb }
    })
    .filter(Boolean) as { type: string; url: string; thumbnailUrl: string }[]

  if (results.length === 0) {
    const article = tweet.article?.article_results?.result
    const coverUrl =
      article?.cover_media?.media_info?.original_img_url ??
      article?.preview_image?.url
    if (coverUrl) {
      results.push({ type: 'photo', url: coverUrl, thumbnailUrl: coverUrl })
    }
  }

  return results
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { authToken?: string; ct0?: string; source?: string; userId?: string } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { authToken, ct0 } = body
  const source: Source = body.source === 'like' ? 'like' : 'bookmark'
  const userId = body.userId?.trim()

  if (!authToken?.trim() || !ct0?.trim()) {
    return NextResponse.json({ error: 'authToken and ct0 are required' }, { status: 400 })
  }

  if (source === 'like' && !userId) {
    return NextResponse.json({ error: 'userId is required for importing likes' }, { status: 400 })
  }

  let imported = 0
  let skipped = 0
  let cursor: string | undefined

  try {
    while (true) {
      const data = await fetchPage(authToken.trim(), ct0.trim(), source, cursor, userId)
      const { tweets, nextCursor } = parsePage(data, source)

      for (const tweet of tweets) {
        if (!tweet.rest_id) continue

        const exists = await prisma.bookmark.findUnique({
          where: { tweetId: tweet.rest_id },
          select: { id: true },
        })

        if (exists) {
          skipped++
          continue
        }

        const media = extractMedia(tweet)
        const userLegacy = tweet.core?.user_results?.result?.legacy ?? {}

        const created = await prisma.bookmark.create({
          data: {
            tweetId: tweet.rest_id,
            text: tweetFullText(tweet),
            authorHandle: userLegacy.screen_name ?? 'unknown',
            authorName: userLegacy.name ?? 'Unknown',
            tweetCreatedAt: tweet.legacy?.created_at ? new Date(tweet.legacy.created_at) : null,
            rawJson: JSON.stringify(tweet),
            entities: JSON.stringify(await extractEntities(tweet)),
            source,
          },
        })

        if (media.length > 0) {
          await prisma.mediaItem.createMany({
            data: media.map((m) => ({
              bookmarkId: created.id,
              type: m.type,
              url: m.url,
              thumbnailUrl: m.thumbnailUrl ?? null,
            })),
          })
        }

        imported++
      }

      if (!nextCursor || tweets.length === 0) break
      cursor = nextCursor
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch from Twitter' },
      { status: 500 }
    )
  }

  return NextResponse.json({ imported, skipped })
}
