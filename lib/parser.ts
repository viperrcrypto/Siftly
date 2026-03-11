export interface ParsedMedia {
  type: 'photo' | 'video' | 'gif'
  url: string
  thumbnailUrl?: string
}

export interface ParsedTweet {
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

function parseSingleTweet(tweet: RawTweet): ParsedTweet | null {
  const tweetId = extractTweetId(tweet)
  if (!tweetId) return null

  return {
    tweetId,
    text: extractText(tweet),
    authorHandle: extractAuthorHandle(tweet),
    authorName: extractAuthorName(tweet),
    tweetCreatedAt: extractCreatedAt(tweet),
    hashtags: extractHashtags(tweet),
    urls: extractUrls(tweet),
    media: extractMedia(tweet),
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
  quotedText?: string
  quotedAuthor?: string
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

  const fullText = row.quotedText
    ? `${row.text || ''}\n\n[Quote @${row.quotedAuthor || 'unknown'}]: ${row.quotedText}`
    : row.text

  return {
    id_str: row.id,
    full_text: fullText,
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

interface TwitterArchiveItem {
  like?: { tweetId?: string; fullText?: string; expandedUrl?: string }
  bookmark?: { tweetId?: string; fullText?: string; expandedUrl?: string }
}

function stripArchivePrefix(content: string): { json: string; archiveType: 'like' | 'bookmark' | null } {
  const trimmed = content.trim()
  if (!trimmed.startsWith('window.YTD.')) {
    return { json: trimmed, archiveType: null }
  }
  const match = trimmed.match(/^window\.YTD\.(\w+)\.part\d+\s*=\s*/)
  if (!match) {
    return { json: trimmed, archiveType: null }
  }
  const rawType = match[1]
  const archiveType: 'like' | 'bookmark' | null =
    rawType === 'like' ? 'like' : rawType === 'bookmark' ? 'bookmark' : null
  const json = trimmed.slice(match[0].length)
  return { json, archiveType }
}

function isTwitterArchiveFormat(items: unknown[]): boolean {
  if (items.length === 0) return false
  const first = items[0]
  if (typeof first !== 'object' || first === null) return false
  return 'like' in first || 'bookmark' in first
}

function convertArchiveItem(item: TwitterArchiveItem): RawTweet {
  const inner = item.like ?? item.bookmark
  if (!inner) {
    return {}
  }
  const urls: TwitterUrlEntity[] = inner.expandedUrl
    ? [{ expanded_url: inner.expandedUrl }]
    : []
  return {
    id_str: inner.tweetId,
    full_text: inner.fullText,
    user: { screen_name: 'unknown', name: 'Unknown' },
    entities: { urls },
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
    // Twitter/X data archive format: [{ like: {...} }] or [{ bookmark: {...} }]
    if (parsed.length > 0 && isTwitterArchiveFormat(parsed)) {
      return parsed.map((item) => convertArchiveItem(item as TwitterArchiveItem))
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

export function parseTweetsJson(jsonString: string): ParsedTweet[] {
  if (!jsonString || jsonString.trim() === '') {
    throw new Error('Empty JSON string provided')
  }

  const { json } = stripArchivePrefix(jsonString)

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (err) {
    throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }

  const tweets = normalizeTweetArray(parsed)

  const results: ParsedTweet[] = []
  for (const tweet of tweets) {
    const bookmark = parseSingleTweet(tweet)
    if (bookmark !== null) {
      results.push(bookmark)
    }
  }

  return results
}

export interface ParseResult {
  tweets: ParsedTweet[]
  detectedSource?: 'like' | 'bookmark'
}

export function parseTweetsWithMeta(content: string): ParseResult {
  if (!content || content.trim() === '') {
    throw new Error('Empty content provided')
  }

  const { json, archiveType } = stripArchivePrefix(content)

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (err) {
    throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }

  const tweets = normalizeTweetArray(parsed)

  const results: ParsedTweet[] = []
  for (const tweet of tweets) {
    const parsed = parseSingleTweet(tweet)
    if (parsed !== null) {
      results.push(parsed)
    }
  }

  return {
    tweets: results,
    detectedSource: archiveType ?? undefined,
  }
}
