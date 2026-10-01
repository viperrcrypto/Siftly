import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const MAX_OUTPUT = 2_000_000
const BROWSERS = new Set(['brave', 'chrome', 'chromium', 'edge', 'firefox', 'opera', 'safari', 'vivaldi'])

type JsonRecord = Record<string, unknown>

export interface GalleryMedia {
  type: 'photo' | 'video' | 'animated_gif'
  url: string
  mediaKey?: string
  sourceMediaIndex: number
}

export interface GalleryTweet {
  id: string
  authorId?: string
  authorHandle?: string
  conversationId?: string
  inReplyToId?: string
  quotedTweetId?: string
  quotedById?: string
  text?: string
  media: GalleryMedia[]
  raw: JsonRecord
}

export function validateGallerySettings(binaryPath?: string, browser?: string): { binaryPath?: string; browser?: string } {
  if (binaryPath && binaryPath !== 'gallery-dl' && (!binaryPath.startsWith('/') || binaryPath.includes('\0') || /[\r\n]/.test(binaryPath))) throw new Error('Invalid gallery-dl path')
  if (browser) {
    const [name, profile, ...rest] = browser.split(':')
    if (rest.length || !BROWSERS.has(name) || (profile && !/^[A-Za-z0-9 _.-]{1,80}$/.test(profile))) throw new Error('Invalid cookie browser')
  }
  return { binaryPath, browser }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function recordAt(row: JsonRecord | undefined, key: string): JsonRecord | undefined {
  const value = row?.[key]
  return isRecord(value) ? value : undefined
}

function stringAt(row: JsonRecord | undefined, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row?.[key]
    if (typeof value === 'string' || typeof value === 'number') return String(value)
  }
  return undefined
}

function nestedRecord(row: JsonRecord | undefined, ...keys: string[]): JsonRecord | undefined {
  let current = row
  for (const key of keys) {
    current = recordAt(current, key)
    if (!current) return undefined
  }
  return current
}

function firstRecord(...rows: Array<JsonRecord | undefined>): JsonRecord | undefined {
  return rows.find((row): row is JsonRecord => !!row)
}

function looksLikeTweet(row: JsonRecord): boolean {
  const legacy = recordAt(row, 'legacy')
  return !!stringAt(row, 'tweet_id') || (!!stringAt(row, 'rest_id') && !!legacy && !!stringAt(legacy, 'full_text', 'conversation_id_str', 'id_str'))
}

function tweetPayload(raw: JsonRecord): JsonRecord {
  if (looksLikeTweet(raw)) return raw
  const seen = new Set<JsonRecord>()
  const find = (value: unknown, depth: number): JsonRecord | undefined => {
    if (!isRecord(value) || depth > 12 || seen.has(value)) return undefined
    seen.add(value)
    if (looksLikeTweet(value)) return value
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) {
        for (const entry of child) {
          const tweet = find(entry, depth + 1)
          if (tweet) return tweet
        }
      } else {
        const tweet = find(child, depth + 1)
        if (tweet) return tweet
      }
    }
    return undefined
  }
  return find(raw, 0) ?? raw
}

function textFrom(row: JsonRecord, legacy: JsonRecord | undefined): string | undefined {
  const note = nestedRecord(row, 'note_tweet', 'note_tweet_results', 'result')
  return stringAt(note, 'text') ?? stringAt(row, 'content', 'text', 'full_text') ?? stringAt(legacy, 'full_text', 'text')
}

function authorFrom(row: JsonRecord): JsonRecord | undefined {
  return firstRecord(
    nestedRecord(row, 'core', 'user_results', 'result'),
    nestedRecord(row, 'user_results', 'result'),
    recordAt(row, 'author'),
    recordAt(row, 'user'),
  )
}

function quotedTweetId(row: JsonRecord, legacy: JsonRecord | undefined): string | undefined {
  return stringAt(row, 'quoted_status_id', 'quoted_status_id_str') ?? stringAt(legacy, 'quoted_status_id', 'quoted_status_id_str') ?? stringAt(nestedRecord(row, 'quoted_status_result', 'result'), 'rest_id', 'id_str', 'id')
}

export function galleryTweetFromRaw(input: JsonRecord): GalleryTweet {
  const raw = tweetPayload(input)
  const legacy = recordAt(raw, 'legacy')
  const author = authorFrom(raw)
  const authorLegacy = recordAt(author, 'legacy')
  const id = stringAt(raw, 'tweet_id', 'rest_id', 'id', 'id_str')
  if (!id) throw new Error('gallery-dl result missing tweet ID')
  return {
    id,
    authorId: stringAt(raw, 'author_id', 'user_id') ?? stringAt(author, 'rest_id', 'id', 'id_str'),
    authorHandle: stringAt(author, 'screen_name') ?? stringAt(authorLegacy, 'screen_name'),
    conversationId: stringAt(raw, 'conversation_id') ?? stringAt(legacy, 'conversation_id_str', 'conversation_id'),
    inReplyToId: stringAt(raw, 'reply_id', 'in_reply_to_status_id', 'in_reply_to_status_id_str') ?? stringAt(legacy, 'in_reply_to_status_id_str', 'in_reply_to_status_id'),
    quotedTweetId: quotedTweetId(raw, legacy),
    quotedById: stringAt(raw, 'quote_id'),
    text: textFrom(raw, legacy),
    media: [],
    raw,
  }
}

