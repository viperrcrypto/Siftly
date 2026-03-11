import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { AIClient, resolveAIClient } from '@/lib/ai-client'
import { getActiveModel, getProvider } from '@/lib/settings'
import {
  seedDefaultCategories,
  categorizeBatch,
  mapBookmarkForCategorization,
  writeCategoryResults,
  BOOKMARK_SELECT,
} from '@/lib/categorizer'
import {
  analyzeItem,
  runWithConcurrency,
  enrichBatchSemanticTags,
  BookmarkForEnrichment,
} from '@/lib/vision-analyzer'
import { backfillEntities } from '@/lib/rawjson-extractor'
import { rebuildFts } from '@/lib/fts'

/** Lightweight link preview: returns title + description from og/meta tags. */
async function fetchLinkPreview(url: string): Promise<{ title: string; description: string } | null> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
    })
    if (!res.ok) return null
    const html = await res.text()
    const get = (...patterns: RegExp[]) => {
      for (const p of patterns) { const m = html.match(p); if (m?.[1]) return m[1].trim() }
      return ''
    }
    const title = get(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
      /<title>([^<]+)<\/title>/i)
    const description = get(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)
    if (!title && !description) return null
    return { title, description }
  } catch {
    return null
  }
}

type Stage = 'vision' | 'entities' | 'enrichment' | 'categorize' | 'parallel'

interface CategorizationState {
  status: 'idle' | 'running' | 'stopping'
  stage: Stage | null
  done: number
  total: number
  stageCounts: {
    visionTagged: number
    entitiesExtracted: number
    enriched: number
    categorized: number
  }
  lastError: string | null
  error: string | null
}

// In-memory state for progress tracking across requests
const globalState = globalThis as unknown as {
  categorizationState: CategorizationState
  categorizationAbort: boolean
}

if (!globalState.categorizationState) {
  globalState.categorizationState = {
    status: 'idle',
    stage: null,
    done: 0,
    total: 0,
    stageCounts: { visionTagged: 0, entitiesExtracted: 0, enriched: 0, categorized: 0 },
    lastError: null,
    error: null,
  }
}
if (globalState.categorizationAbort === undefined) {
  globalState.categorizationAbort = false
}

function shouldAbort(): boolean {
  return globalState.categorizationAbort
}

function getState(): CategorizationState {
  return { ...globalState.categorizationState }
}

function setState(update: Partial<CategorizationState>): void {
  globalState.categorizationState = { ...globalState.categorizationState, ...update }
}

export async function GET(): Promise<NextResponse> {
  const state = getState()
  return NextResponse.json({
    status: state.status,
    stage: state.stage,
    done: state.done,
    total: state.total,
    stageCounts: state.stageCounts,
    lastError: state.lastError,
    error: state.error,
  })
}

export async function DELETE(): Promise<NextResponse> {
  const state = getState()
  if (state.status !== 'running') {
    return NextResponse.json({ error: 'No pipeline running' }, { status: 409 })
  }
  globalState.categorizationAbort = true
  setState({ status: 'stopping' })
  return NextResponse.json({ stopped: true })
}

