import prisma from '@/lib/db'

// ── Constants ─────────────────────────────────────────────────────────────────

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

// Query ID for Twitter's internal Bookmarks GraphQL endpoint
// This can change when Twitter deploys updates — update if you get 400 errors
const QUERY_ID = 'xLjCVTqYWz8CGSprLU349w'

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface ArticleCoverMedia {
  media_info?: { original_img_url?: string }
}

interface ArticleBlock {
  text?: string
  type?: string
}

interface ArticleResult {
  title?: string
  preview_image?: { url?: string }
  cover_media?: ArticleCoverMedia
  content?: string
  // Some X article payloads include a Draft.js-like content_state
  content_state?: { blocks?: ArticleBlock[] }
}

export interface TweetResult {
  __typename?: string
  rest_id?: string
  legacy?: TweetLegacy
  core?: { user_results?: { result?: { legacy?: UserLegacy } } }
  note_tweet?: { note_tweet_results?: { result?: { text?: string } } }
  article?: { article_results?: { result?: ArticleResult } }
  tweet?: TweetResult
}

// ── Fetch + Parse ─────────────────────────────────────────────────────────────

export async function fetchPage(authToken: string, ct0: string, cursor?: string) {
  const variables = JSON.stringify({
    count: 100,
    includePromotedContent: false,
    ...(cursor ? { cursor } : {}),
  })

  const url = `https://x.com/i/api/graphql/${QUERY_ID}/Bookmarks?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(FEATURES)}`

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${BEARER}`,
      'X-Csrf-Token': ct0,
      Cookie: `auth_token=${authToken}; ct0=${ct0}`,
      'X-Twitter-Auth-Type': 'OAuth2Session',
      'X-Twitter-Active-User': 'yes',
      'X-Twitter-Client-Language': 'en',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://x.com/i/bookmarks',
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Twitter API ${res.status}: ${text.slice(0, 300)}`)
  }

  try {
    return await res.json()
  } catch {
    throw new Error('Twitter returned an invalid response (not JSON)')
  }
}

export function parsePage(data: unknown): { tweets: TweetResult[]; nextCursor: string | null } {
  const instructions =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (data as any)?.data?.bookmark_timeline_v2?.timeline?.instructions ?? []

  const tweets: TweetResult[] = []
  let nextCursor: string | null = null

  for (const instruction of instructions) {
    if (instruction.type !== 'TimelineAddEntries') continue
    for (const entry of instruction.entries ?? []) {
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

export function extractMedia(tweet: TweetResult) {
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

  // If no media from entities, try article cover/preview image
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

export function tweetFullText(tweet: TweetResult): string {
  if (tweet.note_tweet?.note_tweet_results?.result?.text) {
    return decodeHtmlEntities(tweet.note_tweet.note_tweet_results.result.text)
  }

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

    if (parts.length > 0) return decodeHtmlEntities(parts.join('\n\n'))
  }

  return decodeHtmlEntities(tweet.legacy?.full_text ?? '')
}

// ── Import tweets to DB ───────────────────────────────────────────────────────

export async function importTweets(
  tweets: TweetResult[],
): Promise<{ imported: number; skipped: number }> {
  let imported = 0
  let skipped = 0

  for (const tweet of tweets) {
    if (!tweet.rest_id) continue

    try {
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

      const rawDate = tweet.legacy?.created_at
      let parsedDate: Date | null = null
      if (rawDate) {
        const d = new Date(rawDate)
        if (!isNaN(d.getTime())) parsedDate = d
      }

      const created = await prisma.bookmark.create({
        data: {
          tweetId: tweet.rest_id,
          text: tweetFullText(tweet),
          authorHandle: userLegacy.screen_name ?? 'unknown',
          authorName: userLegacy.name ?? 'Unknown',
          tweetCreatedAt: parsedDate,
          rawJson: JSON.stringify(tweet),
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
    } catch (err) {
      console.error(`[twitter-api] Failed to import tweet ${tweet.rest_id}:`, err instanceof Error ? err.message : err)
    }
  }

  return { imported, skipped }
}
