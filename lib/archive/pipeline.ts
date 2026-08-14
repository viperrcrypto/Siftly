import crypto from 'node:crypto'
import prisma from '@/lib/db'
import { allowedXMediaUrl, isSafeHttpUrl, safeFetch } from '@/lib/archive/safe-fetch'
import { addFrontmatterProperties, fetchArticle, loadTemplates, renderTemplate, replaceArchiveNote, selectTemplate, writeArchiveBinary, writeArchiveNote } from '@/lib/archive/clipper'
import { resolveWithGalleryDl, type GalleryMedia, type GalleryTweet } from '@/lib/archive/gallery-dl'
import { resolveSources, shouldClip, type DiscoveredPost } from '@/lib/archive/source-resolver'
import { type UrlCandidate, urlCandidate, urlCandidatesFrom } from '@/lib/archive/url-candidates'

const STALE_MS = 15 * 60 * 1000

export interface ArchiveSettings {
  archiveEnabled: boolean; autoAfterImport: boolean; vaultPath?: string; templateDir?: string
  galleryDlPath?: string; cookieBrowser?: string; downloadXVideo: boolean; downloadPdf: boolean; sourceResolverEnabled: boolean; archiveRoot: string
}

export async function getArchiveSettings(): Promise<ArchiveSettings> {
  const rows = await prisma.setting.findMany({ where: { key: { in: ['archiveEnabled', 'autoAfterImport', 'obsidianVaultPath', 'archiveTemplateDir', 'galleryDlPath', 'cookieBrowser', 'downloadXVideo', 'downloadPdf', 'sourceResolverEnabled', 'archiveRoot'] } } })
  const value = Object.fromEntries(rows.map((row) => [row.key, row.value]))
  return {
    archiveEnabled: value.archiveEnabled === 'true', autoAfterImport: value.autoAfterImport === 'true', vaultPath: value.obsidianVaultPath,
    templateDir: value.archiveTemplateDir, galleryDlPath: value.galleryDlPath, cookieBrowser: value.cookieBrowser,
    downloadXVideo: value.downloadXVideo === 'true', downloadPdf: value.downloadPdf === 'true', sourceResolverEnabled: value.sourceResolverEnabled !== 'false', archiveRoot: value.archiveRoot || 'Clippings/Siftly',
  }
}

export async function ensureArchiveRecord(bookmarkId: string): Promise<void> {
  await prisma.archiveRecord.upsert({ where: { bookmarkId }, update: {}, create: { bookmarkId } })
}

function classifyArchiveUrls(urls: Array<string | UrlCandidate>) {
  return resolveSources([{ id: 'root', text: '', relationship: 'root', urls }]).map((source) => ({ url: source.canonicalUrl, relationship: source.sourceType }))
}

function pendingTco(candidate: UrlCandidate): boolean {
  try { return new URL(candidate.canonicalInputUrl).hostname.toLowerCase() === 't.co' } catch { return false }
}

function priorTcoResolutions(value: unknown): Map<string, UrlCandidate> {
  if (!value || typeof value !== 'object') return new Map()
  const sources = value as { status?: unknown; items?: unknown }
  if (!Array.isArray(sources.items)) return new Map()
  const resolved = new Map<string, UrlCandidate>()
  for (const item of sources.items) {
    if (!item || typeof item !== 'object') continue
    const source = item as { aliases?: unknown; expandedUrl?: unknown; canonicalInputUrl?: unknown; canonicalUrl?: unknown; resolvedUrl?: unknown }
    const destination = typeof source.canonicalUrl === 'string' ? source.canonicalUrl : typeof source.resolvedUrl === 'string' ? source.resolvedUrl : source.canonicalInputUrl
    if (typeof destination !== 'string' || pendingTco({ originalUrl: destination, expandedUrl: destination, canonicalInputUrl: destination, aliases: [destination] })) continue
    for (const alias of Array.isArray(source.aliases) ? source.aliases : []) {
      if (typeof alias !== 'string') continue
      const candidate = urlCandidate({ originalUrl: alias, expandedUrl: typeof source.expandedUrl === 'string' ? source.expandedUrl : alias, unwoundUrl: destination, canonicalInputUrl: alias, aliases: [...(Array.isArray(source.aliases) ? source.aliases.filter((value): value is string => typeof value === 'string') : []), destination] })
      if (candidate && pendingTco({ ...candidate, canonicalInputUrl: alias })) resolved.set(alias, candidate)
    }
  }
  return resolved
}