const PIPELINE_WORKERS = 5
const CAT_BATCH_SIZE = 25

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (getState().status === 'running' || getState().status === 'stopping') {
    return NextResponse.json({ error: 'Categorization is already running' }, { status: 409 })
  }

  let body: { bookmarkIds?: string[]; apiKey?: string; force?: boolean } = {}
  try {
    const text = await request.text()
    if (text.trim()) body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { bookmarkIds = [], apiKey, force = false } = body

  if (apiKey && typeof apiKey === 'string' && apiKey.trim() !== '') {
    const currentProvider = await getProvider()
    const keySlot = currentProvider === 'openai' ? 'openaiApiKey' : 'anthropicApiKey'
    await prisma.setting.upsert({
      where: { key: keySlot },
      update: { value: apiKey.trim() },
      create: { key: keySlot, value: apiKey.trim() },
    })
  }

  globalState.categorizationAbort = false

  let total = 0
  try {
    if (bookmarkIds.length > 0) {
      total = bookmarkIds.length
    } else if (force) {
      total = await prisma.bookmark.count()
    } else {
      total = await prisma.bookmark.count({ where: { enrichedAt: null } })
    }
  } catch {
    total = 0
  }

  setState({
    status: 'running',
    stage: 'entities',
    done: 0,
    total,
    stageCounts: { visionTagged: 0, entitiesExtracted: 0, enriched: 0, categorized: 0 },
    lastError: null,
    error: null,
  })

  const provider = await getProvider()
  const keyName = provider === 'openai' ? 'openaiApiKey' : 'anthropicApiKey'
  const dbApiKey =
    (await prisma.setting.findUnique({ where: { key: keyName } }))?.value?.trim() || ''

  void (async () => {
    const counts = { visionTagged: 0, entitiesExtracted: 0, enriched: 0, categorized: 0 }

    try {
      let client: AIClient | null = null
      try {
        client = await resolveAIClient({ dbKey: dbApiKey })
      } catch {
        // SDK client not available — CLI path may still work (e.g. ChatGPT OAuth via codex exec)
        console.warn('No SDK client available — will rely on CLI path')
      }

        await seedDefaultCategories()

        if (force) {
          await prisma.mediaItem.updateMany({ where: { imageTags: '{}' }, data: { imageTags: null } })
          await prisma.bookmark.updateMany({ where: { semanticTags: '[]' }, data: { semanticTags: null } })
        }

        // Stage 1: Entity extraction (free, fast — no API calls)
        if (!shouldAbort()) {
          setState({ stage: 'entities' })
          counts.entitiesExtracted = await backfillEntities((n) => {
            counts.entitiesExtracted = n
            setState({ stageCounts: { ...counts } })
          }, shouldAbort).catch((err) => {
            console.error('Entity extraction error:', err)
            return counts.entitiesExtracted
          })
          setState({ stageCounts: { ...counts } })
        }

        // Stage 2: Parallel pipeline — vision + enrichment + categorize per bookmark
        if (!shouldAbort()) {
          // Fetch all bookmark IDs to process
          let bookmarkIdsToProcess: string[]
          if (bookmarkIds.length > 0) {
            bookmarkIdsToProcess = bookmarkIds
          } else if (force) {
            const all = await prisma.bookmark.findMany({ select: { id: true }, orderBy: { id: 'asc' } })
            bookmarkIdsToProcess = all.map((b) => b.id)
          } else {
            const unprocessed = await prisma.bookmark.findMany({
              where: { enrichedAt: null },
              select: { id: true },
              orderBy: { id: 'asc' },
            })
            bookmarkIdsToProcess = unprocessed.map((b) => b.id)
          }

          const runTotal = bookmarkIdsToProcess.length
          setState({ stage: 'parallel', done: 0, total: runTotal, stageCounts: { ...counts } })

          // Load category metadata once (shared across all workers)
          const dbCategories = await prisma.category.findMany({
            select: { slug: true, name: true, description: true },
          })
          const allSlugs = dbCategories.map((c) => c.slug)
          const categoryDescriptions = Object.fromEntries(
            dbCategories.map((c) => [c.slug, c.description?.trim() || c.name]),
          )
          const model = await getActiveModel()

          // Shared categorization queue (JS single-threaded: splice is atomic vs async)
          const catPending: string[] = []
          let catFlushing = false

          async function drainCategorizeQueue(final = false): Promise<void> {
            if (final) {
              // Wait for any in-progress flush before draining remainder
              while (catFlushing) {
                await new Promise<void>((resolve) => setTimeout(resolve, 50))
              }
            } else if (catFlushing || catPending.length < CAT_BATCH_SIZE) {
              return
            }

            catFlushing = true
            try {
              while (catPending.length > 0) {
                if (!final && catPending.length < CAT_BATCH_SIZE) break
                const ids = catPending.splice(0, CAT_BATCH_SIZE)
                if (ids.length === 0) break
                const rows = await prisma.bookmark.findMany({
                  where: { id: { in: ids } },
                  select: BOOKMARK_SELECT,
                })
                const batch = rows.map(mapBookmarkForCategorization)
                try {
                  const results = await categorizeBatch(batch, client, categoryDescriptions, allSlugs)
                  await writeCategoryResults(results)
                  counts.categorized += ids.length
                  setState({ stageCounts: { ...counts } })
                } catch (catErr) {
                  console.error('[parallel] categorize batch error:', catErr)
                }
              }
            } finally {
              catFlushing = false
            }
          }

          let processedCount = 0

          async function processBookmark(bookmarkId: string): Promise<void> {
            if (shouldAbort()) return

            const bm = await prisma.bookmark.findUnique({
              where: { id: bookmarkId },
              select: {
                id: true,
                text: true,
                semanticTags: true,
                entities: true,
                mediaItems: {
                  where: { type: { in: ['photo', 'gif', 'video'] } },
                  select: { id: true, url: true, thumbnailUrl: true, type: true, imageTags: true },
                },
              },
            })
            if (!bm) return

            // Vision: analyze any untagged media items (SDK or CLI)
            let anyVisionRan = false
            for (const media of bm.mediaItems) {
              if (shouldAbort()) return
              if (media.imageTags !== null) continue
              try {
                await analyzeItem(
                  { id: media.id, url: media.url, thumbnailUrl: media.thumbnailUrl, type: media.type },
                  client,
                  model,
                )
                anyVisionRan = true
                counts.visionTagged++
                setState({ stageCounts: { ...counts } })
              } catch (err) {
                console.warn('[parallel] vision failed for', media.id, err instanceof Error ? err.message : err)
              }
            }

            // Enrichment: generate semantic tags if not already done
            if (!bm.semanticTags) {
              // Re-fetch image tags from DB after vision (or use initial fetch if no vision ran)
              const imageTags = anyVisionRan
                ? (
                    await prisma.mediaItem.findMany({
                      where: { bookmarkId: bm.id, type: { in: ['photo', 'gif', 'video'] } },
                      select: { imageTags: true },
                    })
                  )
                    .map((m) => m.imageTags)
                    .filter((t): t is string => t !== null && t !== '' && t !== '{}')
                : bm.mediaItems
                    .map((m) => m.imageTags)
                    .filter((t): t is string => t !== null && t !== '' && t !== '{}')

              // If text is too short but we have a URL, try to enrich from the page title/description
              let enrichedText = bm.text
              if (imageTags.length === 0 && bm.text.length < 20 && bm.entities) {
                try {
                  const ents = JSON.parse(bm.entities) as { urls?: Array<{ expanded?: string }> }
                  const url = ents?.urls?.[0]?.expanded
                  if (url) {
                    const preview = await fetchLinkPreview(url)
                    if (preview) {
                      enrichedText = [preview.title, preview.description].filter(Boolean).join('. ')
                      // Persist so future runs don't re-fetch
                      await prisma.bookmark.update({ where: { id: bm.id }, data: { text: enrichedText } })
                    }
                  }
                } catch { /* ignore — best effort */ }
              }

              if (imageTags.length === 0 && enrichedText.length < 20) {
                // Truly trivial bookmark (no text, no media, no url preview) — skip enrichment
                await prisma.bookmark.update({ where: { id: bm.id }, data: { semanticTags: '[]' } })
              } else {
                let entities: BookmarkForEnrichment['entities'] = undefined
                if (bm.entities) {
                  try {
                    entities = JSON.parse(bm.entities) as BookmarkForEnrichment['entities']
                  } catch { /* ignore */ }
                }
                try {
                  const results = await enrichBatchSemanticTags(
                    [{ id: bm.id, text: bm.text, imageTags, entities }],
                    client,
                  )
                  const result = results[0]
                  if (result?.tags.length) {
                    await prisma.bookmark.update({
                      where: { id: bm.id },
                      data: {
                        semanticTags: JSON.stringify(result.tags),
                        enrichmentMeta: JSON.stringify({
                          sentiment: result.sentiment,
                          people: result.people,
                          companies: result.companies,
                        }),
                      },
                    })
                    counts.enriched++
                    setState({ stageCounts: { ...counts } })
                  }
                } catch (err) {
                  console.warn('[parallel] enrichment failed for', bm.id, err instanceof Error ? err.message : err)
                }
              }
            }

            // Queue for categorization
            catPending.push(bm.id)
            processedCount++
            setState({ done: processedCount, stageCounts: { ...counts } })
            await drainCategorizeQueue()
          }

          // Run all bookmark workers with bounded concurrency
          const tasks = bookmarkIdsToProcess.map((id) => () => processBookmark(id))
          try {
            await runWithConcurrency(tasks, PIPELINE_WORKERS)
          } finally {
            // Always drain remaining items even if some workers threw
            await drainCategorizeQueue(true)
          }
        }
    } catch (err) {
      console.error('Pipeline error:', err)
      setState({ lastError: err instanceof Error ? err.message.slice(0, 200) : String(err) })
    }

    if (!shouldAbort()) {
      await rebuildFts().catch((err) => console.error('FTS rebuild error:', err))
    }
  })()
    .then(() => {
      const wasStopped = globalState.categorizationAbort
      globalState.categorizationAbort = false
      setState({
        status: 'idle',
        stage: null,
        done: wasStopped ? getState().done : total,
        total,
        error: wasStopped ? 'Stopped by user' : null,
      })
    })
    .catch((err) => {
      globalState.categorizationAbort = false
      console.error('Categorization pipeline error:', err)
      setState({
        status: 'idle',
        stage: null,
        error: err instanceof Error ? err.message : String(err),
      })
    })

  return NextResponse.json({ status: 'started', total })
}