function sameMediaUrl(left: string, right: string): boolean {
  try {
    const a = new URL(left)
    const b = new URL(right)
    return a.protocol === 'https:' && b.protocol === 'https:' && a.origin === b.origin && a.pathname === b.pathname
  } catch { return false }
}

function xMp4Variant(variant: JsonRecord): { url: string; bitRate: number } | undefined {
  const url = stringAt(variant, 'url')
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'video.twimg.com' || !/\.mp4$/i.test(parsed.pathname)) return undefined
    const bitRate = Number(stringAt(variant, 'bit_rate', 'bitrate'))
    return { url, bitRate: Number.isFinite(bitRate) ? bitRate : -1 }
  } catch { return undefined }
}

function mediaForUrl(tweet: GalleryTweet, url: string): GalleryMedia | undefined {
  const legacy = recordAt(tweet.raw, 'legacy')
  const entities = recordAt(legacy, 'extended_entities')
  const media = Array.isArray(entities?.media) ? entities.media : []
  for (let index = 0; index < media.length; index++) {
    const entity = media[index]
    if (!isRecord(entity)) continue
    const type = stringAt(entity, 'type')
    if (type !== 'photo' && type !== 'video' && type !== 'animated_gif') continue
    const videoInfo = recordAt(entity, 'video_info')
    const preview = stringAt(entity, 'media_url_https', 'media_url')
    const variants = (Array.isArray(videoInfo?.variants) ? videoInfo.variants : []).filter(isRecord)
    const candidates = type === 'photo' ? [preview] : [preview, ...variants.map((variant) => stringAt(variant, 'url'))]
    if (candidates.some((candidate) => candidate && sameMediaUrl(url, candidate))) {
      const mediaUrl = type === 'photo' ? url : variants.map(xMp4Variant).filter((candidate): candidate is { url: string; bitRate: number } => !!candidate).sort((left, right) => right.bitRate - left.bitRate)[0]?.url
      if (!mediaUrl) continue
      return { type, url: mediaUrl, mediaKey: stringAt(entity, 'media_key', 'id_str', 'id'), sourceMediaIndex: index }
    }
  }
  return undefined
}

function mergeTweet(current: GalleryTweet | undefined, next: GalleryTweet, media?: GalleryMedia): GalleryTweet {
  const mediaItems = [...(current?.media ?? []), ...(media ? [media] : [])]
  return {
    ...current,
    ...next,
    media: mediaItems.filter((item, index) => mediaItems.findIndex((other) => other.sourceMediaIndex === item.sourceMediaIndex) === index),
  }
}

function dataJob(value: unknown): { metadata: JsonRecord; url?: string } | undefined {
  if (!Array.isArray(value) || (value[0] !== 2 && value[0] !== 3)) return undefined
  if (value[0] === 2 && isRecord(value[1])) return { metadata: value[1] }
  if (value[0] === 3 && typeof value[1] === 'string' && isRecord(value[2])) return { url: value[1], metadata: value[2] }
  return undefined
}

/** Parse gallery-dl 1.32 DataJobs, while accepting legacy plain metadata fixtures. */
export function galleryTweetsFromDataJobs(rows: unknown[]): GalleryTweet[] {
  const tweets = new Map<string, GalleryTweet>()
  for (const row of rows) {
    const job = dataJob(row)
    const metadata = job?.metadata ?? (isRecord(row) ? row : undefined)
    if (!metadata) continue
    let tweet: GalleryTweet
    try { tweet = galleryTweetFromRaw(metadata) } catch { continue }
    tweets.set(tweet.id, mergeTweet(tweets.get(tweet.id), tweet, job?.url ? mediaForUrl(tweet, job.url) : undefined))
  }
  return [...tweets.values()]
}

export function galleryDlArgs(browser?: string): string[] {
  const args = [
    '--config-ignore', '--no-input', '--no-download', '-j',
    '-o', 'output.num-to-str=true',
    '-o', 'extractor.twitter.transform=false',
    '-o', 'extractor.twitter.text-tweets=true',
    '-o', 'extractor.twitter.conversations=true',
    '-o', 'extractor.twitter.replies=self',
    '-o', 'extractor.twitter.quoted=true',
    '-o', 'extractor.twitter.videos=true',
    '-o', 'extractor.twitter.previews=false',
    '-o', 'extractor.twitter.articles=false',
    '-o', 'extractor.twitter.cards=false',
  ]
  if (browser) args.push('--cookies-from-browser', browser)
  return args
}

function outputRows(stdout: string): unknown[] {
  return stdout.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const value: unknown = JSON.parse(line)
    return Array.isArray(value) && !dataJob(value) ? value : [value]
  })
}

export async function resolveWithGalleryDl(tweetId: string, binaryPath: string, browser?: string): Promise<GalleryTweet[]> {
  if (!/^\d+$/.test(tweetId)) throw new Error('Invalid tweet ID')
  validateGallerySettings(binaryPath, browser)
  const url = `https://x.com/i/status/${tweetId}`
  const args = galleryDlArgs(browser)
  args.push(url)
  try {
    const { stdout, stderr } = await execFileAsync(binaryPath, args, { timeout: 30_000, maxBuffer: MAX_OUTPUT })
    if (stderr.length > MAX_OUTPUT) throw new Error('gallery-dl stderr too large')
    return galleryTweetsFromDataJobs(outputRows(stdout))
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/--cookies[^\s]*/g, '--cookies=[redacted]') : String(error)
    throw new Error(`gallery-dl failed: ${message}`)
  }
}