async function resolveTcoCandidates(posts: DiscoveredPost[], previousSources?: unknown): Promise<{ posts: DiscoveredPost[]; errors: string[] }> {
  const resolved = priorTcoResolutions(previousSources)
  const failed = new Map<string, string>()
  const probe = async (candidate: UrlCandidate): Promise<UrlCandidate> => {
    if (!pendingTco(candidate)) return candidate
    const key = candidate.canonicalInputUrl
    const cached = resolved.get(key)
    if (cached) return cached
    const priorError = failed.get(key)
    if (priorError) throw new Error(priorError)
    try {
      const response = await safeFetch(key, { maxBytes: 16_384, timeoutMs: 10_000, accept: 'text/html,*/*;q=0.1', truncate: true })
      if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`)
      const next = urlCandidate({ ...candidate, unwoundUrl: response.url, aliases: [...candidate.aliases, response.url] })
      if (!next) throw new Error('invalid resolved URL')
      resolved.set(key, next)
      return next
    } catch (error) {
      const message = error instanceof Error ? error.message : 't.co resolve failed'
      failed.set(key, message)
      throw new Error(message)
    }
  }
  const output: DiscoveredPost[] = []
  for (const post of posts) {
    const urls: Array<string | UrlCandidate> = []
    for (const value of post.urls) {
      const candidate = urlCandidate(value)
      if (!candidate) continue
      try { urls.push(await probe(candidate)) } catch { urls.push(candidate) }
    }
    output.push({ ...post, urls })
  }
  return { posts: output, errors: [...failed.entries()].map(([url, error]) => `${url}: ${error}`) }
}

function resultStatus(result: Record<string, unknown>): 'success' | 'partial' | 'failed' {
  const stages = Object.values(result).filter((value): value is { status?: string } => !!value && typeof value === 'object')
  const failed = stages.filter((stage) => stage.status === 'failed').length
  const successful = stages.filter((stage) => stage.status === 'success').length
  return failed === 0 && !stages.some((stage) => stage.status === 'partial') ? 'success' : successful > 0 ? 'partial' : 'failed'
}

function identityUrls(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value]
  return values.flatMap((item) => {
    if (Array.isArray(item)) return identityUrls(item)
    if (typeof item !== 'string') return []
    try { const url = new URL(item); url.hash = ''; return [url.toString()] } catch { return [] }
  })
}

function sourceIdentity(source: { aliases: string[]; sourceKey: string; canonicalInputUrl: string; resolvedUrl: string; canonicalUrl: string }): Set<string> {
  return new Set(identityUrls([...source.aliases, source.canonicalInputUrl, source.resolvedUrl, source.canonicalUrl, source.sourceKey.replace(/^url:/, '')]))
}

function clipMatchesSource(clip: Record<string, unknown>, source: { aliases: string[]; sourceKey: string; canonicalInputUrl: string; resolvedUrl: string; canonicalUrl: string }): boolean {
  if (clip.sourceKey === source.sourceKey) return true
  const identities = sourceIdentity(source)
  return identityUrls([clip.aliases, clip.resolvedUrl, clip.canonicalUrl, clip.canonicalKey]).some((url) => identities.has(url))
}

function mergeClipSource(clip: Record<string, unknown>, source: { aliases: string[]; sourceKey: string; provenance: unknown[]; sourceType: string; discoveredFromPost: string; relationship: string; context: string }): void {
  const aliases = Array.isArray(clip.aliases) ? clip.aliases.filter((value): value is string => typeof value === 'string') : []
  const sourceKeys = Array.isArray(clip.sourceKeys) ? clip.sourceKeys.filter((value): value is string => typeof value === 'string') : []
  const provenance = Array.isArray(clip.provenance) ? clip.provenance : []
  clip.aliases = [...new Set([...aliases, ...source.aliases])]
  clip.sourceKeys = [...new Set([...sourceKeys, source.sourceKey])]
  clip.provenance = [...new Map([...provenance, ...source.provenance].map((value) => [JSON.stringify(value), value])).values()]
  const rank: Record<string, number> = { incidental: 0, related: 1, reference: 2, original_article: 3, primary_source: 4 }
  if ((rank[source.sourceType] ?? -1) > (rank[typeof clip.sourceType === 'string' ? clip.sourceType : ''] ?? -1)) {
    clip.sourceType = source.sourceType
    clip.discoveredFromPost = source.discoveredFromPost
    clip.relationship = source.relationship
    clip.context = source.context
  }
}

export function validatedThread(root: GalleryTweet, tweets: GalleryTweet[]): GalleryTweet[] {
  const author = root.authorId
  const conversation = root.conversationId ?? root.id
  const byId = new Map(tweets.map((tweet) => [tweet.id, tweet]))
  const accepted = new Set([root.id])
  let changed = true
  while (changed) {
    changed = false
    for (const tweet of tweets) {
      if (author && tweet.authorId === author && tweet.conversationId === conversation && tweet.inReplyToId && accepted.has(tweet.inReplyToId) && !accepted.has(tweet.id)) {
        accepted.add(tweet.id); changed = true
      }
    }
  }
  return [...accepted].map((id) => byId.get(id)).filter((tweet): tweet is GalleryTweet => !!tweet)
}

type ArchiveMediaItem = {
  id: string; type: string; url: string; mediaKey?: string | null; localPath: string | null; downloadStatus: string; contentHash: string | null
  sourceTweetId?: string | null; sourceTweetUrl?: string | null; sourceMediaIndex?: number | null; sourceAuthorId?: string | null; sourceAuthorHandle?: string | null
}

type GalleryMediaRecord = GalleryMedia & { sourceTweetId: string; sourceTweetUrl: string; sourceAuthorId?: string; sourceAuthorHandle?: string }
type ArchiveQuote = { id: string; url: string; relationship: 'quote'; status: 'success' | 'failed'; quotedById?: string; authorId?: string; authorHandle?: string; text: string; urls: UrlCandidate[]; media: GalleryMedia[]; raw: Record<string, unknown>; error?: string; retryable?: true }

function mediaTweetsFromThread(value: unknown): GalleryTweet[] {
  if (!value || typeof value !== 'object') return []
  const thread = value as { tweets?: unknown; quotes?: unknown }
  const rows = [...(Array.isArray(thread.tweets) ? thread.tweets : []), ...(Array.isArray(thread.quotes) ? thread.quotes : [])]
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const tweet = row as { id?: unknown; authorId?: unknown; authorHandle?: unknown; media?: unknown }
    if (typeof tweet.id !== 'string' || !Array.isArray(tweet.media)) return []
    const media = tweet.media.filter((item): item is GalleryMedia => !!item && typeof item === 'object' && (item as GalleryMedia).type !== undefined && typeof (item as GalleryMedia).url === 'string' && typeof (item as GalleryMedia).sourceMediaIndex === 'number')
    return [{ id: tweet.id, authorId: typeof tweet.authorId === 'string' ? tweet.authorId : undefined, authorHandle: typeof tweet.authorHandle === 'string' ? tweet.authorHandle : undefined, media, raw: {} }]
  })
}

function mediaIdentity(media: GalleryMedia): string {
  if (media.mediaKey) return `key:${media.mediaKey}`
  return mediaUrlIdentity(media.url)
}

function mediaUrlIdentity(url: string): string {
  try { const parsed = new URL(url); return `url:${parsed.origin}${parsed.pathname}` } catch { return `url:${url}` }
}

function galleryMediaRecords(tweets: GalleryTweet[]): GalleryMediaRecord[] {
  const seen = new Set<string>()
  const seenMedia = new Set<string>()
  const records: GalleryMediaRecord[] = []
  for (const tweet of tweets) for (const media of tweet.media ?? []) {
    const key = `${tweet.id}:${media.sourceMediaIndex}`
    const identity = mediaIdentity(media)
    if (seen.has(key) || seenMedia.has(identity) || !allowedXMediaUrl(media.url)) continue
    seen.add(key)
    seenMedia.add(identity)
    records.push({ ...media, sourceTweetId: tweet.id, sourceTweetUrl: `https://x.com/${tweet.authorHandle ?? 'i'}/status/${tweet.id}`, sourceAuthorId: tweet.authorId, sourceAuthorHandle: tweet.authorHandle })
  }
  return records
}

async function syncGalleryMedia(bookmarkId: string, existing: ArchiveMediaItem[], tweets: GalleryTweet[]): Promise<ArchiveMediaItem[]> {
  const expected = galleryMediaRecords(tweets)
  for (const media of expected) {
    const type = media.type === 'animated_gif' ? 'gif' : media.type
    const data = { type, url: media.url, mediaKey: media.mediaKey ?? null, sourceTweetId: media.sourceTweetId, sourceTweetUrl: media.sourceTweetUrl, sourceMediaIndex: media.sourceMediaIndex, sourceAuthorId: media.sourceAuthorId ?? null, sourceAuthorHandle: media.sourceAuthorHandle ?? null }
    const current = (media.mediaKey ? existing.find((item) => item.mediaKey === media.mediaKey) : undefined)
      ?? existing.find((item) => mediaUrlIdentity(item.url) === mediaUrlIdentity(media.url))
      ?? existing.find((item) => item.sourceTweetId === media.sourceTweetId && item.sourceMediaIndex === media.sourceMediaIndex)
    if (current) {
      const update = { ...data, url: mediaUrlIdentity(current.url) === mediaUrlIdentity(media.url) ? current.url : media.url }
      await prisma.mediaItem.update({ where: { id: current.id }, data: update })
      Object.assign(current, update)
    } else {
      const created = await prisma.mediaItem.upsert({
        where: { bookmarkId_sourceTweetId_sourceMediaIndex: { bookmarkId, sourceTweetId: media.sourceTweetId, sourceMediaIndex: media.sourceMediaIndex } },
        create: { bookmarkId, ...data }, update: data,
      })
      if (!existing.some((item) => item.id === created.id)) existing.push(created)
    }
  }
  return prisma.mediaItem.findMany({ where: { bookmarkId } })
}

function mediaResult(item: ArchiveMediaItem, details: Record<string, unknown>) {
  return { ...details, type: item.type, sourceTweetId: item.sourceTweetId ?? null, sourceTweetUrl: item.sourceTweetUrl ?? null, sourceMediaIndex: item.sourceMediaIndex ?? null, sourceAuthorId: item.sourceAuthorId ?? null, sourceAuthorHandle: item.sourceAuthorHandle ?? null }
}

async function downloadMedia(vaultPath: string, root: string, bookmarkId: string, media: ArchiveMediaItem[], enabled: boolean) {
  const items: Array<Record<string, unknown>> = []
  for (const item of media) {
    if (item.downloadStatus === 'success' && item.localPath && item.contentHash) { items.push(mediaResult(item, { url: item.url, status: 'success', path: item.localPath, hash: item.contentHash, skipped: true })); continue }
    if (item.type !== 'video' && item.type !== 'gif' && item.type !== 'photo') { items.push(mediaResult(item, { url: item.url, status: 'skipped' })); continue }
    if ((item.type === 'video' || item.type === 'gif') && !enabled) { await prisma.mediaItem.update({ where: { id: item.id }, data: { downloadStatus: 'skipped', downloadError: 'X video download disabled' } }); items.push(mediaResult(item, { url: item.url, status: 'url-only' })); continue }
    if (!allowedXMediaUrl(item.url)) { await prisma.mediaItem.update({ where: { id: item.id }, data: { downloadStatus: 'skipped', downloadError: 'Not an X-native media URL' } }); items.push(mediaResult(item, { url: item.url, status: 'skipped', reason: 'X native media以外は保存しません' })); continue }
    try {
      const response = await safeFetch(item.url, { maxBytes: 100 * 1024 * 1024, accept: 'image/*,video/*' })
      if (response.status !== undefined && (response.status < 200 || response.status >= 300)) throw new Error(`HTTP ${response.status}`)
      if (!allowedXMediaUrl(response.url)) throw new Error('Media redirect leaves X CDN')
      const type = String(response.headers['content-type'] ?? '').split(';')[0]
      if ((item.type === 'photo' && !/^image\/(jpeg|png|webp)$/i.test(type)) || ((item.type === 'video' || item.type === 'gif') && !/^(video\/mp4|image\/gif)$/i.test(type))) throw new Error('Unsupported media content type')
      const extension = type.includes('mp4') ? '.mp4' : type.includes('gif') ? '.gif' : type.includes('png') ? '.png' : '.jpg'
      const written = await writeArchiveBinary(vaultPath, `${root}/media/${bookmarkId}`, `${item.id}${extension}`, response.body)
      await prisma.mediaItem.update({ where: { id: item.id }, data: { localPath: written.path, downloadStatus: 'success', downloadError: null, downloadedAt: new Date(), fileSize: response.body.byteLength, contentHash: written.hash } })
      items.push(mediaResult(item, { url: item.url, status: 'success', path: written.path, hash: written.hash }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await prisma.mediaItem.update({ where: { id: item.id }, data: { downloadStatus: 'failed', downloadError: message } })
      items.push(mediaResult(item, { url: item.url, status: 'failed', error: message }))
    }
  }
  return items
}

export async function runArchive(bookmarkId: string): Promise<{ status: string; result: Record<string, unknown> }> {
  await ensureArchiveRecord(bookmarkId)
  const stale = new Date(Date.now() - STALE_MS)
  const claim = await prisma.archiveRecord.updateMany({ where: { bookmarkId, OR: [{ status: { in: ['pending', 'failed', 'partial', 'success'] } }, { status: 'processing', startedAt: { lt: stale } }] }, data: { status: 'processing', startedAt: new Date(), finishedAt: null, lastError: null, attemptCount: { increment: 1 } } })
  if (claim.count !== 1) throw new Error('Archive is already processing')
  const previous = await prisma.archiveRecord.findUniqueOrThrow({ where: { bookmarkId } })
  let result: Record<string, unknown>
  try { result = JSON.parse(previous.resultJson) as Record<string, unknown> } catch { result = {} }
  const persist = () => prisma.archiveRecord.update({ where: { bookmarkId }, data: { status: 'processing', resultJson: JSON.stringify(result) } })
  try {
    const [bookmark, settings] = await Promise.all([prisma.bookmark.findUniqueOrThrow({ where: { id: bookmarkId }, include: { mediaItems: true } }), getArchiveSettings()])
    const rootUrls = urlCandidatesFrom(bookmark.rawJson, bookmark.text)
    let urls: Array<string | UrlCandidate> = rootUrls
    result.tweet = { status: 'success', id: bookmark.tweetId, url: `https://x.com/${bookmark.authorHandle}/status/${bookmark.tweetId}` }
    result.urls = classifyArchiveUrls(urls)
    await persist()

    const priorThread = result.thread as { status?: string; tweets?: Array<{ id: string; authorId?: string; authorHandle?: string; conversationId?: string; text?: string; inReplyToId?: string; quotedTweetId?: string; urls?: UrlCandidate[]; media?: GalleryMedia[] }>; quotes?: Array<{ id: string; relationship?: 'quote'; status: string; quotedById?: string; authorId?: string; authorHandle?: string; text?: string; urls?: UrlCandidate[]; media?: GalleryMedia[]; raw?: Record<string, unknown>; error?: string }> } | undefined
    const resolveQuote = async (id: string, quotedById?: string): Promise<ArchiveQuote> => {
      try {
        const resolved = await resolveWithGalleryDl(id, settings.galleryDlPath!, settings.cookieBrowser)
        const quote = resolved.find((tweet) => tweet.id === id)
        return quote ? { id, url: `https://x.com/i/status/${id}`, relationship: 'quote', status: 'success', ...(quotedById ? { quotedById } : {}), authorId: quote.authorId, authorHandle: quote.authorHandle, text: quote.text ?? '', urls: urlCandidatesFrom(quote.raw, quote.text), media: quote.media, raw: quote.raw } : { id, url: `https://x.com/i/status/${id}`, relationship: 'quote', status: 'failed', ...(quotedById ? { quotedById } : {}), text: '', urls: [], media: [], raw: {}, error: 'Quoted tweet verification failed', retryable: true }
      } catch (error) { return { id, url: `https://x.com/i/status/${id}`, relationship: 'quote', status: 'failed', ...(quotedById ? { quotedById } : {}), text: '', urls: [], media: [], raw: {}, error: error instanceof Error ? error.message : String(error), retryable: true } }
    }
    if (priorThread?.tweets?.some((tweet) => tweet.id === bookmark.tweetId) && priorThread.status !== 'failed' && !(priorThread as { retryable?: boolean; rootFallback?: boolean }).retryable && !(priorThread as { retryable?: boolean; rootFallback?: boolean }).rootFallback) {
      // A complete root/thread result is immutable; only failed quote lookups are retried.
      const quotes = await Promise.all((priorThread.quotes ?? []).map((quote) => quote.status === 'success' ? quote : resolveQuote(quote.id, quote.quotedById)))
      urls = [...urls, ...(priorThread.tweets ?? []).flatMap((tweet) => tweet.urls ?? []), ...quotes.flatMap((quote) => quote.urls ?? [])]
      result.urls = classifyArchiveUrls(urls)
      result.thread = { ...priorThread, status: quotes.some((quote) => quote.status === 'failed') ? 'partial' : 'success', quotes }
    } else if (settings.galleryDlPath) {
      try {
        const tweets = await resolveWithGalleryDl(bookmark.tweetId, settings.galleryDlPath, settings.cookieBrowser)
        const root = tweets.find((tweet) => tweet.id === bookmark.tweetId)
        if (!root) throw new Error('gallery-dl result does not contain requested root tweet')
        const resolvedThread = validatedThread(root, tweets)
        const threadIds = new Set(resolvedThread.map((tweet) => tweet.id))
        // gallery-dl's quote_id means “quoted by this post”, so candidates come from
        // the same conversation and only when their parent is the resolved self-thread.
        const quotes: ArchiveQuote[] = tweets.filter((tweet) => tweet.quotedById && threadIds.has(tweet.quotedById)).map((quote) => ({
          id: quote.id, url: `https://x.com/i/status/${quote.id}`, relationship: 'quote' as const, status: 'success' as const, quotedById: quote.quotedById,
          authorId: quote.authorId, authorHandle: quote.authorHandle, text: quote.text ?? '', urls: urlCandidatesFrom(quote.raw, quote.text), media: quote.media, raw: quote.raw,
        }))
        for (const parent of resolvedThread) if (parent.quotedTweetId && !quotes.some((quote) => quote.id === parent.quotedTweetId)) {
          const quote = tweets.find((tweet) => tweet.id === parent.quotedTweetId)
          quotes.push(quote
            ? { id: quote.id, url: `https://x.com/i/status/${quote.id}`, relationship: 'quote' as const, status: 'success' as const, quotedById: parent.id, authorId: quote.authorId, authorHandle: quote.authorHandle, text: quote.text ?? '', urls: urlCandidatesFrom(quote.raw, quote.text), media: quote.media, raw: quote.raw }
            : { id: parent.quotedTweetId, url: `https://x.com/i/status/${parent.quotedTweetId}`, relationship: 'quote', status: 'failed', quotedById: parent.id, text: '', urls: [], media: [], raw: {}, error: 'Quoted tweet was not returned by gallery-dl', retryable: true })
        }
        const quotedIds = new Set(quotes.map((quote) => quote.id))
        const thread = resolvedThread.filter((tweet) => !quotedIds.has(tweet.id))
        urls = [...urls, ...thread.flatMap((tweet) => urlCandidatesFrom(tweet.raw, tweet.text)), ...quotes.flatMap((quote) => urlCandidatesFrom(quote.raw, quote.text))]
        result.urls = classifyArchiveUrls(urls)
        result.thread = { status: quotes.some((quote) => quote.status === 'failed') ? 'partial' : 'success', tweets: thread.map((tweet) => ({ id: tweet.id, authorId: tweet.authorId, authorHandle: tweet.authorHandle, conversationId: tweet.conversationId, text: tweet.text, inReplyToId: tweet.inReplyToId, quotedTweetId: tweet.quotedTweetId, urls: urlCandidatesFrom(tweet.raw, tweet.text), media: tweet.media })), quotes: quotes.map((quote) => ({ ...quote, authorHandle: quote.authorHandle, media: quote.media, urls: urlCandidatesFrom(quote.raw, quote.text) })) }
      } catch (error) { result.thread = { status: 'partial', error: error instanceof Error ? error.message : String(error), retryable: true, rootFallback: true } }
    } else result.thread = { status: 'partial', error: 'gallery-dl未設定。保存済みTweetのみを保持します', retryable: true, tweets: [{ id: bookmark.tweetId, text: bookmark.text, urls: rootUrls }] }
    await persist()

    const sourcePosts: DiscoveredPost[] = [{ id: bookmark.tweetId, text: bookmark.text, relationship: 'root', urls: rootUrls, authorHandle: bookmark.authorHandle, threadPosition: 0 }]
    const savedThread = result.thread as { tweets?: Array<{ id: string; authorId?: string; authorHandle?: string; text?: string; urls?: UrlCandidate[] }>; quotes?: Array<{ id: string; status: string; authorId?: string; authorHandle?: string; text?: string; urls?: UrlCandidate[] }> }
    for (const [index, tweet] of (savedThread.tweets ?? []).entries()) if (tweet.id !== bookmark.tweetId) sourcePosts.push({ id: tweet.id, text: tweet.text ?? '', relationship: 'self_reply', urls: tweet.urls ?? [], authorId: tweet.authorId, authorHandle: tweet.authorHandle, threadPosition: index })
    for (const [index, quote] of (savedThread.quotes ?? []).entries()) if (quote.status === 'success') sourcePosts.push({ id: quote.id, text: quote.text ?? '', relationship: 'quote', urls: quote.urls ?? [], authorId: quote.authorId, authorHandle: quote.authorHandle, threadPosition: (savedThread.tweets ?? []).length + index })
    const tco = settings.sourceResolverEnabled ? await resolveTcoCandidates(sourcePosts, result.sources) : { posts: sourcePosts, errors: [] as string[] }
    const sources = settings.sourceResolverEnabled ? resolveSources(tco.posts) : []
    result.sources = { status: tco.errors.length ? 'partial' : 'success', retryable: tco.errors.length > 0, items: sources, errors: tco.errors }
    await persist()

    const archiveMedia = await syncGalleryMedia(bookmark.id, bookmark.mediaItems, mediaTweetsFromThread(result.thread))
    if (settings.vaultPath) {
      const media = await downloadMedia(settings.vaultPath, settings.archiveRoot, bookmark.id, archiveMedia, settings.downloadXVideo)
      result.media = { status: media.some((item) => item.status === 'failed') ? 'failed' : 'success', items: media }
      await persist()
      const candidates = sources.filter(shouldClip)
      const clips: Array<Record<string, unknown>> = []
      const priorClips = ((result.clips as { items?: Array<Record<string, unknown>> } | undefined)?.items ?? [])
      const loaded = settings.templateDir ? await loadTemplates(settings.templateDir) : { templates: [], errors: ['テンプレート未設定'] }
      let clipsRetryable = tco.errors.length > 0
      for (const source of candidates) {
        const prior = [...clips, ...priorClips].find((clip) => (clip.status === 'success' || clip.status === 'partial' || (clip.status === 'failed' && !!clip.note)) && clipMatchesSource(clip, source))
        // A URL-only PDF is intentionally resumable when the user later enables PDF download.
        const retryUrlOnlyPdf = /\.pdf(?:$|[?#])/i.test(source.canonicalUrl) && settings.downloadPdf && prior?.download === 'url-only'
        if (prior?.status === 'success' && !retryUrlOnlyPdf) {
          mergeClipSource(prior, source)
          if (!clips.includes(prior)) clips.push(prior)
          continue
        }
        try {
          if (/\.pdf(?:$|[?#])/i.test(source.canonicalUrl)) {
            if (!settings.downloadPdf) clips.push({ ...source, status: 'success', download: 'url-only' })
            else {
              const pdf = await safeFetch(source.canonicalUrl, { maxBytes: 50 * 1024 * 1024, accept: 'application/pdf' })
              if (pdf.status !== undefined && (pdf.status < 200 || pdf.status >= 300)) throw new Error(`HTTP ${pdf.status}`)
              if (!String(pdf.headers['content-type'] ?? '').includes('application/pdf')) throw new Error('PDF content type mismatch')
              const short = crypto.createHash('sha256').update(source.sourceKey).digest('hex').slice(0, 12)
              clips.push({ ...source, aliases: source.aliases, sourceKeys: [source.sourceKey], canonicalKey: source.canonicalUrl, status: 'success', file: await writeArchiveBinary(settings.vaultPath, `${settings.archiveRoot}/pdf`, `${bookmark.tweetId}-${short}.pdf`, pdf.body) })
            }
          } else {
            const page = await fetchArticle(source.canonicalUrl)
            const safePage = { ...page, canonicalUrl: isSafeHttpUrl(page.canonicalUrl) ? page.canonicalUrl : page.url }
            const duplicate = clips.find((clip) => clip.status === 'success' && identityUrls([clip.aliases, clip.resolvedUrl, clip.canonicalUrl, clip.canonicalKey]).includes(safePage.canonicalUrl))
            if (duplicate) { mergeClipSource(duplicate, source); continue }
            const template = selectTemplate(loaded.templates, safePage)
            if (!template) throw new Error('利用可能なWeb Clipperテンプレートがありません')
            const rendered = renderTemplate(template, safePage)
            if (rendered.reasons.length) clipsRetryable = true
            const threadName = `${bookmark.authorHandle}-${bookmark.tweetId}`
            const markdown = addFrontmatterProperties(rendered.markdown, { source_type: source.sourceType, discovered_from_post: source.discoveredFromPost, discovered_from_thread: bookmark.tweetId, original_url: source.originalUrl, resolved_url: safePage.url, canonical_url: safePage.canonicalUrl, referenced_from: `[[${threadName}]]` })
            const priorNote = prior?.note as { path?: string; hash?: string } | undefined
            const note = priorNote?.path && priorNote.hash
              ? await replaceArchiveNote(settings.vaultPath, priorNote.path, priorNote.hash, markdown)
              : await writeArchiveNote(settings.vaultPath, rendered.relativePath, rendered.noteName === 'untitled' ? safePage.title : rendered.noteName, markdown, safePage.canonicalUrl)
            const clip = { ...source, aliases: source.aliases, sourceKeys: [source.sourceKey], status: rendered.reasons.length ? 'partial' : 'success', ...(rendered.reasons.length ? { error: rendered.reasons.join(' / '), retryable: true } : {}), ...(rendered.warnings.length ? { warnings: rendered.warnings } : {}), resolvedUrl: safePage.url, canonicalUrl: safePage.canonicalUrl, canonicalKey: safePage.canonicalUrl, note, template: template.name }
            if (prior) mergeClipSource(clip, source)
            clips.push(clip)
          }
        } catch (error) { clipsRetryable = true; clips.push({ ...source, status: 'failed', ...(prior?.note ? { note: prior.note } : {}), error: error instanceof Error ? error.message : String(error), retryable: true }) }
        result.clips = { status: clipsRetryable || clips.some((clip) => clip.status === 'failed' || clip.status === 'partial') ? 'partial' : 'success', retryable: clipsRetryable, items: clips, templateErrors: loaded.errors }
        await persist()
      }
      result.clips = { status: clipsRetryable || clips.some((clip) => clip.status === 'failed' || clip.status === 'partial') ? 'partial' : 'success', retryable: clipsRetryable, items: clips, templateErrors: loaded.errors }
      const links = clips.filter((clip) => clip.note).map((clip) => `- [[${String((clip.note as { path: string }).path).split('/').pop()?.replace(/\.md$/, '')}]]`).join('\n')
      const oldThreadNote = result.threadNote as { status?: string; note?: unknown; savedAt?: string } | undefined
      {
        const savedAt = oldThreadNote?.savedAt ?? new Date().toISOString()
        const threadTemplate = loaded.templates.find((template) => /thread/i.test(template.name ?? ''))
        const renderedThread = threadTemplate && renderTemplate(threadTemplate, { url: `https://x.com/${bookmark.authorHandle}/status/${bookmark.tweetId}`, canonicalUrl: `https://x.com/${bookmark.authorHandle}/status/${bookmark.tweetId}`, title: bookmark.text.slice(0, 100), description: '', author: bookmark.authorHandle, published: '', content: '', html: '', image: '', schema: {} })
        const existingThreadKeys = new Set(['root_id', 'author', 'original_url', 'saved_at'])
        const templateProperties = (renderedThread?.markdown.match(/^---\n([\s\S]*?)\n---/)?.[1].split('\n') ?? [])
          .filter((line) => { const key = line.match(/^([^:\n]+):/); if (!key || existingThreadKeys.has(key[1])) return false; existingThreadKeys.add(key[1]); return true })
        const threadNote = `---\n${templateProperties.length ? `${templateProperties.join('\n')}\n` : ''}root_id: ${JSON.stringify(bookmark.tweetId)}\nauthor: ${JSON.stringify(bookmark.authorHandle)}\noriginal_url: ${JSON.stringify(`https://x.com/${bookmark.authorHandle}/status/${bookmark.tweetId}`)}\nsaved_at: ${savedAt}\n---\n\n# ${bookmark.text.slice(0, 100) || `@${bookmark.authorHandle} ${bookmark.tweetId}`}\n\n## Original post\n\n${bookmark.text}\n\n## Self thread\n\n${sourcePosts.filter((post) => post.relationship === 'self_reply').map((post) => post.text).join('\n\n') || '（取得なし）'}\n\n## Quotes\n\n${sourcePosts.filter((post) => post.relationship === 'quote').map((post) => post.text).join('\n\n') || '（なし）'}\n\n## Sources\n\n${sources.map((source) => `- ${source.canonicalUrl}`).join('\n')}\n${links}\n\n## External video\n\n${sources.filter((source) => source.sourceType === 'external_video').map((source) => `- ${source.canonicalUrl}`).join('\n') || '（なし）'}\n`
        const oldNote = oldThreadNote?.note as { path?: string; hash?: string } | undefined
        try {
          const note = oldNote?.path && oldNote.hash
            ? await replaceArchiveNote(settings.vaultPath, oldNote.path, oldNote.hash, threadNote)
            : await writeArchiveNote(settings.vaultPath, threadTemplate?.path || settings.archiveRoot, `${bookmark.authorHandle}-${bookmark.tweetId}`, threadNote, `tweet:${bookmark.tweetId}`)
          result.threadNote = { status: 'success', savedAt, note }
        } catch (error) { result.threadNote = { status: 'failed', retryable: true, note: oldNote, error: error instanceof Error ? error.message : String(error) } }
      }
      await persist()
    } else { result.media = { status: 'partial', error: 'Vault未設定', items: archiveMedia.map((item) => mediaResult(item, { url: item.url, status: 'discovered' })) }; result.clips = { status: 'partial', error: 'Vault未設定' }; result.threadNote = { status: 'partial', error: 'Vault未設定' } }
    const status = resultStatus(result)
    await prisma.archiveRecord.update({ where: { bookmarkId }, data: { status, resultJson: JSON.stringify(result), finishedAt: new Date(), lastError: status === 'success' ? null : JSON.stringify(result).slice(0, 1000) } })
    return { status, result }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await prisma.archiveRecord.update({ where: { bookmarkId }, data: { status: 'failed', finishedAt: new Date(), lastError: message, resultJson: JSON.stringify({ ...result, pipeline: { status: 'failed', error: message } }) } })
    throw error
  }
}

const MAX_CONCURRENT_ARCHIVES = 2
const MAX_QUEUED_ARCHIVES = 50
let refilling = false

export function createArchiveQueue(run: (bookmarkId: string) => Promise<unknown>, refill: () => Promise<void>) {
  const queued = new Set<string>()
  const active = new Set<string>()
  const drain = (): void => {
    while (active.size < MAX_CONCURRENT_ARCHIVES && queued.size) {
      const bookmarkId = queued.values().next().value as string
      queued.delete(bookmarkId)
      active.add(bookmarkId)
      setImmediate(() => {
        void run(bookmarkId).catch(() => {}).finally(() => {
          active.delete(bookmarkId)
          drain()
          void refill()
        })
      })
    }
  }
  const enqueue = (bookmarkId: string): boolean => {
    if (active.has(bookmarkId) || queued.has(bookmarkId)) return true
    if (queued.size >= MAX_QUEUED_ARCHIVES) return false
    queued.add(bookmarkId)
    drain()
    return true
  }
  return { enqueue, stats: () => ({ queued: queued.size, active: active.size }), refill }
}

async function refillArchiveQueue(): Promise<void> {
  if (refilling || archiveQueue.stats().queued >= MAX_QUEUED_ARCHIVES) return
  refilling = true
  try {
    const pending = await prisma.archiveRecord.findMany({
      where: { status: 'pending' },
      select: { bookmarkId: true },
      orderBy: { updatedAt: 'asc' },
      take: MAX_QUEUED_ARCHIVES + (MAX_QUEUED_ARCHIVES - archiveQueue.stats().queued),
    })
    for (const archive of pending) {
      if (archiveQueue.stats().queued >= MAX_QUEUED_ARCHIVES) break
      archiveQueue.enqueue(archive.bookmarkId)
    }
  } finally {
    refilling = false
  }
}

const archiveQueue = createArchiveQueue(runArchive, refillArchiveQueue)

export function enqueueArchive(bookmarkId: string): boolean { return archiveQueue.enqueue(bookmarkId) }

export function archiveQueueStats(): { queued: number; active: number } { return archiveQueue.stats() }

let archiveQueueRecoveryTimer: ReturnType<typeof setTimeout> | undefined
let archiveQueueRecoveryAt: number | undefined

async function scheduleArchiveQueueRecovery(queue: ReturnType<typeof createArchiveQueue>): Promise<void> {
  const stale = new Date(Date.now() - STALE_MS)
  const next = await prisma.archiveRecord.findFirst({
    where: { status: 'processing', startedAt: { gt: stale } },
    select: { startedAt: true },
    orderBy: { startedAt: 'asc' },
  })
  if (!next?.startedAt) {
    if (archiveQueueRecoveryTimer) clearTimeout(archiveQueueRecoveryTimer)
    archiveQueueRecoveryTimer = undefined
    archiveQueueRecoveryAt = undefined
    return
  }
  const due = next.startedAt.getTime() + STALE_MS
  if (archiveQueueRecoveryTimer && archiveQueueRecoveryAt === due) return
  if (archiveQueueRecoveryTimer) clearTimeout(archiveQueueRecoveryTimer)
  archiveQueueRecoveryAt = due
  archiveQueueRecoveryTimer = setTimeout(() => {
    archiveQueueRecoveryTimer = undefined
    archiveQueueRecoveryAt = undefined
    void recoverArchiveQueue(queue).catch(() => {})
  }, Math.max(0, due - Date.now()))
  archiveQueueRecoveryTimer.unref?.()
}

async function recoverArchiveQueue(queue: ReturnType<typeof createArchiveQueue>): Promise<void> {
  const stale = new Date(Date.now() - STALE_MS)
  await prisma.archiveRecord.updateMany({
    where: { status: 'processing', OR: [{ startedAt: { lte: stale } }, { startedAt: null }] },
    data: { status: 'pending', startedAt: null, finishedAt: null },
  })
  const settings = await getArchiveSettings()
  if (settings.archiveEnabled && settings.autoAfterImport) await queue.refill()
  await scheduleArchiveQueueRecovery(queue)
}

/** Recover abandoned work once per server process, then one-shot rescan at the next stale boundary. */
let archiveQueueInitialization: Promise<void> | undefined
export function initializeArchiveQueue(queue = archiveQueue): Promise<void> {
  if (!archiveQueueInitialization) archiveQueueInitialization = recoverArchiveQueue(queue).catch((error) => {
    archiveQueueInitialization = undefined
    throw error
  })
  return archiveQueueInitialization
}

/** Queue newly imported pending records only; partial/failed retries stay manual. */
export async function enqueueIncompleteArchives(bookmarkIds: string[], queue = archiveQueue): Promise<void> {
  const settings = await getArchiveSettings()
  if (!settings.archiveEnabled || !settings.autoAfterImport) return
  for (const bookmarkId of new Set(bookmarkIds)) {
    await ensureArchiveRecord(bookmarkId)
    const archive = await prisma.archiveRecord.findUnique({ where: { bookmarkId }, select: { status: true } })
    if (archive?.status === 'pending') queue.enqueue(bookmarkId)
  }
  await queue.refill()
}
