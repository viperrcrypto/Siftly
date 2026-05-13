export interface ParsedMedia {
  type: 'photo' | 'video' | 'gif'
  url: string
  thumbnailUrl?: string
}

export interface ParsedBookmark {
  tweetId: string
  text: string
  authorHandle: string
  authorName: string
  tweetCreatedAt: Date | null
  hashtags: string[]
  urls: string[]
  media: ParsedMedia[]
  rawJson: string
}

interface TwitterMediaVariant {
  content_type?: string
  bitrate?: number
  url?: string
}

interface TwitterMediaEntity {
  type?: string
  media_url_https?: string
  media_url?: string
  video_info?: {
    variants?: TwitterMediaVariant[]
  }
}

interface TwitterUrlEntity {
  expanded_url?: string
  url?: string
}

interface TwitterHashtagEntity {
  text?: string
}

interface TwitterEntities {
  hashtags?: TwitterHashtagEntity[]
  urls?: TwitterUrlEntity[]
  media?: TwitterMediaEntity[]
}

interface TwitterUser {
  screen_name?: string
  name?: string
}

interface RawTweet {
  id_str?: string
  id?: string | number
  full_text?: string
  text?: string
  created_at?: string
  user?: TwitterUser
  entities?: TwitterEntities
  extended_entities?: {
    media?: TwitterMediaEntity[]
  }
  [key: string]: unknown
}

function extractTweetId(tweet: RawTweet): string | null {
  const raw = tweet.id_str ?? tweet.id
  if (raw == null) return null
  return String(raw)
}

function extractText(tweet: RawTweet): string {
  return tweet.full_text ?? tweet.text ?? ''
}

function extractAuthorHandle(tweet: RawTweet): string {
  return tweet.user?.screen_name ?? 'unknown'
}

function extractAuthorName(tweet: RawTweet): string {
  return tweet.user?.name ?? 'Unknown'
}

function extractCreatedAt(tweet: RawTweet): Date | null {
  if (!tweet.created_at) return null
  const parsed = new Date(tweet.created_at)
  return isNaN(parsed.getTime()) ? null : parsed
}

function extractHashtags(tweet: RawTweet): string[] {
  const tags = tweet.entities?.hashtags ?? []
  return tags
    .map((h) => h.text ?? '')
    .filter((t) => t.length > 0)
}

function extractUrls(tweet: RawTweet): string[] {
  const urlEntities = tweet.entities?.urls ?? []
  return urlEntities
    .map((u) => u.expanded_url ?? u.url ?? '')
    .filter((u) => u.length > 0)
}

function pickHighestBitrateVariant(variants: TwitterMediaVariant[]): string | null {
  const videoVariants = variants.filter(
    (v) => v.content_type === 'video/mp4' && v.url
  )
  if (videoVariants.length === 0) return null

  const sorted = [...videoVariants].sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))
  return sorted[0].url ?? null
}

function mediaTypeFromString(type: string | undefined): 'photo' | 'video' | 'gif' {
  if (type === 'video') return 'video'
  if (type === 'animated_gif') return 'gif'
  return 'photo'
}

function extractMedia(tweet: RawTweet): ParsedMedia[] {
  const mediaEntities =
    tweet.extended_entities?.media ??
    tweet.entities?.media ??
    []

  return mediaEntities
    .map((m): ParsedMedia | null => {
      const mediaType = mediaTypeFromString(m.type)
      const thumbnailUrl = m.media_url_https ?? m.media_url ?? undefined

      if (mediaType === 'video' || mediaType === 'gif') {
        const variants = m.video_info?.variants ?? []
        const url = pickHighestBitrateVariant(variants) ?? thumbnailUrl ?? ''
        if (!url) return null
        return { type: mediaType, url, thumbnailUrl }
      }

      const url = thumbnailUrl ?? ''
      if (!url) return null
      return { type: 'photo', url, thumbnailUrl }
    })
    .filter((m): m is ParsedMedia => m !== null)
}

