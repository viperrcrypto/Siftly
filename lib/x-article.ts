type JsonRecord = Record<string, unknown>

export interface XArticleMediaRef {
  mediaKey?: string
  url?: string
  thumbnailUrl?: string
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
}

/** Supports both REST `article` and GraphQL `article_results.result` payloads. */
export function getXArticle(tweet: unknown): JsonRecord | null {
  const root = record(tweet)
  const direct = record(root?.article)
  if (!direct) return null
  const results = record(direct.article_results)
  const result = record(results?.result)
  return result ?? direct
}

function contentStateText(article: JsonRecord): string {
  const state = record(article.content_state) ?? record(article.contentState)
  const blocks = Array.isArray(state?.blocks) ? state.blocks : []
  return blocks
    .map((block) => text(record(block)?.text))
    .filter(Boolean)
    .join('\n\n')
}

/** Returns the best available title + body, without dropping long Article blocks. */
export function getXArticleText(tweet: unknown): { title: string; body: string; text: string } {
  const article = getXArticle(tweet)
  if (!article) return { title: '', body: '', text: '' }

  const title = text(article.title)
  const body = text(article.plain_text) || text(article.plainText) || text(article.content) || contentStateText(article)
  const parts = [title, body].filter(Boolean).map(decodeHtmlEntities)
  return { title, body, text: parts.join('\n\n') }
}

function mediaRef(value: unknown): XArticleMediaRef | null {
  if (typeof value === 'string' && value.trim()) {
    const normalized = value.trim()
    return /^https?:\/\//i.test(normalized)
      ? { url: normalized, thumbnailUrl: normalized }
      : { mediaKey: normalized }
  }
  const item = record(value)
  if (!item) return null
  const info = record(item.media_info) ?? record(item.mediaInfo)
  const preview = record(item.preview_image) ?? record(item.previewImage)
  const mediaKey = text(item.media_key) || text(item.mediaKey) || text(item.key) || text(item.id_str) || text(item.id)
  const url = text(item.url) || text(item.media_url_https) || text(info?.original_img_url) || text(info?.originalImgUrl)
  const thumbnailUrl = text(item.preview_image_url) || text(preview?.url) || url
  if (!mediaKey && !url) return null
  return { ...(mediaKey ? { mediaKey } : {}), ...(url ? { url } : {}), ...(thumbnailUrl ? { thumbnailUrl } : {}) }
}

/** Normalizes Article cover/media entities, including expanded object shapes. */
export function getXArticleMedia(tweet: unknown): XArticleMediaRef[] {
  const article = getXArticle(tweet)
  if (!article) return []
  const values = [article.cover_media, article.coverMedia, article.preview_image, article.previewImage]
  for (const key of ['media_entities', 'mediaEntities']) {
    if (Array.isArray(article[key])) values.push(...article[key] as unknown[])
  }
  const seen = new Set<string>()
  const refs: XArticleMediaRef[] = []
  for (const value of values) {
    const ref = mediaRef(value)
    if (!ref) continue
    const identity = ref.mediaKey ?? ref.url
    if (!identity || seen.has(identity)) continue
    seen.add(identity)
    refs.push(ref)
  }
  return refs
}
