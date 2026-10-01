export interface UrlCandidate {
  originalUrl: string
  expandedUrl: string
  unwoundUrl?: string
  canonicalInputUrl: string
  aliases: string[]
}

type UrlEntity = Record<string, unknown>

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const url = value.trim().replace(/[).,]+$/, '')
  try { return /^https?:$/.test(new URL(url).protocol) ? url : undefined } catch { return undefined }
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => !!value))]
}

export function urlCandidate(value: unknown): UrlCandidate | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'originalUrl' in value) {
    const supplied = value as Partial<UrlCandidate>
    const originalUrl = httpUrl(supplied.originalUrl)
    const expandedUrl = httpUrl(supplied.expandedUrl) ?? originalUrl
    const unwoundUrl = httpUrl(supplied.unwoundUrl)
    const canonicalInputUrl = httpUrl(supplied.canonicalInputUrl) ?? unwoundUrl ?? expandedUrl
    if (!originalUrl || !expandedUrl || !canonicalInputUrl) return undefined
    return { originalUrl, expandedUrl, ...(unwoundUrl ? { unwoundUrl } : {}), canonicalInputUrl, aliases: unique([originalUrl, expandedUrl, unwoundUrl, ...(supplied.aliases ?? []).map(httpUrl)]) }
  }
  const entity = typeof value === 'string' ? { url: value } : value as UrlEntity
  if (!entity || typeof entity !== 'object') return undefined
  const originalUrl = httpUrl(entity.url) ?? httpUrl(entity.expanded_url) ?? httpUrl(entity.expandedUrl) ?? httpUrl(entity.unwound_url) ?? httpUrl(entity.unwoundUrl)
  const expandedUrl = httpUrl(entity.expanded_url) ?? httpUrl(entity.expandedUrl) ?? originalUrl
  const unwoundUrl = httpUrl(entity.unwound_url) ?? httpUrl(entity.unwoundUrl)
  if (!originalUrl || !expandedUrl) return undefined
  return { originalUrl, expandedUrl, ...(unwoundUrl ? { unwoundUrl } : {}), canonicalInputUrl: unwoundUrl ?? expandedUrl, aliases: unique([originalUrl, expandedUrl, unwoundUrl]) }
}

function urlEntities(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function textUrls(value: unknown): string[] {
  return typeof value === 'string' ? value.match(/https?:\/\/[^\s"'<>]+/g) ?? [] : []
}

/** Extract only post-owned URL fields; profile, core and media trees are intentionally excluded. */
export function urlCandidatesFrom(raw: unknown, text = ''): UrlCandidate[] {
  let post = raw
  if (typeof raw === 'string') {
    try { post = JSON.parse(raw) } catch { post = {} }
  }
  if (!post || typeof post !== 'object' || Array.isArray(post)) return textUrls(text).map(urlCandidate).filter((candidate): candidate is UrlCandidate => !!candidate)
  const row = post as Record<string, unknown>
  const entities = row.entities as UrlEntity | undefined
  const noteTweet = row.note_tweet as UrlEntity | undefined
  const noteResult = noteTweet?.note_tweet_results as UrlEntity | undefined
  const noteEntitySet = noteResult?.result && typeof noteResult.result === 'object' ? (noteResult.result as UrlEntity).entity_set as UrlEntity | undefined : undefined
  const legacy = row.legacy as UrlEntity | undefined
  const legacyEntities = legacy?.entities as UrlEntity | undefined
  const inputs = [
    ...urlEntities(entities?.urls),
    ...urlEntities((noteTweet?.entities as UrlEntity | undefined)?.urls),
    ...urlEntities(noteEntitySet?.urls),
    ...urlEntities(legacyEntities?.urls),
    row.url,
    ...urlEntities(row.urls),
    ...textUrls(text),
    ...textUrls(row.text),
    ...textUrls(noteTweet?.text),
    ...textUrls(legacy?.full_text),
  ]
  const candidates = inputs.map(urlCandidate).filter((candidate): candidate is UrlCandidate => !!candidate)
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = candidate.aliases.join('\n')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
