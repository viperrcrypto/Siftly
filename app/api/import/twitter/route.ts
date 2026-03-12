import { NextRequest, NextResponse } from 'next/server'
import { upsertTweets, type IncomingTweet } from '@/lib/upsert-tweet'

const BEARER = process.env.X_BEARER_TOKEN ?? ''

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
    queryId: 'BBxBluh79axE_HJzZPcBDw',
    operationName: 'Bookmarks',
    referer: 'https://x.com/i/bookmarks',
    getInstructions: (d: Record<string, unknown>): unknown[] =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (d as any)?.data?.bookmark_timeline_v2?.timeline?.instructions ?? [],
  },
  like: {
    queryId: 'zPJ36q7-jHyvvHcmx8yymg',
    operationName: 'Likes',
    referer: 'https://x.com',
    getInstructions: (d: Record<string, unknown>): unknown[] => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = d as any
      return a?.data?.user?.result?.timeline?.timeline?.instructions
        ?? a?.data?.user?.result?.timeline_v2?.timeline?.instructions
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
  entities?: { hashtags?: unknown[]; urls?: unknown[]; media?: MediaEntity[] }
  extended_entities?: { media?: MediaEntity[] }
}

interface UserLegacy {
  screen_name?: string
  name?: string
}

interface ArticleBlock {
  text?: string
  type?: string
}

interface ArticleResult {
  title?: string
  preview_image?: { url?: string }
  cover_media?: { media_info?: { original_img_url?: string } }
  content?: string
  // Some X article payloads include a Draft.js-like content_state
  content_state?: { blocks?: ArticleBlock[] }
}

interface UserResult {
  legacy?: UserLegacy
  core?: UserLegacy // New Twitter structure puts screen_name/name here
}

interface TweetResult {
  __typename?: string
  rest_id?: string
  legacy?: TweetLegacy
  core?: { user_results?: { result?: UserResult } }
  note_tweet?: { note_tweet_results?: { result?: { text?: string } } }
  article?: { article_results?: { result?: ArticleResult } }
  quoted_status_result?: { result?: TweetResult }
  tweet?: TweetResult
}

function getUserInfo(userResult?: UserResult): { screen_name: string; name: string } {
  return {
    screen_name: userResult?.legacy?.screen_name ?? userResult?.core?.screen_name ?? 'unknown',
    name: userResult?.legacy?.name ?? userResult?.core?.name ?? 'Unknown',
  }
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

function articleBlocksText(article: ArticleResult): string {
  const blocks = article.content_state?.blocks ?? []
  const texts = blocks
    .map((b) => (b.text ?? '').trim())
    .filter(Boolean)
    .slice(0, 8)
  return texts.join('\n\n')
}

function tweetFullText(tweet: TweetResult): string {
  let text: string
  if (tweet.note_tweet?.note_tweet_results?.result?.text) {
    text = decodeHtmlEntities(tweet.note_tweet.note_tweet_results.result.text)
  } else {
    const article = tweet.article?.article_results?.result
    if (article) {
      const parts: string[] = []
      if (article.title) parts.push(article.title)
      if (article.content) parts.push(article.content)

      // Fallback: some X articles ship content in content_state.blocks
      if (parts.length === 0) {
        const blocks = articleBlocksText(article)
        if (blocks) parts.push(blocks)
      }

      text = parts.length > 0 ? decodeHtmlEntities(parts.join('\n\n')) : decodeHtmlEntities(tweet.legacy?.full_text ?? '')
    } else {
      text = decodeHtmlEntities(tweet.legacy?.full_text ?? '')
    }
  }

  // Append quoted tweet content for better categorization
  let qt = tweet.quoted_status_result?.result
  if (qt?.__typename === 'TweetWithVisibilityResults' && qt.tweet) {
    qt = qt.tweet
  }
  if (qt) {
    const qtText = qt.legacy?.full_text || qt.note_tweet?.note_tweet_results?.result?.text
    const qtAuthor = getUserInfo(qt.core?.user_results?.result).screen_name
    if (qtText) {
      text += `\n\n[Quote @${qtAuthor}]: ${decodeHtmlEntities(qtText)}`
    }
  }

  return text
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

  if (!BEARER) {
    return NextResponse.json({ error: 'X_BEARER_TOKEN is not configured. Add it to your .env file.' }, { status: 500 })
  }

  if (!authToken?.trim() || !ct0?.trim()) {
    return NextResponse.json({ error: 'authToken and ct0 are required' }, { status: 400 })
  }

  if (source === 'like' && !userId) {
    return NextResponse.json({ error: 'userId is required for importing likes' }, { status: 400 })
  }

  let imported = 0
  let skipped = 0
  let updated = 0
  let errored = 0
  let cursor: string | undefined

  try {
    while (true) {
      const data = await fetchPage(authToken.trim(), ct0.trim(), source, cursor, userId)
      const { tweets, nextCursor } = parsePage(data, source)

      // Convert raw tweets to IncomingTweet format for the shared upsert
      const incoming: IncomingTweet[] = tweets
        .filter((t) => t.rest_id)
        .map((tweet) => {
          const { screen_name, name } = getUserInfo(tweet.core?.user_results?.result)
          return {
            tweetId: tweet.rest_id!,
            text: tweetFullText(tweet),
            authorHandle: screen_name,
            authorName: name,
            tweetCreatedAt: tweet.legacy?.created_at
              ? new Date(tweet.legacy.created_at)
              : null,
            rawJson: JSON.stringify(tweet),
            source,
            media: extractMedia(tweet),
          }
        })

      const result = await upsertTweets(incoming)
      imported += result.imported
      skipped += result.skipped
      updated += result.updated
      errored += result.errored

      if (!nextCursor || tweets.length === 0) break
      cursor = nextCursor
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch from Twitter' },
      { status: 500 }
    )
  }

  return NextResponse.json({ imported, skipped, updated, errored })
}
