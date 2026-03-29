import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { ftsSearch } from '@/lib/fts'
import { AIClient, resolveAIClient } from '@/lib/ai-client'
import { getActiveModel, getProvider } from '@/lib/settings'
import { extractKeywords } from '@/lib/search-utils'
import { getCliAvailability, claudePrompt, modelNameToCliAlias } from '@/lib/claude-cli-auth'
import { getCodexCliAvailability, codexPrompt } from '@/lib/codex-cli'
import { AIProvider, getApiKeySettingKey, isTextOnlyProvider } from '@/lib/ai-provider'

// ─── Cache ────────────────────────────────────────────────────────────────────
interface CacheEntry { results: unknown; expiresAt: number }
const searchCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000

function getCached(key: string): unknown | null {
  const entry = searchCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) { searchCache.delete(key); return null }
  return entry.results
}
function setCache(key: string, results: unknown): void {
  if (searchCache.size >= 100) searchCache.delete(searchCache.keys().next().value!)
  searchCache.set(key, { results, expiresAt: Date.now() + CACHE_TTL_MS })
}

// ─── Module-level caches (avoid DB roundtrips on every search) ────────────────
let _apiKeyCache: { provider: AIProvider; value: string; expiresAt: number } | null = null
let _categoriesCache: { slug: string; name: string; description: string | null }[] | null = null
let _categoriesCacheExpiry = 0

async function getDbApiKey(): Promise<string> {
  const provider = await getProvider()
  if (_apiKeyCache && _apiKeyCache.provider === provider && Date.now() < _apiKeyCache.expiresAt) {
    return _apiKeyCache.value
  }
  const keyName = getApiKeySettingKey(provider)
  const setting = await prisma.setting.findUnique({ where: { key: keyName } })
  const fromDb = setting?.value?.trim() ?? ''
  _apiKeyCache = { provider, value: fromDb, expiresAt: Date.now() + 60_000 }
  return fromDb
}
async function getAllCategories() {
  if (_categoriesCache && Date.now() < _categoriesCacheExpiry) return _categoriesCache
  _categoriesCache = await prisma.category.findMany({ select: { slug: true, name: true, description: true } })
  _categoriesCacheExpiry = Date.now() + 2 * 60 * 1000
  return _categoriesCache
}

/**
 * Map query intent signals to category slugs using cached category list.
 */
async function detectIntentCategories(query: string): Promise<string[]> {
  const q = query.toLowerCase()
  const slugs = new Set<string>()

  const allCats = await getAllCategories()

  const INTENT_SIGNALS: Array<{ pattern: RegExp; slugHints: string[] }> = [
    {
      pattern: /meme|funny|humor|laugh|lol|joke|hilarious|comedy|satire|roast|viral|dank|wholesome|cringe|based|skit|parody/i,
      slugHints: ['funny-memes'],
    },
    {
      pattern: /crypto|bitcoin|btc|eth|sol|defi|nft|trading|chart|invest|token|wallet|blockchain|altcoin|memecoin|pump|dump|yield|staking|airdrop|web3|dex|liquidity|portfolio|stocks|options|macro|economy|dollar|inflation|fed|interest rate/i,
      slugHints: ['finance-crypto'],
    },
    {
      pattern: /code|coding|developer|programming|github|software|api|framework|library|debug|deploy|devops|backend|frontend|fullstack|typescript|javascript|python|rust|golang|java|swift|css|html|sql|cli|terminal|bash|docker|kubernetes|ci.?cd|open.?source|repo|pull request|lint/i,
      slugHints: ['dev-tools'],
    },
    {
      pattern: /\bai\b|llm|gpt|claude|openai|anthropic|gemini|mistral|llama|model|prompt|agent|machine learning|neural|deep learning|embedding|rag|fine.?tun|inference|transformer|diffusion|multimodal|copilot|cursor|midjourney|stable diffusion|image gen/i,
      slugHints: ['ai-resources'],
    },
    {
      pattern: /design|ui\b|ux\b|figma|typography|branding|logo|visual|color palette|layout|wireframe|prototype|tailwind|animation|motion|font|icon|component|design system|saas ui/i,
      slugHints: ['design'],
    },
    {
      pattern: /productivity|focus|habit|workflow|time management|system|note.?taking|task|pkm|second brain|obsidian|notion|roam|logseq|journaling|calendar|routine|morning|discipline|deep work|async/i,
      slugHints: ['productivity'],
    },
    {
      pattern: /news|breaking|announcement|launch|update|thread|essay|opinion|analysis|report|geopolitic|politic|regulation|lawsuit|acquisition|ipo|funding|raised|series/i,
      slugHints: ['news'],
    },
  ]

  for (const { pattern, slugHints } of INTENT_SIGNALS) {
    if (pattern.test(q)) {
      for (const hint of slugHints) {
        for (const cat of allCats) {
          if (
            cat.slug === hint ||
            cat.slug.includes(hint.split('-')[0]) ||
            cat.name.toLowerCase().includes(hint.replace(/-/g, ' ')) ||
            (cat.description && cat.description.toLowerCase().includes(hint.split('-')[0]))
          ) {
            slugs.add(cat.slug)
          }
        }
      }
    }
  }

  return Array.from(slugs)
}

