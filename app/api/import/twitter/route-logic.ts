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

interface UrlEntity {
  url?: string
  expanded_url?: string
  unwound_url?: string
  display_url?: string
}

interface HashtagEntity {
  text?: string
  tag?: string
}

interface MentionEntity {
  screen_name?: string
  username?: string
}

interface TweetLegacy {
  full_text?: string
  created_at?: string
  quoted_status_id_str?: string
  in_reply_to_status_id_str?: string
  self_thread?: unknown
  entities?: {
    hashtags?: HashtagEntity[]
    urls?: UrlEntity[]
    user_mentions?: MentionEntity[]
    media?: MediaEntity[]
  }
  extended_entities?: { media?: MediaEntity[] }
  retweeted_status_result?: { result?: TweetResult }
}

interface UserCore {
  screen_name?: string
  name?: string
}

interface CardBindingValue {
  key?: string
  value?: {
    string_value?: string
    scribe_key?: string
    image_value?: { url?: string }
  }
}

interface CardLegacy {
  name?: string
  url?: string
  binding_values?: CardBindingValue[]
}

interface ArticleBlock {
  text?: string
  type?: string
}

interface ArticleResult {
  rest_id?: string
  title?: string
  preview_text?: string
  preview_image?: { url?: string }
  cover_media?: { media_info?: { original_img_url?: string } }
  content?: string
  // Full X Articles ship a Draft.js-like content_state from TweetResultByRestId.
  content_state?: { blocks?: ArticleBlock[] }
}

