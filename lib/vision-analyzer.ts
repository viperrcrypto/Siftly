import prisma from '@/lib/db'
import { buildImageContext } from '@/lib/image-context'
import { getCliAvailability, claudePrompt, modelNameToCliAlias } from '@/lib/claude-cli-auth'
import { getCodexCliAvailability, codexPrompt } from '@/lib/codex-cli'
import { getActiveModel, getProvider } from '@/lib/settings'
import { AIClient } from '@/lib/ai-client'
import { isTextOnlyProvider } from '@/lib/ai-provider'

export { getActiveModel } from '@/lib/settings'

type AllowedMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

function guessMediaType(url: string, contentTypeHeader: string | null): AllowedMediaType {
  const ct = contentTypeHeader?.toLowerCase() ?? ''
  if (ct.includes('png') || url.includes('.png')) return 'image/png'
  if (ct.includes('gif') || url.includes('.gif')) return 'image/gif'
  if (ct.includes('webp') || url.includes('.webp')) return 'image/webp'
  return 'image/jpeg'
}

const MAX_IMAGE_BYTES = 3_500_000 // 3.5MB raw → ~4.7MB base64, under Claude's 5MB limit

async function fetchImageAsBase64(
  url: string,
): Promise<{ data: string; mediaType: AllowedMediaType } | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Referer: 'https://twitter.com/',
      },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    const buffer = await res.arrayBuffer()
    if (buffer.byteLength < 500) return null // skip tiny/broken responses
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      console.warn(`[vision] skipping oversized image (${Math.round(buffer.byteLength / 1024)}KB): ${url.slice(0, 80)}`)
      return null
    }
    const mediaType = guessMediaType(url, res.headers.get('content-type'))
    return { data: Buffer.from(buffer).toString('base64'), mediaType }
  } catch {
    return null
  }
}

const ANALYSIS_PROMPT = `Analyze this image for a bookmark search system. Return ONLY valid JSON, no markdown, no explanation.

{
  "people": ["description of each person visible — age, gender, appearance, expression, what they're doing"],
  "text_ocr": ["ALL visible text exactly as written — signs, captions, UI text, meme text, headlines, code"],
  "objects": ["significant objects, brands, logos, symbols, technology"],
  "scene": "brief scene description — setting and platform (e.g. 'Twitter screenshot', 'office desk', 'terminal window')",
  "action": "what is happening or being shown",
  "mood": "emotional tone: humorous/educational/alarming/inspiring/satirical/celebratory/neutral",
  "style": "photo/screenshot/meme/chart/infographic/artwork/gif/code/diagram",
  "meme_template": "specific meme template name if applicable, else null",
  "tags": ["30-40 specific searchable tags — topics, synonyms, proper nouns, brands, actions, emotions"]
}

Rules:
- text_ocr: transcribe ALL readable text exactly, word for word
- If a financial chart: include asset name, direction (up/down), timeframe
- If code: include language, key function/concept names
- If a meme: include the exact template name
- tags: be maximally specific — include brand names, person names, tool names, technical terms
- BAD tags: "twitter", "post", "image", "screenshot" (too generic)
- GOOD tags: "bitcoin price chart", "react hooks", "frustrated man", "gpt-4", "bull market"`

const RETRY_DELAYS_MS = [1500, 4000, 10000]
const CONCURRENCY = 12

/**
 * CLI-based vision analysis: passes the image URL in the prompt text.
 * Works with Codex CLI (ChatGPT OAuth) and Claude CLI without needing SDK access.
 */