/** Build a rich, readable index entry for a bookmark */
function buildIndexEntry(b: {
  id: string
  tweetId: string
  text: string
  authorHandle: string
  authorName: string
  semanticTags: string | null
  entities: string | null
  mediaItems: { type: string; imageTags: string | null }[]
  categories: { confidence: number; category: { slug: string; name: string } }[]
}): string {
  const lines: string[] = [`[${b.id}]`]

  // Text — more generous limit for complex queries
  lines.push(`text: ${b.text.slice(0, 350)}`)

  // Image/media context — rich structured data
  for (const m of b.mediaItems) {
    if (!m.imageTags || m.imageTags === '{}') {
      lines.push(`media: [${m.type}]`)
      continue
    }
    try {
      const p = JSON.parse(m.imageTags) as Record<string, unknown>
      const parts: string[] = [`type=${m.type}`]
      if (p.style) parts.push(`style=${p.style}`)
      if (p.scene) parts.push(`scene=${p.scene}`)
      if (p.action) parts.push(`action=${p.action}`)
      if (p.mood) parts.push(`mood=${p.mood}`)
      if (p.meme_template) parts.push(`meme=${p.meme_template}`)
      if (Array.isArray(p.text_ocr) && (p.text_ocr as string[]).length)
        parts.push(`ocr="${(p.text_ocr as string[]).join(' | ').slice(0, 250)}"`)
      if (Array.isArray(p.people) && (p.people as string[]).length)
        parts.push(`people=${(p.people as string[]).join(', ')}`)
      if (Array.isArray(p.objects) && (p.objects as string[]).length)
        parts.push(`objects=${(p.objects as string[]).slice(0, 8).join(', ')}`)
      if (Array.isArray(p.tags) && (p.tags as string[]).length)
        parts.push(`vtags=${(p.tags as string[]).slice(0, 25).join(', ')}`)
      lines.push(`media: ${parts.join(' | ')}`)
    } catch {
      lines.push(`media: [${m.type}] ${m.imageTags.slice(0, 200)}`)
    }
  }

  // AI semantic tags — full set
  if (b.semanticTags && b.semanticTags !== '[]') {
    try {
      const tags = JSON.parse(b.semanticTags) as string[]
      if (tags.length) lines.push(`ai_tags: ${tags.slice(0, 35).join(', ')}`)
    } catch { /* ignore */ }
  }

  // Hashtags + tool mentions
  if (b.entities) {
    try {
      const ent = JSON.parse(b.entities) as { hashtags?: string[]; tools?: string[]; mentions?: string[] }
      const parts: string[] = []
      if (ent.hashtags?.length) parts.push(`#${ent.hashtags.slice(0, 10).join(' #')}`)
      if (ent.tools?.length) parts.push(`tools: ${ent.tools.join(', ')}`)
      if (ent.mentions?.length) parts.push(`mentions: @${ent.mentions.slice(0, 5).join(' @')}`)
      if (parts.length) lines.push(parts.join(' | '))
    } catch { /* ignore */ }
  }

  // Categories with confidence
  if (b.categories.length) {
    const cats = b.categories
      .filter((c) => c.confidence >= 0.5)
      .map((c) => `${c.category.name}(${c.confidence.toFixed(1)})`)
      .join(', ')
    if (cats) lines.push(`categories: ${cats}`)
  }

  return lines.join('\n')
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { query?: string; category?: string } = {}
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { query, category } = body
  if (!query?.trim()) return NextResponse.json({ error: 'Query required' }, { status: 400 })

  const apiKey = await getDbApiKey()

  const cacheKey = `${query.trim().toLowerCase()}::${category ?? ''}`
  const cached = getCached(cacheKey)
  if (cached) return NextResponse.json(cached)

  let client: AIClient | null = null
  let clientResolveError: Error | null = null
  try {
    client = await resolveAIClient({ dbKey: apiKey })
  } catch (err) {
    clientResolveError = err instanceof Error ? err : new Error(String(err))
  }
  const model = await getActiveModel()
  const provider = await getProvider()

  const categoryFilter = category
    ? { categories: { some: { category: { slug: category } } } }
    : {}

  // ── Step 1: Smart candidate selection ─────────────────────────────────────
  const keywords = extractKeywords(query)
  const intentSlugs = category ? [] : await detectIntentCategories(query)
  const MAX_CANDIDATES = 150 // smaller, richer set beats larger, noisier set

  const selectShape = {
    id: true, tweetId: true, text: true, authorHandle: true, authorName: true,
    tweetCreatedAt: true, importedAt: true, semanticTags: true, entities: true,
    mediaItems: { select: { id: true, type: true, url: true, thumbnailUrl: true, imageTags: true } },
    categories: {
      include: { category: { select: { id: true, name: true, slug: true, color: true } } },
      orderBy: { confidence: 'desc' as const },
    },
  } as const

  // Try FTS5 first (fast, ranked by relevance); fall back to LIKE on error/empty
  const ftsIds = keywords.length > 0 ? await ftsSearch(keywords) : []
  const useFts = ftsIds.length > 0

  // Build LIKE-based fallback conditions (used when FTS5 is empty/unavailable)
  const keywordConditions = keywords.flatMap((kw) => [
    { text: { contains: kw } },
    { semanticTags: { contains: kw } },
    { entities: { contains: kw } },
    { mediaItems: { some: { imageTags: { contains: kw } } } },
  ])

  // Run keyword-filtered and category-intent queries in parallel
  const [keywordHits, intentHits] = await Promise.all([
    keywords.length > 0
      ? prisma.bookmark.findMany({
          where: {
            ...categoryFilter,
            ...(useFts
              ? { id: { in: ftsIds } }
              : { OR: keywordConditions }),
          },
          // FTS results are pre-ranked; LIKE results fall back to recency ordering
          orderBy: useFts ? undefined : [{ enrichedAt: 'desc' }, { tweetCreatedAt: 'desc' }],
          take: MAX_CANDIDATES,
          select: selectShape,
        })
      : prisma.bookmark.findMany({ where: { id: 'never' }, select: selectShape }),

    intentSlugs.length > 0
      ? prisma.bookmark.findMany({
          where: {
            ...categoryFilter,
            categories: { some: { category: { slug: { in: intentSlugs } } } },
          },
          orderBy: [{ enrichedAt: 'desc' }, { tweetCreatedAt: 'desc' }],
          take: 80,
          select: selectShape,
        })
      : prisma.bookmark.findMany({ where: { id: 'never' }, select: selectShape }),
  ])

  // Merge: keyword hits first (more specific), then intent hits, dedup by id
  const seen = new Set<string>()
  const merged: typeof keywordHits = []
  for (const b of [...keywordHits, ...intentHits]) {
    if (!seen.has(b.id)) { seen.add(b.id); merged.push(b) }
  }

  // If still very few candidates, pull a recent sample so Claude has something to work with
  let bookmarks = merged
  if (bookmarks.length < 20) {
    const fallback = await prisma.bookmark.findMany({
      where: categoryFilter,
      orderBy: [{ enrichedAt: 'desc' }, { tweetCreatedAt: 'desc' }],
      take: MAX_CANDIDATES,
      select: selectShape,
    })
    const fallbackSeen = new Set(bookmarks.map((b) => b.id))
    for (const b of fallback) {
      if (!fallbackSeen.has(b.id)) { fallbackSeen.add(b.id); bookmarks.push(b) }
    }
    // Cap total
    bookmarks = bookmarks.slice(0, MAX_CANDIDATES)
  }

  if (bookmarks.length === 0) {
    return NextResponse.json({ bookmarks: [], explanation: 'No bookmarks found.' })
  }

  // ── Step 2: Build rich search index ───────────────────────────────────────
  const indexEntries = bookmarks.map(buildIndexEntry)

  // ── Step 3: Compose a better prompt ───────────────────────────────────────
  const prompt = `You are an expert semantic search engine for a personal Twitter/X bookmark knowledge base. Find bookmarks that genuinely match what the user wants — even when exact words don't appear.

USER QUERY: "${query}"
${category ? `RESTRICTED TO CATEGORY: "${category}"` : ''}

HOW TO SEARCH:
1. Understand INTENT first: what topic, emotion, visual, or use-case is the user after?
2. Check ALL fields — the ai_tags field contains pre-computed semantic context and is highly reliable
3. Consider synonyms and indirect matches: "identity verification problems" matches "bad KYC practices"
4. For visual/meme queries: weight media fields heavily (scene, action, ocr text IN the image, vtags)
5. Indirect signals count: if categories say "finance-crypto(0.9)" and query is about investing → likely relevant
6. Score generously for semantic neighbors (0.4+), reserve 0.9+ for clear matches

BOOKMARK FORMAT:
[bookmark_id]
text: tweet text (most direct signal)
media: type | style | scene | action | mood | meme=template | ocr="text inside image" | objects | vtags=visual tags
ai_tags: AI-generated search tags (pre-computed, highly reliable)
#hashtags | tools: detected tools/products | @mentions
categories: assigned categories with confidence scores

BOOKMARKS (${bookmarks.length} total):
${indexEntries.join('\n---\n')}

Return ONLY valid JSON — no markdown, no prose outside the JSON object:
{
  "queryIntent": "one phrase describing what the user wants",
  "matches": [
    { "id": "bookmark_id", "score": 0.0-1.0, "reason": "≤10 words why it matches" }
  ],
  "explanation": "one sentence summarizing what was found and why"
}

Constraints:
- Up to 15 matches, sorted by score descending
- Minimum score 0.30 — be generous for semantically close matches
- Never repeat an id
- Only return ids from the list above
- reason must be specific, not generic ("shows bitcoin price crash chart" not "related to crypto")`

  let aiResponse: { queryIntent?: string; matches: { id: string; score: number; reason: string }[]; explanation: string } = { matches: [], explanation: 'No results found.' }

  const parseSearchResponse = (rawText: string): typeof aiResponse => {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    return jsonMatch
      ? (JSON.parse(jsonMatch[0]) as typeof aiResponse)
      : { matches: [], explanation: 'No results found.' }
  }

  // Try CLI first (works with ChatGPT OAuth), then fall back to SDK
  let cliSucceeded = false
  if (provider === 'openai' && await getCodexCliAvailability()) {
    try {
      const result = await codexPrompt(prompt, { timeoutMs: 90_000 })
      if (result.success && result.data) {
        aiResponse = parseSearchResponse(result.data)
        cliSucceeded = true
      }
    } catch { /* fall through to SDK */ }
  } else if (provider === 'anthropic' && await getCliAvailability()) {
    try {
      const cliModel = modelNameToCliAlias(model)
      const result = await claudePrompt(prompt, { model: cliModel, timeoutMs: 90_000 })
      if (result.success && result.data) {
        aiResponse = parseSearchResponse(result.data)
        cliSucceeded = true
      }
    } catch { /* fall through to SDK */ }
  }

  if (!cliSucceeded) {
    if (!client) {
      const errorMessage = isTextOnlyProvider(provider)
        ? clientResolveError?.message ?? 'OpenAI-compatible provider requires a base URL and direct HTTP client configuration.'
        : 'No CLI available and no API key configured. Add an API key in Settings or install Codex/Claude CLI.'
      return NextResponse.json(
        { error: errorMessage },
        { status: 400 },
      )
    }
    try {
      const response = await client.createMessage({
        model,
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      })
      const rawText = response.text ?? '{}'
      aiResponse = parseSearchResponse(rawText)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error('AI search error:', errMsg)
      return NextResponse.json({ error: `AI search failed: ${errMsg}` }, { status: 500 })
    }
  }

  // ── Step 4: Hydrate results ────────────────────────────────────────────────
  const bookmarkById = new Map(bookmarks.map((b) => [b.id, b]))
  const matchMap = new Map(aiResponse.matches.map((m) => [m.id, m]))

  const results = aiResponse.matches
    .sort((a, b) => b.score - a.score)
    .map((match) => {
      const b = bookmarkById.get(match.id)
      if (!b) return null
      return {
        id: b.id,
        tweetId: b.tweetId,
        text: b.text,
        authorHandle: b.authorHandle,
        authorName: b.authorName,
        tweetCreatedAt: b.tweetCreatedAt?.toISOString() ?? null,
        importedAt: b.importedAt.toISOString(),
        mediaItems: b.mediaItems.map((m) => ({
          id: m.id, type: m.type, url: m.url, thumbnailUrl: m.thumbnailUrl, imageTags: m.imageTags ?? null,
        })),
        categories: b.categories.map((bc) => ({
          id: bc.category.id, name: bc.category.name, slug: bc.category.slug,
          color: bc.category.color, confidence: bc.confidence,
        })),
        aiScore: matchMap.get(b.id)?.score ?? 0,
        aiReason: matchMap.get(b.id)?.reason ?? '',
      }
    })
    .filter(Boolean)

  const response = { bookmarks: results, explanation: aiResponse.explanation }
  setCache(cacheKey, response)
  return NextResponse.json(response)
}
