import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { seedDefaultCategories, categorizeBatch, mapBookmarkForCategorization, writeCategoryResults } from '@/lib/categorizer'
import { backfillEntities } from '@/lib/rawjson-extractor'
import { enrichBatchSemanticTags, analyzeItem, BookmarkForEnrichment } from '@/lib/vision-analyzer'
import { AIClient, resolveAIClient } from '@/lib/ai-client'
import { getProvider } from '@/lib/settings'
import { exportBookmarksByCategoryToObsidian } from '@/lib/obsidian-exporter'
import { rebuildFts } from '@/lib/fts'

// ── Twitter oEmbed fetcher ─────────────────────────────────────────────────────

const TWEET_URL_RE = /(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d{10,20})/i

function extractTweetId(url: string): string | null {
  const m = url.match(TWEET_URL_RE)
  return m ? m[1] : null
}

interface OEmbedResponse {
  html?: string
  author_name?: string
  author_url?: string
  url?: string
}

async function fetchTweetData(url: string): Promise<{
  tweetId: string
  text: string
  authorHandle: string
  authorName: string
  tweetCreatedAt: Date | null
} | null> {
  const tweetId = extractTweetId(url)
  if (!tweetId) return null

  try {
    const oembed = await fetch(
      `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=1&dnt=1`,
      { signal: AbortSignal.timeout(8000) },
    )
    if (!oembed.ok) return null
    const data: OEmbedResponse = await oembed.json()

    // Extract text from HTML blockquote
    const pMatch = data.html?.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
    let text = pMatch ? pMatch[1] : ''
    // Strip HTML tags
    text = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    // Decode common HTML entities
    text = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&mdash;/g, '—')
      .replace(/&hellip;/g, '…')

    // Extract handle from author_url (last path segment)
    const authorHandle = data.author_url?.split('/').pop()?.replace(/^@/, '') ?? 'unknown'
    const authorName = data.author_name ?? authorHandle

    // Try to parse date from the HTML href (timestamp link at end of blockquote)
    let tweetCreatedAt: Date | null = null
    const dateMatch = data.html?.match(/href="[^"]+\/status\/\d+">([^<]+)<\/a>/)
    if (dateMatch) {
      const parsed = new Date(dateMatch[1])
      if (!isNaN(parsed.getTime())) tweetCreatedAt = parsed
    }

    return { tweetId, text, authorHandle, authorName, tweetCreatedAt }
  } catch {
    return null
  }
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { urls?: string[]; vaultPath?: string; exportToObsidian?: boolean } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { urls = [], vaultPath, exportToObsidian: shouldExport = false } = body

  // Validate input
  if (!Array.isArray(urls) || urls.length === 0) {
    return NextResponse.json({ error: 'urls array is required and must be non-empty' }, { status: 400 })
  }
  if (urls.length > 100) {
    return NextResponse.json({ error: 'Maximum 100 URLs per request' }, { status: 400 })
  }

  // Sanitise and validate each URL
  const sanitizedUrls: string[] = []
  const invalidUrls: string[] = []
  for (const raw of urls) {
    if (typeof raw !== 'string') { invalidUrls.push(String(raw)); continue }
    const trimmed = raw.trim()
    if (!TWEET_URL_RE.test(trimmed)) { invalidUrls.push(trimmed); continue }
    if (!trimmed.startsWith('https://') && !trimmed.startsWith('http://')) {
      invalidUrls.push(trimmed); continue
    }
    sanitizedUrls.push(trimmed)
  }

  // ── Step 1: Fetch tweet data ──────────────────────────────────────────────
  const fetched: Awaited<ReturnType<typeof fetchTweetData>>[] = await Promise.all(
    sanitizedUrls.map((url) => fetchTweetData(url)),
  )

  const valid = fetched.filter((t): t is NonNullable<typeof t> => t !== null)
  const fetchFailed = sanitizedUrls.length - valid.length

  // ── Step 2: Import into DB (skip duplicates) ──────────────────────────────
  const importedIds: string[] = []
  let skipped = 0

  for (const tweet of valid) {
    const existing = await prisma.bookmark.findUnique({
      where: { tweetId: tweet.tweetId },
      select: { id: true },
    })
    if (existing) { skipped++; continue }

    const created = await prisma.bookmark.create({
      data: {
        tweetId: tweet.tweetId,
        text: tweet.text,
        authorHandle: tweet.authorHandle,
        authorName: tweet.authorName,
        tweetCreatedAt: tweet.tweetCreatedAt,
        rawJson: JSON.stringify({ id: tweet.tweetId, text: tweet.text }),
        source: 'bookmark',
      },
    })
    importedIds.push(created.id)
  }

  if (importedIds.length === 0) {
    return NextResponse.json({
      imported: 0,
      skipped,
      fetchFailed,
      invalidUrls,
      categorized: 0,
      exported: null,
      message: skipped > 0 ? 'All URLs already in library.' : 'No tweets could be fetched.',
    })
  }

  // ── Step 3: Entity extraction ─────────────────────────────────────────────
  // backfillEntities processes all bookmarks with entities: null (our new ones qualify)
  await backfillEntities()

  // ── Step 4: Semantic tag enrichment ──────────────────────────────────────
  await seedDefaultCategories()
  const provider = await getProvider()
  const keyName = provider === 'openai' ? 'openaiApiKey' : 'anthropicApiKey'
  const apiKeySetting = await prisma.setting.findUnique({ where: { key: keyName } })
  let client: AIClient | null = null
  try {
    client = await resolveAIClient({ dbKey: apiKeySetting?.value })
  } catch { /* CLI will be used if available */ }

  const model = await (await import('@/lib/settings')).getActiveModel()

  // Vision analysis for any media
  const mediaItems = await prisma.mediaItem.findMany({
    where: {
      bookmarkId: { in: importedIds },
      imageTags: null,
      type: { in: ['photo', 'gif', 'video'] },
    },
    select: { id: true, url: true, thumbnailUrl: true, type: true },
  })
  for (const item of mediaItems) {
    await analyzeItem(item, client, model).catch(() => {})
  }

  // Semantic tags
  const toEnrich = await prisma.bookmark.findMany({
    where: { id: { in: importedIds } },
    select: {
      id: true, tweetId: true, text: true, semanticTags: true,
      entities: true, mediaItems: { select: { imageTags: true } },
    },
  })
  if (toEnrich.length > 0) {
    const enrichInput: BookmarkForEnrichment[] = toEnrich.map((b) => {
      let parsedEntities: BookmarkForEnrichment['entities'] = {}
      try { parsedEntities = JSON.parse(b.entities ?? '{}') } catch {}
      const imageTags = b.mediaItems
        .map((m) => m.imageTags)
        .filter((t): t is string => Boolean(t) && t !== '{}')
      return { id: b.id, text: b.text, imageTags, entities: parsedEntities }
    })
    await enrichBatchSemanticTags(enrichInput, client).catch(() => {})
  }

  // ── Step 5: Categorize ────────────────────────────────────────────────────
  const toCategory = await prisma.bookmark.findMany({
    where: { id: { in: importedIds } },
    select: {
      id: true, tweetId: true, text: true, semanticTags: true,
      entities: true, mediaItems: { select: { imageTags: true } },
    },
  })

  const dbCategories = await prisma.category.findMany({ select: { slug: true, name: true, description: true } })
  const allSlugs = dbCategories.map((c) => c.slug)
  const categoryDescriptions = Object.fromEntries(
    dbCategories.map((c) => [c.slug, c.description?.trim() ?? c.name]),
  )

  const mapped = toCategory.map((b) => mapBookmarkForCategorization(b))
  const results = await categorizeBatch(mapped, client, categoryDescriptions, allSlugs)
  await writeCategoryResults(results)

  await rebuildFts().catch(() => {})

  // ── Step 6: Optional Obsidian export ────────────────────────────────────
  let exportResult: {written: number; errors: number; categories: string[]} | null = null

  if (shouldExport) {
    const resolvedVaultPath = vaultPath ??
      (await prisma.setting.findUnique({ where: { key: 'obsidianVaultPath' } }))?.value

    if (resolvedVaultPath) {
      try {
        exportResult = await exportBookmarksByCategoryToObsidian(importedIds, resolvedVaultPath)
      } catch (err) {
        exportResult = { written: 0, errors: 1, categories: [] }
        console.error('[import/url] Obsidian export error:', err)
      }
    }
  }

  return NextResponse.json({
    imported: importedIds.length,
    skipped,
    fetchFailed,
    invalidUrls,
    categorized: results.length,
    exported: exportResult,
  })
}