async function analyzeImageViaCli(imageUrl: string): Promise<string> {
  const provider = await getProvider()
  if (isTextOnlyProvider(provider)) return ''
  // Sanitize URL: strip control characters and newlines to prevent prompt injection
  const safeUrl = imageUrl.replace(/[\r\n\t]/g, '').trim()
  if (!safeUrl.startsWith('http://') && !safeUrl.startsWith('https://')) return ''
  const urlPrompt = `Look at this image URL and analyze it: ${safeUrl}\n\n${ANALYSIS_PROMPT}`

  if (provider === 'openai') {
    if (!(await getCodexCliAvailability())) return ''
    const result = await codexPrompt(urlPrompt, { timeoutMs: 60_000 })
    if (!result.success || !result.data) return ''
    const jsonMatch = result.data.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return ''
    try { JSON.parse(jsonMatch[0]); return jsonMatch[0] } catch { return '' }
  } else if (provider === 'anthropic') {
    if (!(await getCliAvailability())) return ''
    const model = await getActiveModel()
    const cliModel = modelNameToCliAlias(model)
    const result = await claudePrompt(urlPrompt, { model: cliModel, timeoutMs: 60_000 })
    if (!result.success || !result.data) return ''
    const jsonMatch = result.data.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return ''
    try { JSON.parse(jsonMatch[0]); return jsonMatch[0] } catch { return '' }
  }

  return ''
}

async function analyzeImageWithRetry(
  url: string,
  client: AIClient | null,
  model: string,
  attempt = 0,
): Promise<string> {
  // If no SDK client, use CLI path with image URL
  if (!client) {
    return attempt === 0 ? analyzeImageViaCli(url) : ''
  }

  const img = await fetchImageAsBase64(url)
  if (!img) return ''

  try {
    const response = await client.createMessage({
      model,
      max_tokens: 700,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } },
            { type: 'text', text: ANALYSIS_PROMPT },
          ],
        },
      ],
    })
    const raw = response.text?.trim() ?? ''
    if (!raw) return ''

    // Validate it's parseable JSON
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return ''
    JSON.parse(jsonMatch[0]) // throws if invalid
    return jsonMatch[0]
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    // Never retry client errors (4xx) — bad request, invalid image, too large, etc.
    const isClientError = errMsg.includes('400') || errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('422')
    const isRetryable =
      !isClientError && (
        errMsg.includes('rate') ||
        errMsg.includes('529') ||
        errMsg.includes('overloaded') ||
        errMsg.includes('ECONNREFUSED') ||
        errMsg.includes('ETIMEDOUT') ||
        errMsg.includes('fetch') ||
        errMsg.includes('network') ||
        errMsg.includes('500') ||
        errMsg.includes('502') ||
        errMsg.includes('503')
      )

    if (attempt === 0) {
      console.warn(`[vision] analysis failed (attempt ${attempt + 1}): ${errMsg.slice(0, 120)}`)
    }

    if (isRetryable && attempt < RETRY_DELAYS_MS.length) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]))
      return analyzeImageWithRetry(url, client, model, attempt + 1)
    }
    return ''
  }
}

export interface MediaItemForAnalysis {
  id: string
  url: string
  thumbnailUrl: string | null
  type: string
}

/**
 * Check if this URL's analysis result is already cached in another MediaItem row.
 * Deduplicates API calls for the same image URL.
 */
async function getCachedAnalysis(imageUrl: string, excludeId: string): Promise<string | null> {
  const existing = await prisma.mediaItem.findFirst({
    where: { url: imageUrl, imageTags: { not: null }, id: { not: excludeId } },
    select: { imageTags: true },
  })
  return existing?.imageTags ?? null
}

