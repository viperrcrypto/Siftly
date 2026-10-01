import { type UrlCandidate, urlCandidate } from '@/lib/archive/url-candidates'

export type SourceType = 'primary_source' | 'original_article' | 'reference' | 'related' | 'external_video' | 'incidental'
export interface DiscoveredPost { id: string; text: string; relationship: 'root' | 'self_reply' | 'quote'; urls: Array<string | UrlCandidate>; authorId?: string; authorHandle?: string; threadPosition?: number }
export interface ArchiveSource {
  originalUrl: string; expandedUrl: string; unwoundUrl?: string; resolvedUrl: string; canonicalUrl: string
  discoveredFromPost: string; relationship: DiscoveredPost['relationship']; context: string; sourceType: SourceType
  sourceKey: string; canonicalInputUrl: string; aliases: string[]; platform?: 'youtube' | 'vimeo' | 'tiktok'
  provenance: Array<{ discoveredFromPost: string; relationship: DiscoveredPost['relationship']; context: string; originalUrl: string; expandedUrl: string; authorId?: string; authorHandle?: string; threadPosition?: number }>
}

const EXTERNAL_VIDEO = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com)$/i
const PRIMARY_DOMAIN = /(^|\.)(doi\.org|arxiv\.org|gov|ac\.jp|who\.int|nature\.com|science\.org)$/i
const TRACKING = /(?:[?&](utm_[^=]+|ref|fbclid|gclid)=|^https?:\/\/(?:x|twitter)\.com\/[^/]+\/?(?:[?#].*)?$)/i
const PRIMARY_WORDS = /(?:公式|原論文|統計|公的|原データ|元レポート|source|primary source)/i
const ORIGINAL_WORDS = /(?:元記事|原文|記事はこちら|original article)/i
const RELATED_WORDS = /(?:関連|参考|related|background|補足)/i
const X_INTERNAL = /(?:^|\.)(x\.com|twitter\.com|twimg\.com)$/i
const SOURCE_RANK: Record<SourceType, number> = { incidental: 0, related: 1, reference: 2, original_article: 3, primary_source: 4, external_video: 5 }

function canonical(raw: string): string {
  const url = new URL(raw)
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|ref$)/i.test(key)) url.searchParams.delete(key)
  return url.toString()
}

function isTco(url: URL): boolean { return url.hostname.toLowerCase() === 't.co' }
function platform(url: URL): ArchiveSource['platform'] {
  const host = url.hostname.toLowerCase()
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return 'youtube'
  if (/(^|\.)vimeo\.com$/.test(host)) return 'vimeo'
  if (/(^|\.)tiktok\.com$/.test(host)) return 'tiktok'
  return undefined
}
function classify(url: URL, context: string): SourceType {
  if (isTco(url)) return 'incidental'
  if (EXTERNAL_VIDEO.test(url.hostname)) return 'external_video'
  if (TRACKING.test(url.toString())) return 'incidental'
  if (/\.pdf(?:$|[?#])/i.test(url.pathname) || PRIMARY_DOMAIN.test(url.hostname) || /(?:doi\.org|arxiv\.org)/i.test(url.hostname)) return 'primary_source'
  if (PRIMARY_WORDS.test(context)) return 'primary_source'
  if (ORIGINAL_WORDS.test(context)) return 'original_article'
  if (RELATED_WORDS.test(context)) return 'related'
  return 'reference'
}

function unique<T>(values: T[]): T[] { return [...new Set(values)] }
function aliases(candidate: UrlCandidate): string[] { return unique(candidate.aliases.map(canonical)) }

/** Deterministic source graph. Network resolution/canonicalization is deliberately separate. */
export function resolveSources(posts: DiscoveredPost[]): ArchiveSource[] {
  const byAlias = new Map<string, ArchiveSource>()
  const sources: ArchiveSource[] = []
  const promote = (source: ArchiveSource, next: SourceType) => {
    if (SOURCE_RANK[next] > SOURCE_RANK[source.sourceType]) source.sourceType = next
  }
  const register = (source: ArchiveSource) => {
    for (const alias of source.aliases) byAlias.set(canonical(alias), source)
    byAlias.set(source.canonicalInputUrl, source)
  }
  const merge = (target: ArchiveSource, duplicate: ArchiveSource) => {
    if (target === duplicate) return
    target.aliases = unique([...target.aliases, ...duplicate.aliases])
    target.provenance.push(...duplicate.provenance)
    promote(target, duplicate.sourceType)
    sources.splice(sources.indexOf(duplicate), 1)
    register(target)
  }

  for (const post of posts) for (const value of post.urls) {
    const candidate = urlCandidate(value)
    if (!candidate) continue
    try {
      const canonicalInputUrl = canonical(candidate.canonicalInputUrl)
      const resolvedUrl = canonical(candidate.unwoundUrl ?? candidate.canonicalInputUrl)
      const url = new URL(resolvedUrl)
      if (X_INTERNAL.test(url.hostname)) continue
      const candidateAliases = aliases(candidate)
      const existing = unique<ArchiveSource>(candidateAliases.map((alias) => byAlias.get(alias)).filter((source): source is ArchiveSource => !!source))
      const provenance = { discoveredFromPost: post.id, relationship: post.relationship, context: post.text, originalUrl: candidate.originalUrl, expandedUrl: candidate.expandedUrl, ...(post.authorId ? { authorId: post.authorId } : {}), ...(post.authorHandle ? { authorHandle: post.authorHandle } : {}), ...(post.threadPosition !== undefined ? { threadPosition: post.threadPosition } : {}) }
      if (existing.length) {
        const source = existing.find((item) => !isTco(new URL(item.canonicalInputUrl))) ?? existing[0]
        for (const duplicate of existing) merge(source, duplicate)
        source.aliases = unique([...source.aliases, ...candidate.aliases])
        source.provenance.push(provenance)
        if (isTco(new URL(source.canonicalInputUrl)) && !isTco(url)) {
          source.expandedUrl = candidate.expandedUrl
          source.unwoundUrl = candidate.unwoundUrl
          source.resolvedUrl = resolvedUrl
          source.canonicalUrl = resolvedUrl
          source.canonicalInputUrl = canonicalInputUrl
        }
        promote(source, classify(new URL(source.canonicalInputUrl), post.text))
        if (source.sourceType === 'external_video') source.platform = platform(new URL(source.canonicalInputUrl))
        register(source)
        continue
      }
      const source: ArchiveSource = {
        originalUrl: candidate.originalUrl, expandedUrl: candidate.expandedUrl, ...(candidate.unwoundUrl ? { unwoundUrl: candidate.unwoundUrl } : {}),
        resolvedUrl, canonicalUrl: resolvedUrl, canonicalInputUrl, sourceKey: `url:${canonicalInputUrl}`,
        discoveredFromPost: post.id, relationship: post.relationship, context: post.text, sourceType: classify(url, post.text), aliases: candidate.aliases, ...(classify(url, post.text) === 'external_video' ? { platform: platform(url) } : {}), provenance: [provenance],
      }
      sources.push(source)
      register(source)
    } catch { /* invalid URL is ignored at the trust boundary */ }
  }
  return sources
}

export function shouldClip(source: ArchiveSource): boolean {
  return source.sourceType === 'primary_source' || source.sourceType === 'original_article' || source.sourceType === 'reference'
}