function parseSingleTweet(tweet: RawTweet): ParsedBookmark | null {
  const tweetId = extractTweetId(tweet)
  if (!tweetId) return null

  // Skip entries that some JSON exports include but that the AI pipeline can
  // never enrich (0 semantic tags -> they end up force-classified as "general"):
  //  - preview cards captured as tweets (id_str prefixed "card://")
  //  - the id is a t.co URL string instead of a numeric id (extraction error in the export)
  //  - deleted/inaccessible tweets where the export only kept an id (empty text AND no user data;
  //    note some exports write the literal "unknown" as screen_name)
  //  - quote-tweets that are just a bare t.co URL with no media (no usable signal at all)
  if (tweetId.startsWith('card://')) return null
  if (tweetId.startsWith('http://') || tweetId.startsWith('https://') || tweetId.startsWith('t.co/')) return null

  const text = extractText(tweet)
  const handle = tweet.user?.screen_name
  const hasUser = !!((handle && handle !== 'unknown') || tweet.user?.name)
  if (text === '' && !hasUser) return null

  const media = extractMedia(tweet)
  const isUrlOnly = /^https?:\/\/t\.co\/\S+\s*$/.test(text)
  if (isUrlOnly && media.length === 0) return null

  return {
    tweetId,
    text,
    authorHandle: extractAuthorHandle(tweet),
    authorName: extractAuthorName(tweet),
    tweetCreatedAt: extractCreatedAt(tweet),
    hashtags: extractHashtags(tweet),
    urls: extractUrls(tweet),
    media,
    rawJson: JSON.stringify(tweet),
  }
}

interface FlatExportRow {
  'Tweet Id'?: string
  'Full Text'?: string
  'Created At'?: string
  'User Screen Name'?: string
  'User Name'?: string
  'Media URLs'?: string
  'Media Types'?: string
  'Hashtags'?: string
  'Expanded URLs'?: string
  [key: string]: unknown
}

function isFlatExportFormat(item: unknown): item is FlatExportRow {
  if (typeof item !== 'object' || item === null) return false
  return 'Tweet Id' in item || 'Full Text' in item
}

function convertFlatExportRow(row: FlatExportRow): RawTweet {
  const mediaUrls = row['Media URLs'] ? row['Media URLs'].split(',').map((u) => u.trim()).filter(Boolean) : []
  const mediaTypes = row['Media Types'] ? row['Media Types'].split(',').map((t) => t.trim()).filter(Boolean) : []
  const mediaEntities: TwitterMediaEntity[] = mediaUrls.map((url, i) => {
    const rawType = mediaTypes[i] ?? 'photo'
    const type = rawType === 'video' ? 'video' : rawType === 'gif' ? 'animated_gif' : 'photo'
    if (type === 'video' || type === 'animated_gif') {
      return { type, media_url_https: url, video_info: { variants: [{ content_type: 'video/mp4', bitrate: 0, url }] } }
    }
    return { type, media_url_https: url }
  })

  const hashtags = row['Hashtags'] ? row['Hashtags'].split(',').map((h) => ({ text: h.trim() })).filter((h) => h.text) : []
  const urls = row['Expanded URLs'] ? row['Expanded URLs'].split(',').map((u) => ({ expanded_url: u.trim() })).filter((u) => u.expanded_url) : []

  return {
    id_str: row['Tweet Id'],
    full_text: row['Full Text'],
    created_at: row['Created At'],
    user: { screen_name: row['User Screen Name'], name: row['User Name'] },
    entities: { hashtags, urls, media: mediaEntities.length > 0 ? mediaEntities : undefined },
    extended_entities: mediaEntities.length > 0 ? { media: mediaEntities } : undefined,
  }
}

interface ConsoleExportBookmark {
  id?: string
  author?: string
  handle?: string
  timestamp?: string
  text?: string
  media?: { type?: string; url?: string }[]
  hashtags?: string[]
  urls?: string[]
}

function isConsoleExportFormat(obj: unknown): obj is { bookmarks: ConsoleExportBookmark[] } {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'bookmarks' in obj &&
    Array.isArray((obj as Record<string, unknown>).bookmarks)
  )
}