interface TweetResult {
  __typename?: string
  rest_id?: string
  legacy?: TweetLegacy
  core?: {
    user_results?: {
      result?: {
        // X moved name/screen_name from legacy to core in 2026. Support both.
        core?: UserCore
        legacy?: UserCore
      }
    }
  }
  note_tweet?: {
    note_tweet_results?: {
      result?: {
        text?: string
        entity_set?: { urls?: UrlEntity[] }
      }
    }
  }
  article?: { article_results?: { result?: ArticleResult } }
  card?: { rest_id?: string; legacy?: CardLegacy }
  quoted_status_result?: { result?: TweetResult }
  retweeted_status_result?: { result?: TweetResult }
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

function unwrapTweet(tweet: TweetResult | undefined): TweetResult | undefined {
  if (tweet?.__typename === 'TweetWithVisibilityResults' && tweet.tweet) {
    return tweet.tweet
  }
  return tweet
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
        const tweet = unwrapTweet(content?.itemContent?.tweet_results?.result)
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

function articleBlocksText(article: ArticleResult): string {
  return (article.content_state?.blocks ?? [])
    .map((b) => (b.text ?? '').trim())
    .filter(Boolean)
    .join('\n\n')
}

function articleBody(article: ArticleResult | undefined): string {
  if (!article) return ''
  return decodeHtmlEntities(article.content || articleBlocksText(article))
}

function tweetFullText(tweet: TweetResult): string {
  const noteText = tweet.note_tweet?.note_tweet_results?.result?.text
  if (noteText) return decodeHtmlEntities(noteText)

  const article = tweet.article?.article_results?.result
  if (article) {
    const body = articleBody(article)
    const parts = [article.title, body].filter(Boolean) as string[]
    if (parts.length > 0) return decodeHtmlEntities(parts.join('\n\n'))
  }

  return decodeHtmlEntities(tweet.legacy?.full_text ?? '')
}

function tweetUser(tweet: TweetResult): UserCore {
  const user = tweet.core?.user_results?.result
  return user?.core ?? user?.legacy ?? {}
}

function tweetUrls(tweet: TweetResult): string[] {
  const legacyUrls = tweet.legacy?.entities?.urls ?? []
  const noteUrls = tweet.note_tweet?.note_tweet_results?.result?.entity_set?.urls ?? []
  return [...new Set(
    [...legacyUrls, ...noteUrls]
      .map((u) => u.expanded_url ?? u.unwound_url ?? u.url ?? '')
      .filter(Boolean)
  )]
}

function cardValue(card: CardLegacy | undefined, key: string): string | undefined {
  const value = card?.binding_values?.find((entry) => entry.key === key)?.value
  return value?.string_value ?? value?.image_value?.url
}

function cardMetadata(tweet: TweetResult) {
  const card = tweet.card?.legacy
  if (!card) return undefined

  return {
    type: card.name ?? null,
    url: card.url ?? tweet.card?.rest_id ?? null,
    title: cardValue(card, 'title') ?? null,
    description: cardValue(card, 'description') ?? null,
    domain: cardValue(card, 'domain') ?? cardValue(card, 'vanity_url') ?? null,
    imageUrl:
      cardValue(card, 'thumbnail_image_original') ??
      cardValue(card, 'summary_photo_image_original') ??
      cardValue(card, 'photo_image_full_size_original') ??
      null,
  }
}

function articleMetadata(tweet: TweetResult) {
  const article = tweet.article?.article_results?.result
  if (!article) return undefined

  return {
    articleId: article.rest_id ?? null,
    title: article.title ?? null,
    previewText: article.preview_text ?? null,
    body: articleBody(article),
    coverUrl:
      article.cover_media?.media_info?.original_img_url ??
      article.preview_image?.url ??
      null,
  }
}

function relatedTweet(tweet: TweetResult | undefined) {
  const unwrapped = unwrapTweet(tweet)
  if (!unwrapped?.rest_id) return undefined
  const user = tweetUser(unwrapped)
  return {
    tweetId: unwrapped.rest_id,
    authorHandle: user.screen_name ?? 'unknown',
    authorName: user.name ?? 'Unknown',
    text: tweetFullText(unwrapped),
    urls: tweetUrls(unwrapped),
    media: extractMedia(unwrapped),
    card: cardMetadata(unwrapped),
    article: articleMetadata(unwrapped),
  }
}

function quotedTweet(tweet: TweetResult): TweetResult | undefined {
  return unwrapTweet(tweet.quoted_status_result?.result)
}

function repostedTweet(tweet: TweetResult): TweetResult | undefined {
  return unwrapTweet(
    tweet.retweeted_status_result?.result ??
    tweet.legacy?.retweeted_status_result?.result
  )
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

  const article = articleMetadata(tweet)
  if (article?.coverUrl) {
    results.push({ type: 'photo', url: article.coverUrl, thumbnailUrl: article.coverUrl })
  }

  const card = cardMetadata(tweet)
  if (card?.imageUrl) {
    results.push({ type: 'photo', url: card.imageUrl, thumbnailUrl: card.imageUrl })
  }

  return [...new Map(results.map((item) => [item.url, item])).values()]
}

export function normalizeTweetForImport(input: unknown) {
  const tweet = unwrapTweet(input as TweetResult)
  if (!tweet?.rest_id) throw new Error('Twitter tweet is missing rest_id')

  const media = extractMedia(tweet)
  const quote = relatedTweet(quotedTweet(tweet))
  const repost = relatedTweet(repostedTweet(tweet))
  const user = tweetUser(tweet)
  const legacy = tweet.legacy
  const createdAt = legacy?.created_at ? new Date(legacy.created_at) : null
  const tweetType = repost
    ? 'repost'
    : quote
      ? 'quote'
      : legacy?.self_thread
        ? 'thread'
        : legacy?.in_reply_to_status_id_str
          ? 'reply'
          : 'original'

  const entities = {
    hashtags: [...new Set((legacy?.entities?.hashtags ?? [])
      .map((h) => h.tag ?? h.text ?? '')
      .filter(Boolean))],
    urls: tweetUrls(tweet),
    mentions: [...new Set((legacy?.entities?.user_mentions ?? [])
      .map((m) => m.username ?? m.screen_name ?? '')
      .filter(Boolean))],
    tools: [] as string[],
    tweetType,
    hasMedia: media.length > 0,
    mediaTypes: [...new Set(media.map((item) => item.type))],
    quote,
    repost,
    noteTweet: tweet.note_tweet?.note_tweet_results?.result?.text
      ? { text: decodeHtmlEntities(tweet.note_tweet.note_tweet_results.result.text) }
      : undefined,
    card: cardMetadata(tweet),
    article: articleMetadata(tweet),
  }

  return {
    tweetId: tweet.rest_id,
    text: tweetFullText(tweet),
    authorHandle: user.screen_name ?? 'unknown',
    authorName: user.name ?? 'Unknown',
    tweetCreatedAt: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : null,
    rawJson: JSON.stringify(tweet),
    entities,
    media,
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: {
    authToken?: string
    ct0?: string
    source?: string
    userId?: string
    tweets?: unknown[]
  } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { authToken, ct0 } = body
  const source: Source = body.source === 'like' ? 'like' : 'bookmark'
  const userId = body.userId?.trim()
  const capturedTweets = body.tweets === undefined ? null : body.tweets

  if (capturedTweets !== null && !Array.isArray(capturedTweets)) {
    return NextResponse.json({ error: 'tweets must be an array' }, { status: 400 })
  }
  if (capturedTweets !== null && capturedTweets.length === 0) {
    return NextResponse.json({ error: 'No captured tweets provided' }, { status: 400 })
  }
  if (capturedTweets === null && (!authToken?.trim() || !ct0?.trim())) {
    return NextResponse.json({ error: 'authToken and ct0 are required' }, { status: 400 })
  }
  if (capturedTweets === null && source === 'like' && !userId) {
    return NextResponse.json({ error: 'userId is required for importing likes' }, { status: 400 })
  }

  let imported = 0
  let updated = 0
  let skipped = 0
  const importedTweetIds: string[] = []
  const updatedTweetIds: string[] = []
  let cursor: string | undefined

  try {
    while (true) {
      let tweets: TweetResult[]
      let nextCursor: string | null = null

      if (capturedTweets !== null) {
        tweets = capturedTweets
          .map((tweet) => unwrapTweet(tweet as TweetResult))
          .filter((tweet): tweet is TweetResult => Boolean(tweet?.rest_id))
      } else {
        const data = await fetchPage(authToken!.trim(), ct0!.trim(), source, cursor, userId)
        const parsed = parsePage(data, source)
        tweets = parsed.tweets
        nextCursor = parsed.nextCursor
      }

      for (const tweet of tweets) {
        const normalized = normalizeTweetForImport(tweet)
        const exists = await prisma.bookmark.findUnique({
          where: { tweetId: normalized.tweetId },
          select: { id: true, text: true, entities: true },
        })

        if (exists) {
          // Update-in-place ONLY when the new capture is meaningfully richer.
          // The original DOM scrape stored truncated text ("...one good point
          // of") with empty URLs; the GraphQL payload now carries the full
          // note_tweet plus its entity_set URLs, and possibly newly-available
          // quote/repost/card/article structure. "Richer" therefore means ANY
          // of: substantially longer text, new expanded URLs, or newly-present
          // quote/repost/card/article — not text length alone. Never downgrade.
          const oldLen = (exists.text ?? '').length
          const newLen = normalized.text.length
          const textIsRicher = newLen > oldLen + 20

          let oldEntities: {
            urls?: string[]
            quote?: unknown
            repost?: unknown
            card?: unknown
            article?: unknown
          } = {}
          try {
            oldEntities = exists.entities ? JSON.parse(exists.entities) : {}
          } catch {
            oldEntities = {}
          }
          const oldUrls = new Set(Array.isArray(oldEntities.urls) ? oldEntities.urls : [])
          const hasNewUrls = normalized.entities.urls.some((u) => !oldUrls.has(u))
          const gainedStructure =
            (!oldEntities.quote && !!normalized.entities.quote) ||
            (!oldEntities.repost && !!normalized.entities.repost) ||
            (!oldEntities.card && !!normalized.entities.card) ||
            (!oldEntities.article && !!normalized.entities.article)

          const isRicher = textIsRicher || hasNewUrls || gainedStructure
          // Only update when the fresh capture is richer AND not a text
          // downgrade. Requiring newLen >= oldLen lets us use normalized.text +
          // normalized.rawJson directly (they always agree). A rare
          // shorter-but-metadata-richer capture is simply skipped to prevent a
          // text downgrade.
          if (!isRicher || newLen < oldLen) {
            skipped++
            continue
          }

          // Merge entities: authoritative fresh capture layered over the old,
          // so unknown enrichment-derived fields survive a re-import. `tools`
          // (written later by categorization) is explicitly preserved when the
          // fresh capture has none, since re-enrichment may not re-derive it.
          const oldTools = Array.isArray((oldEntities as { tools?: unknown }).tools)
            ? ((oldEntities as { tools?: string[] }).tools ?? [])
            : []
          const mergedEntities = {
            ...oldEntities,
            ...normalized.entities,
            tools: normalized.entities.tools.length ? normalized.entities.tools : oldTools,
          }
          // bookmark update + missing-media insert in one transaction so a
          const newMediaRows = normalized.media.length
            ? await (async () => {
                const existingMedia = await prisma.mediaItem.findMany({
                  where: { bookmarkId: exists.id },
                  select: { url: true },
                })
                const haveUrls = new Set(existingMedia.map((m) => m.url))
                return normalized.media.filter((m) => !haveUrls.has(m.url))
              })()
            : []

          await prisma.$transaction([
            prisma.bookmark.update({
              where: { id: exists.id },
              data: {
                text: normalized.text,
                rawJson: normalized.rawJson,
                entities: JSON.stringify(mergedEntities),
                authorHandle: normalized.authorHandle,
                authorName: normalized.authorName,
                tweetCreatedAt: normalized.tweetCreatedAt,
                // Force re-enrichment: the enriched fields describe the OLD
                // truncated text. Clearing enrichedAt/semanticTags requeues
                // this row for /api/categorize WITHOUT deleting media/OCR.
                enrichedAt: null,
                semanticTags: null,
                enrichmentMeta: null,
              },
            }),
            ...(newMediaRows.length
              ? [
                  prisma.mediaItem.createMany({
                    data: newMediaRows.map((media) => ({
                      bookmarkId: exists.id,
                      type: media.type,
                      url: media.url,
                      thumbnailUrl: media.thumbnailUrl ?? null,
                    })),
                  }),
                ]
              : []),
          ])

          updated++
          updatedTweetIds.push(normalized.tweetId)
          continue
        }

        const created = await prisma.bookmark.create({
          data: {
            tweetId: normalized.tweetId,
            text: normalized.text,
            authorHandle: normalized.authorHandle,
            authorName: normalized.authorName,
            tweetCreatedAt: normalized.tweetCreatedAt,
            rawJson: normalized.rawJson,
            entities: JSON.stringify(normalized.entities),
            source,
          },
        })

        if (normalized.media.length > 0) {
          await prisma.mediaItem.createMany({
            data: normalized.media.map((media) => ({
              bookmarkId: created.id,
              type: media.type,
              url: media.url,
              thumbnailUrl: media.thumbnailUrl ?? null,
            })),
          })
        }

        imported++
        importedTweetIds.push(normalized.tweetId)
      }

      // Browser-captured daily imports are already a complete, bounded batch.
      if (capturedTweets !== null || !nextCursor || tweets.length === 0) break
      cursor = nextCursor
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to import Twitter bookmarks' },
      { status: 500 }
    )
  }

  // The daily browser-captured path owns its own new-only enrichment budget.
  // Keep the existing UI/auth import behavior unchanged.
  if (
    capturedTweets === null &&
    imported > 0 &&
    process.env.AUTO_CATEGORIZE_AFTER_IMPORT === 'true'
  ) {
    const origin = request.nextUrl.origin
    void fetch(`${origin}/api/categorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: false }),
    }).catch(() => { /* best-effort */ })
  }

  return NextResponse.json({
    imported,
    updated,
    skipped,
    importedTweetIds,
    updatedTweetIds,
    parsed: capturedTweets?.length ?? undefined,
  })
}
