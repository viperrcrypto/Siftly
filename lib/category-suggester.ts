import prisma from '@/lib/db'
import { getActiveModel, getProvider } from '@/lib/settings'
import { AIClient, resolveAIClient } from '@/lib/ai-client'
import { getCliAvailability, claudePrompt, modelNameToCliAlias } from '@/lib/claude-cli-auth'
import { getCodexCliAvailability, codexPrompt } from '@/lib/codex-cli'

export interface CategorySuggestion {
  name: string
  slug: string
  description: string
  color: string
  bookmarkCount: number
  confidence: number
  exampleBookmarks: Array<{
    tweetId: string
    text: string
    authorHandle: string
  }>
}

interface BookmarkSample {
  id: string
  tweetId: string
  text: string
  authorHandle: string
  semanticTags?: string[]
  hashtags?: string[]
  tools?: string[]
}

const CATEGORY_COLORS = [
  '#8b5cf6', // violet
  '#f59e0b', // amber
  '#06b6d4', // cyan
  '#10b981', // green
  '#f97316', // orange
  '#6366f1', // indigo
  '#ec4899', // pink
  '#14b8a6', // teal
  '#ef4444', // red
  '#3b82f6', // blue
  '#a855f7', // purple
  '#eab308', // yellow
  '#64748b', // slate
  '#84cc16', // lime
  '#06b6d4', // cyan
]

/**
 * Sample bookmarks for analysis (stratified sampling for diversity)
 */
async function getBookmarkSamples(limit: number = 100): Promise<BookmarkSample[]> {
  // Get bookmarks with enrichment data first
  const bookmarks = await prisma.bookmark.findMany({
    where: {
      OR: [
        { semanticTags: { not: null } },
        { entities: { not: null } },
      ],
    },
    take: limit,
    orderBy: { importedAt: 'desc' },
    select: {
      id: true,
      tweetId: true,
      text: true,
      authorHandle: true,
      semanticTags: true,
      entities: true,
    },
  })

  // If not enough enriched bookmarks, get regular ones too
  if (bookmarks.length < limit) {
    const remaining = limit - bookmarks.length
    const additional = await prisma.bookmark.findMany({
      where: {
        semanticTags: null,
        entities: null,
      },
      take: remaining,
      orderBy: { importedAt: 'desc' },
      select: {
        id: true,
        tweetId: true,
        text: true,
        authorHandle: true,
        semanticTags: true,
        entities: true,
      },
    })
    bookmarks.push(...additional)
  }

  return bookmarks.map((b) => {
    let entities: { hashtags?: string[]; tools?: string[] } = {}
    try {
      if (b.entities) {
        entities = JSON.parse(b.entities)
      }
    } catch {
      // ignore parse errors
    }

    let semanticTags: string[] = []
    try {
      if (b.semanticTags) {
        semanticTags = JSON.parse(b.semanticTags)
      }
    } catch {
      // ignore parse errors
    }

    return {
      id: b.id,
      tweetId: b.tweetId,
      text: b.text.slice(0, 280), // Truncate long tweets
      authorHandle: b.authorHandle,
      semanticTags,
      hashtags: entities.hashtags || [],
      tools: entities.tools || [],
    }
  })
}

function buildCategorySuggestionPrompt(bookmarks: BookmarkSample[]): string {
  const bookmarkTexts = bookmarks
    .map(
      (b, i) =>
        `${i + 1}. @${b.authorHandle}: ${b.text}${b.semanticTags?.length ? ` [Tags: ${b.semanticTags.join(', ')}]` : ''}${b.hashtags?.length ? ` [Hashtags: ${b.hashtags.join(', ')}]` : ''}${b.tools?.length ? ` [Tools: ${b.tools.join(', ')}]` : ''}`
    )
    .join('\n\n')

  return `Analyze these bookmarked tweets and identify natural topic clusters. Suggest 3-8 custom categories that would help organize these bookmarks.

TWEETS TO ANALYZE:
${bookmarkTexts}

TASK:
1. Identify 3-8 distinct topic clusters/themes from these tweets
2. For each cluster, provide:
   - A clear, concise category name (2-4 words)
   - A detailed description that explains what content belongs (1-2 sentences)
   - The number of tweets that fit this category
   - 2-3 example tweet IDs that best represent this category

GUIDELINES:
- Categories should be specific enough to be useful (e.g., "Rust Programming" not "Programming")
- Avoid overly broad categories like "General" or "Misc"
- Categories should be mutually exclusive where possible
- Consider both the tweet content and any semantic tags/hashtags/tools
- Focus on recurring themes, not one-off topics

RESPOND WITH VALID JSON ONLY (no markdown, no explanation):
{
  "suggestions": [
    {
      "name": "Category Name",
      "description": "Detailed description of what content belongs here...",
      "bookmarkCount": 15,
      "confidence": 0.85,
      "exampleTweetIds": ["123456", "789012", "345678"]
    }
  ]
}`
}