function convertConsoleExportRow(row: ConsoleExportBookmark): RawTweet {
  const mediaEntities: TwitterMediaEntity[] = (row.media ?? [])
    .filter((m) => m.url)
    .map((m) => {
      const type = m.type === 'video' ? 'video' : m.type === 'gif' ? 'animated_gif' : 'photo'
      if (type === 'video' || type === 'animated_gif') {
        return { type, media_url_https: m.url, video_info: { variants: [{ content_type: 'video/mp4', bitrate: 0, url: m.url! }] } }
      }
      return { type, media_url_https: m.url }
    })

  const handle = (row.handle ?? '').replace(/^@/, '')

  return {
    id_str: row.id,
    full_text: row.text,
    created_at: row.timestamp,
    user: { screen_name: handle || 'unknown', name: row.author || handle || 'Unknown' },
    entities: {
      hashtags: (row.hashtags ?? []).map((h) => ({ text: h })),
      urls: (row.urls ?? []).map((u) => ({ expanded_url: u })),
      media: mediaEntities.length > 0 ? mediaEntities : undefined,
    },
    extended_entities: mediaEntities.length > 0 ? { media: mediaEntities } : undefined,
  }
}

interface SiftlyExportItem {
  tweetId?: string
  text?: string
  authorHandle?: string
  authorName?: string
  tweetCreatedAt?: string
  mediaItems?: { type?: string; url?: string; thumbnailUrl?: string }[]
  [key: string]: unknown
}

function isSiftlyExportFormat(item: unknown): item is SiftlyExportItem {
  if (typeof item !== 'object' || item === null) return false
  return 'tweetId' in item && 'text' in item
}

function convertSiftlyExportRow(row: SiftlyExportItem): RawTweet {
  const mediaEntities: TwitterMediaEntity[] = (row.mediaItems ?? [])
    .filter((m) => m.url)
    .map((m) => {
      const type = m.type === 'video' ? 'video' : m.type === 'gif' ? 'animated_gif' : 'photo'
      if (type === 'video' || type === 'animated_gif') {
        return { type, media_url_https: m.url, video_info: { variants: [{ content_type: 'video/mp4', bitrate: 0, url: m.url! }] } }
      }
      return { type, media_url_https: m.url }
    })

  return {
    id_str: row.tweetId,
    full_text: row.text,
    created_at: row.tweetCreatedAt,
    user: { screen_name: row.authorHandle || 'unknown', name: row.authorName || 'Unknown' },
    entities: { media: mediaEntities.length > 0 ? mediaEntities : undefined },
    extended_entities: mediaEntities.length > 0 ? { media: mediaEntities } : undefined,
  }
}

function normalizeTweetArray(parsed: unknown): RawTweet[] {
  // Console script export format: { exportDate, totalBookmarks, bookmarks: [...] }
  if (isConsoleExportFormat(parsed)) {
    return parsed.bookmarks.map(convertConsoleExportRow)
  }

  if (Array.isArray(parsed)) {
    if (parsed.length > 0 && isFlatExportFormat(parsed[0])) {
      return parsed.map((row) => convertFlatExportRow(row as FlatExportRow))
    }
    // Siftly re-export format: [{ tweetId, text, authorHandle, ... }]
    if (parsed.length > 0 && isSiftlyExportFormat(parsed[0])) {
      return parsed.map((row) => convertSiftlyExportRow(row as SiftlyExportItem))
    }
    return parsed as RawTweet[]
  }

  if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>

    // twitter-web-exporter wraps in a top-level key
    for (const key of Object.keys(obj)) {
      const val = obj[key]
      if (Array.isArray(val)) {
        return val as RawTweet[]
      }
    }
  }

  return []
}

export function parseBookmarksJson(jsonString: string): ParsedBookmark[] {
  if (!jsonString || jsonString.trim() === '') {
    throw new Error('Empty JSON string provided')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonString)
  } catch (err) {
    throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }

  const tweets = normalizeTweetArray(parsed)

  const results: ParsedBookmark[] = []
  for (const tweet of tweets) {
    const bookmark = parseSingleTweet(tweet)
    if (bookmark !== null) {
      results.push(bookmark)
    }
  }

  return results
}