export async function analyzeItem(
  item: MediaItemForAnalysis,
  client: AIClient | null,
  model: string,
): Promise<number> {
  const imageUrl = item.type === 'video' ? (item.thumbnailUrl ?? item.url) : item.url

  // Check URL-level dedup cache first
  const cached = await getCachedAnalysis(imageUrl, item.id)
  if (cached) {
    await prisma.mediaItem.update({ where: { id: item.id }, data: { imageTags: cached } })
    return 1
  }

  const prefix = item.type === 'video' ? '{"_type":"video_thumbnail",' : ''
  let tags = await analyzeImageWithRetry(imageUrl, client, model)

  if (tags && prefix) {
    // Inject a _type marker into the JSON for video thumbnails
    tags = tags.replace(/^\{/, prefix)
  }

  if (tags) {
    await prisma.mediaItem.update({ where: { id: item.id }, data: { imageTags: tags } })
    return 1
  }

  // CRITICAL: Mark as attempted even on failure. Without this, the while loop in
  // analyzeAllUntagged re-fetches the same items forever (infinite loop).
  await prisma.mediaItem.update({ where: { id: item.id }, data: { imageTags: '{}' } })
  return 0
}

export async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = []
  let index = 0

  async function worker() {
    while (index < tasks.length) {
      const taskIndex = index++
      results[taskIndex] = await tasks[taskIndex]()
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker())
  await Promise.all(workers)
  return results
}

export async function analyzeBatch(
  items: MediaItemForAnalysis[],
  client: AIClient | null,
  onProgress?: (delta: number) => void,
  shouldAbort?: () => boolean,
): Promise<number> {
  const analyzable = items.filter((m) => m.type === 'photo' || m.type === 'gif' || m.type === 'video')
  if (analyzable.length === 0) return 0

  const model = await getActiveModel()

  const tasks = analyzable.map((item) => async () => {
    if (shouldAbort?.()) return 0
    const result = await analyzeItem(item, client, model)
    onProgress?.(1)
    return result
  })
  const results = await runWithConcurrency(tasks, CONCURRENCY)

  return results.reduce((sum, r) => sum + r, 0)
}

export async function analyzeUntaggedImages(client: AIClient, limit = 10): Promise<number> {
  const untagged = await prisma.mediaItem.findMany({
    where: { imageTags: null, type: { in: ['photo', 'gif', 'video'] } },
    take: limit,
    select: { id: true, url: true, thumbnailUrl: true, type: true },
  })
  if (untagged.length === 0) return 0
  return analyzeBatch(untagged, client)
}

/**
 * Analyze ALL untagged media items (no limit). Used during full AI categorization.
 */
export async function analyzeAllUntagged(
  client: AIClient,
  onProgress?: (total: number) => void,
  shouldAbort?: () => boolean,
): Promise<number> {
  const CHUNK = 15
  let total = 0
  let cursor: string | undefined

  while (true) {
    if (shouldAbort?.()) break

    // Use cursor-based pagination so failed items (marked '{}') are skipped naturally,
    // and we never re-fetch items we already attempted this run.
    const untagged = await prisma.mediaItem.findMany({
      where: {
        type: { in: ['photo', 'gif', 'video'] },
        // Only fetch items that have never been attempted (null) — '{}' sentinel means already tried
        imageTags: null,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: CHUNK,
      select: { id: true, url: true, thumbnailUrl: true, type: true },
    })

    if (untagged.length === 0) break

    cursor = untagged[untagged.length - 1].id

    await analyzeBatch(untagged, client, (delta) => {
      total += delta
      onProgress?.(total)
    }, shouldAbort)

    if (untagged.length < CHUNK) break
  }

  return total
}

// ── Batch semantic enrichment ──────────────────────────────────────────────────

const ENRICH_BATCH_SIZE = 5
const ENRICH_CONCURRENCY = 2

export interface BookmarkForEnrichment {
  id: string
  text: string
  imageTags: string[] // filtered, non-empty
  entities?: {
    hashtags?: string[]
    urls?: string[]
    mentions?: string[]
    tools?: string[]
    tweetType?: string
  }
}

export interface EnrichmentResult {
  id: string
  tags: string[]
  sentiment: string
  people: string[]
  companies: string[]
}

function buildEnrichmentPrompt(bookmarks: BookmarkForEnrichment[]): string {
  const items = bookmarks.map((b) => {
    const entry: Record<string, unknown> = { id: b.id, text: b.text.slice(0, 500) }
    const imgCtx = b.imageTags.map((raw) => buildImageContext(raw)).filter(Boolean).join(' | ')
    if (imgCtx) entry.imageContext = imgCtx
    if (b.entities?.hashtags?.length) entry.hashtags = b.entities.hashtags.slice(0, 8)
    if (b.entities?.tools?.length) entry.tools = b.entities.tools
    if (b.entities?.mentions?.length) entry.mentions = b.entities.mentions.slice(0, 3)
    return entry
  })

  return `Generate search tags and metadata for each of these Twitter/X bookmarks.

For each bookmark return:
- tags: 25-35 specific semantic search tags covering entities, actions, visual content, synonyms, and emotional signals
- sentiment: one of "positive", "negative", "neutral", "humorous", "controversial"
- people: named people mentioned or shown (max 5, empty array if none)
- companies: company/product/tool names explicitly referenced (max 8, empty array if none)

Rules for tags:
- 2-5 words max, specific beats generic
- NO generic terms: "twitter post", "screenshot", "social media", "content"
- YES to proper nouns, version numbers, specific concepts
- Rank most-search-relevant tags first

Return ONLY valid JSON, no markdown:
[{"id":"...","tags":[...],"sentiment":"...","people":[...],"companies":[...]}]

BOOKMARKS:
${JSON.stringify(items, null, 1)}`
}

export async function enrichBatchSemanticTags(
  bookmarks: BookmarkForEnrichment[],
  client: AIClient | null,
): Promise<EnrichmentResult[]> {
  if (bookmarks.length === 0) return []

  const prompt = buildEnrichmentPrompt(bookmarks)
  const provider = await getProvider()
  if (isTextOnlyProvider(provider)) {
    console.warn('[enrich] OpenAI-compatible provider is text-only, skipping CLI vision path')
  }

  // Helper to parse enrichment response
  const parseResponse = (text: string): EnrichmentResult[] => {
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return []
    const parsed: unknown = JSON.parse(match[0])
    if (!Array.isArray(parsed)) return []
    return (parsed as Record<string, unknown>[]).map((item): EnrichmentResult => ({
      id: String(item.id ?? ''),
      tags: Array.isArray(item.tags) ? (item.tags as unknown[]).map(String).filter(Boolean) : [],
      sentiment: String(item.sentiment ?? 'neutral'),
      people: Array.isArray(item.people) ? (item.people as unknown[]).map(String).filter(Boolean) : [],
      companies: Array.isArray(item.companies) ? (item.companies as unknown[]).map(String).filter(Boolean) : [],
    })).filter((r) => r.id)
  }

  // Prefer CLI over SDK
  if (provider === 'openai') {
    if (await getCodexCliAvailability()) {
      const result = await codexPrompt(prompt, { timeoutMs: 90_000 })
      if (result.success && result.data) {
        try { return parseResponse(result.data) }
        catch { console.warn('[enrich] Codex CLI response parse failed, falling back to SDK') }
      }
    }
  } else if (provider === 'anthropic') {
    if (await getCliAvailability()) {
      const model = await getActiveModel()
      const cliModel = modelNameToCliAlias(model)

      const result = await claudePrompt(prompt, { model: cliModel, timeoutMs: 90_000 })
      if (result.success && result.data) {
        try { return parseResponse(result.data) }
        catch { console.warn('[enrich] CLI response parse failed, falling back to SDK') }
      }
    }
  }

  // Fallback to SDK
  if (!client) {
    console.warn('[enrich] CLI not available and no API client')
    return []
  }

  const model = await getActiveModel()
  const ENRICH_RETRY_DELAYS = [2000, 5000]

  for (let attempt = 0; attempt <= ENRICH_RETRY_DELAYS.length; attempt++) {
    try {
      const response = await client.createMessage({
        model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      })
      const results = parseResponse(response.text)
      if (results.length > 0) return results
      console.warn(`[enrich] no JSON array in response (attempt ${attempt + 1})`)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.warn(`[enrich] batch failed (attempt ${attempt + 1}): ${errMsg.slice(0, 120)}`)
      const isClientError = errMsg.includes('400') || errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('422')
      if (isClientError || attempt >= ENRICH_RETRY_DELAYS.length) break
      await new Promise((r) => setTimeout(r, ENRICH_RETRY_DELAYS[attempt]))
    }
  }
  return []
}

/**
 * Run semantic enrichment for all bookmarks that have no semanticTags yet.
 * Processes bookmarks in batches of ENRICH_BATCH_SIZE (one API call per batch)
 * with ENRICH_CONCURRENCY parallel batches — 5-10x fewer API calls vs. per-bookmark.
 */
export async function enrichAllBookmarks(
  client: AIClient,
  onProgress?: (total: number) => void,
  shouldAbort?: () => boolean,
): Promise<number> {
  const CHUNK = ENRICH_BATCH_SIZE * ENRICH_CONCURRENCY * 2 // fetch ahead of processing
  let enriched = 0
  let cursor: string | undefined

  while (true) {
    if (shouldAbort?.()) break

    const rows = await prisma.bookmark.findMany({
      where: {
        semanticTags: null,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: CHUNK,
      select: {
        id: true,
        text: true,
        entities: true,
        mediaItems: { select: { imageTags: true } },
      },
    })

    if (rows.length === 0) break
    cursor = rows[rows.length - 1].id

    // Separate bookmarks worth enriching from trivial ones (mark trivial immediately)
    const trivialIds: string[] = []
    const toEnrich: BookmarkForEnrichment[] = []

    for (const b of rows) {
      const imageTags = b.mediaItems
        .map((m) => m.imageTags)
        .filter((t): t is string => t !== null && t !== '' && t !== '{}')

      if (imageTags.length === 0 && b.text.length < 20) {
        trivialIds.push(b.id)
        continue
      }

      let entities: BookmarkForEnrichment['entities'] = undefined
      if (b.entities) {
        try { entities = JSON.parse(b.entities) as typeof entities } catch { /* ignore */ }
      }

      toEnrich.push({ id: b.id, text: b.text, imageTags, entities })
    }

    // Mark trivial bookmarks in one batch
    if (trivialIds.length > 0) {
      await prisma.bookmark.updateMany({
        where: { id: { in: trivialIds } },
        data: { semanticTags: '[]' },
      })
    }

    // Split into batches and process with concurrency
    const batches: BookmarkForEnrichment[][] = []
    for (let i = 0; i < toEnrich.length; i += ENRICH_BATCH_SIZE) {
      batches.push(toEnrich.slice(i, i + ENRICH_BATCH_SIZE))
    }

    const batchTasks = batches.map((batch) => async () => {
      if (shouldAbort?.()) return

      const results = await enrichBatchSemanticTags(batch, client)
      const resultMap = new Map(results.map((r) => [r.id, r]))

      for (const b of batch) {
        const result = resultMap.get(b.id)
        if (result?.tags.length) {
          await prisma.bookmark.update({
            where: { id: b.id },
            data: {
              semanticTags: JSON.stringify(result.tags),
              enrichmentMeta: JSON.stringify({
                sentiment: result.sentiment,
                people: result.people,
                companies: result.companies,
              }),
            },
          })
          enriched++
          onProgress?.(enriched)
        }
        // Don't mark failed enrichments as '[]' — leave semanticTags: null so
        // they are retried on the next pipeline run without needing force=true.
      }
    })

    await runWithConcurrency(batchTasks, ENRICH_CONCURRENCY)

    if (rows.length < CHUNK) break
  }

  return enriched
}

/**
 * Generate semantic tags for a single bookmark (used for on-demand re-enrichment).
 * For bulk processing use enrichAllBookmarks instead.
 */
export async function enrichBookmarkSemanticTags(
  bookmarkId: string,
  tweetText: string,
  imageTags: string[],
  client: AIClient,
  entities?: BookmarkForEnrichment['entities'],
): Promise<string[]> {
  const results = await enrichBatchSemanticTags(
    [{ id: bookmarkId, text: tweetText, imageTags, entities }],
    client,
  )
  const result = results[0]
  if (!result?.tags.length) return []

  await prisma.bookmark.update({
    where: { id: bookmarkId },
    data: {
      semanticTags: JSON.stringify(result.tags),
      enrichmentMeta: JSON.stringify({
        sentiment: result.sentiment,
        people: result.people,
        companies: result.companies,
      }),
    },
  })
  return result.tags
}