async function suggestCategoriesViaCLI(bookmarks: BookmarkSample[]): Promise<CategorySuggestion[]> {
  const provider = await getProvider()
  const prompt = buildCategorySuggestionPrompt(bookmarks)

  if (provider === 'openai') {
    if (await getCodexCliAvailability()) {
      const result = await codexPrompt(prompt, { timeoutMs: 120_000 })
      if (!result.success || !result.data) {
        throw new Error('CLI categorization failed: ' + (result.error || 'No result'))
      }
      return parseCategorySuggestions(result.data, bookmarks)
    }
  } else {
    if (await getCliAvailability()) {
      const model = await getActiveModel()
      const cliModel = modelNameToCliAlias(model)
      const result = await claudePrompt(prompt, { model: cliModel, timeoutMs: 120_000 })
      if (!result.success || !result.data) {
        throw new Error('CLI categorization failed: ' + (result.error || 'No result'))
      }
      return parseCategorySuggestions(result.data, bookmarks)
    }
  }

  throw new Error('No CLI available for categorization')
}

async function suggestCategoriesViaSDK(
  bookmarks: BookmarkSample[],
  client: AIClient
): Promise<CategorySuggestion[]> {
  const prompt = buildCategorySuggestionPrompt(bookmarks)
  const model = await getActiveModel()

  const response = await client.createMessage({
    model,
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  })

  return parseCategorySuggestions(response.text, bookmarks)
}

function parseCategorySuggestions(
  responseText: string,
  bookmarks: BookmarkSample[]
): CategorySuggestion[] {
  // Extract JSON from response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('No JSON found in response')
  }

  let parsed: { suggestions?: Array<Partial<CategorySuggestion> & { exampleTweetIds?: string[] }> }
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch (err) {
    throw new Error('Failed to parse JSON: ' + (err instanceof Error ? err.message : String(err)))
  }

  if (!parsed.suggestions || !Array.isArray(parsed.suggestions)) {
    throw new Error('Invalid response format: missing suggestions array')
  }

  // Generate slugs and assign colors
  const usedSlugs = new Set<string>()

  return parsed.suggestions.map((suggestion, index) => {
    const baseSlug = suggestion.name
      ?.toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || `category-${index}`

    // Ensure unique slug
    let slug = baseSlug
    let counter = 1
    while (usedSlugs.has(slug)) {
      slug = `${baseSlug}-${counter}`
      counter++
    }
    usedSlugs.add(slug)

    // Find example bookmarks
    const exampleBookmarks = bookmarks
      .filter((b) => suggestion.exampleTweetIds?.includes(b.tweetId))
      .slice(0, 3)
      .map((b) => ({
        tweetId: b.tweetId,
        text: b.text.slice(0, 100) + (b.text.length > 100 ? '...' : ''),
        authorHandle: b.authorHandle,
      }))

    return {
      name: suggestion.name || 'Unnamed Category',
      slug,
      description: suggestion.description || '',
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
      bookmarkCount: suggestion.bookmarkCount || 0,
      confidence: suggestion.confidence || 0.5,
      exampleBookmarks,
    }
  })
}

/**
 * Generate AI-powered category suggestions based on bookmark analysis
 */
export async function generateCategorySuggestions(): Promise<CategorySuggestion[]> {
  // Get sample of bookmarks to analyze
  const bookmarks = await getBookmarkSamples(100)

  if (bookmarks.length < 10) {
    throw new Error('Not enough bookmarks to analyze. Need at least 10 bookmarks.')
  }

  const provider = await getProvider()

  // Try CLI first (preferred for OAuth tokens)
  try {
    if (provider === 'openai') {
      if (await getCodexCliAvailability()) {
        return await suggestCategoriesViaCLI(bookmarks)
      }
    } else {
      if (await getCliAvailability()) {
        return await suggestCategoriesViaCLI(bookmarks)
      }
    }
  } catch (err) {
    console.warn('CLI categorization failed, falling back to SDK:', err)
  }

  // Fallback to SDK
  try {
    const client = await resolveAIClient({})
    return await suggestCategoriesViaSDK(bookmarks, client)
  } catch (err) {
    console.error('SDK categorization failed:', err)
    throw new Error('Failed to generate category suggestions: ' + (err instanceof Error ? err.message : String(err)))
  }
}

/**
 * Create a category from a suggestion
 */
export async function createCategoryFromSuggestion(suggestion: CategorySuggestion): Promise<void> {
  const existing = await prisma.category.findFirst({
    where: { OR: [{ name: suggestion.name }, { slug: suggestion.slug }] },
  })

  if (existing) {
    throw new Error(`Category "${suggestion.name}" already exists`)
  }

  await prisma.category.create({
    data: {
      name: suggestion.name,
      slug: suggestion.slug,
      description: suggestion.description,
      color: suggestion.color,
      isAiGenerated: true,
    },
  })
}
