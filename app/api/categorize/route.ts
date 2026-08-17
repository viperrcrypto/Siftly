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
import { normalizeUiLanguage, UI_LANGUAGE_COOKIE } from '@/lib/i18n'
import { threadContextFromArchive } from '@/lib/thread-context'

type Stage = 'vision' | 'entities' | 'enrichment' | 'categorize' | 'parallel'

interface CategorizationState {
  runId: string | null
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
  categorizationRunSequence: number
}

if (!globalState.categorizationState) {
  globalState.categorizationState = {
    runId: null,
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
if (globalState.categorizationRunSequence === undefined) globalState.categorizationRunSequence = 0

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
    runId: state.runId,
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

function nextRunId(): string {
  globalState.categorizationRunSequence++
  return `${Date.now().toString(36)}-${globalState.categorizationRunSequence}`
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (getState().status === 'running' || getState().status === 'stopping') {
    return NextResponse.json({ error: 'Categorization is already running' }, { status: 409 })
  }

  let body: Record<string, unknown> = {}
  try {
    const text = await request.text()
    if (text.trim()) {
      const parsed: unknown = JSON.parse(text)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return NextResponse.json({ error: 'JSON body must be an object' }, { status: 400 })
      }
      body = parsed as Record<string, unknown>
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { bookmarkIds = [], apiKey, force = false, categoryOnly = false } = body
  if (typeof force !== 'boolean' || typeof categoryOnly !== 'boolean' || (apiKey !== undefined && typeof apiKey !== 'string')) {
    return NextResponse.json({ error: 'force and categoryOnly must be booleans; apiKey must be a string' }, { status: 400 })
  }
  if (bookmarkIds !== undefined && (!Array.isArray(bookmarkIds) || bookmarkIds.some((id) => typeof id !== 'string'))) {
    return NextResponse.json({ error: 'bookmarkIds must be an array of bookmark IDs' }, { status: 400 })
  }
  const language = normalizeUiLanguage(body.language ?? request.cookies?.get(UI_LANGUAGE_COOKIE)?.value)

  if (categoryOnly === true) {
    if (force === true || apiKey !== undefined) {
      return NextResponse.json({ error: 'categoryOnly cannot be combined with force or apiKey' }, { status: 400 })
    }
    if (!Array.isArray(bookmarkIds) || bookmarkIds.length === 0 || bookmarkIds.some((id) => typeof id !== 'string' || !id.trim())) {
      return NextResponse.json({ error: 'bookmarkIds must be a non-empty array of bookmark IDs' }, { status: 400 })
    }
    const selectedIds = [...new Set(bookmarkIds.map((id) => id.trim()))]
    if (selectedIds.length > 500) return NextResponse.json({ error: 'bookmarkIds must contain at most 500 IDs' }, { status: 400 })
    const selected = await prisma.bookmark.findMany({
      where: { id: { in: selectedIds }, deletedAt: null },
      select: BOOKMARK_SELECT,
    })
    if (selected.length !== selectedIds.length) return NextResponse.json({ error: 'One or more bookmarks were not found' }, { status: 404 })

    const runId = nextRunId()
    globalState.categorizationAbort = false
    setState({
      runId, status: 'running', stage: 'categorize', done: 0, total: selectedIds.length,
      stageCounts: { visionTagged: 0, entitiesExtracted: 0, enriched: 0, categorized: 0 }, lastError: null, error: null,
    })
    void (async () => {
      const counts = { visionTagged: 0, entitiesExtracted: 0, enriched: 0, categorized: 0 }
      try {
        const provider = await getProvider()
        const keyName = provider === 'openai' ? 'openaiApiKey' : 'anthropicApiKey'
        const dbApiKey = (await prisma.setting.findUnique({ where: { key: keyName } }))?.value?.trim() || ''
        let client: AIClient | null = null
        try { client = await resolveAIClient({ dbKey: dbApiKey }) } catch { /* CLI may be available */ }
        const categories = await prisma.category.findMany({ select: { slug: true, name: true, description: true } })
        const descriptions = Object.fromEntries(categories.map((category) => [category.slug, category.description?.trim() || category.name]))
        const slugs = categories.map((category) => category.slug)
        let done = 0
        for (let index = 0; index < selected.length && !shouldAbort(); index += CAT_BATCH_SIZE) {
          const rows = selected.slice(index, index + CAT_BATCH_SIZE)
          const batch = rows.map(mapBookmarkForCategorization)
          try {
            const results = await categorizeBatch(batch, client, descriptions, slugs, language)
            const expectedTweetIds = new Set(batch.map((bookmark) => bookmark.tweetId))
            const actualTweetIds = results.map((result) => result.tweetId)
            const valid = results.length === batch.length
              && actualTweetIds.every((tweetId) => expectedTweetIds.has(tweetId))
              && new Set(actualTweetIds).size === actualTweetIds.length
              && results.every((result) => result.assignments.length > 0)
            if (!valid) throw new Error('AI response did not contain one non-empty result for every selected bookmark')
            await writeCategoryResults(results, {
              bookmarkByTweetId: new Map(rows.map((bookmark) => [bookmark.tweetId, bookmark.id])),
              replaceAiCategories: true,
              updateEnrichedAt: false,
            })
            counts.categorized += rows.length
          } catch (error) {
            setState({ lastError: error instanceof Error ? error.message.slice(0, 200) : String(error) })
          }
          done += rows.length
          setState({ done, stageCounts: { ...counts } })
        }
      } catch (error) {
        setState({ lastError: error instanceof Error ? error.message.slice(0, 200) : String(error) })
      }
    })().then(() => {
      const wasStopped = globalState.categorizationAbort
      globalState.categorizationAbort = false
      setState({
        status: 'idle', stage: null, done: wasStopped ? getState().done : selectedIds.length, total: selectedIds.length,
        error: wasStopped ? 'Stopped by user' : getState().lastError,
      })
    })
    return NextResponse.json({ status: 'started', total: selectedIds.length, runId })
  }

  if (!Array.isArray(bookmarkIds)) return NextResponse.json({ error: 'bookmarkIds must be an array' }, { status: 400 })

  if (apiKey && typeof apiKey === 'string' && apiKey.trim() !== '') {
    const currentProvider = await getProvider()
    const keySlot = currentProvider === 'openai' ? 'openaiApiKey' : 'anthropicApiKey'
    await prisma.setting.upsert({
      where: { key: keySlot },
      update: { value: apiKey.trim() },
      create: { key: keySlot, value: apiKey.trim() },
    })
  }

  const runId = nextRunId()
  globalState.categorizationAbort = false

  let total = 0
  try {
    if (bookmarkIds.length > 0) {
      total = await prisma.bookmark.count({ where: { id: { in: bookmarkIds }, deletedAt: null } })
    } else if (force) {
      total = await prisma.bookmark.count({ where: { deletedAt: null } })
    } else {
      total = await prisma.bookmark.count({ where: { enrichedAt: null, deletedAt: null } })
    }
  } catch {
    total = 0
  }

  setState({
    runId,
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
          await prisma.mediaItem.updateMany({ where: { imageTags: '{}', bookmark: { deletedAt: null } }, data: { imageTags: null } })
          await prisma.bookmark.updateMany({ where: { semanticTags: '[]', deletedAt: null }, data: { semanticTags: null } })
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
            const selected = await prisma.bookmark.findMany({ where: { id: { in: bookmarkIds }, deletedAt: null }, select: { id: true } })
            bookmarkIdsToProcess = selected.map((bookmark) => bookmark.id)
          } else if (force) {
            const all = await prisma.bookmark.findMany({ where: { deletedAt: null }, select: { id: true }, orderBy: { id: 'asc' } })
            bookmarkIdsToProcess = all.map((b) => b.id)
          } else {
            const unprocessed = await prisma.bookmark.findMany({
              where: { enrichedAt: null, deletedAt: null },
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
                  where: { id: { in: ids }, deletedAt: null },
                  select: BOOKMARK_SELECT,
                })
                const batch = rows.map(mapBookmarkForCategorization)
                try {
                  const results = await categorizeBatch(batch, client, categoryDescriptions, allSlugs, language)
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

            const bm = await prisma.bookmark.findFirst({
              where: { id: bookmarkId, deletedAt: null },
              select: {
                id: true,
                text: true,
                semanticTags: true,
                entities: true,
                mediaItems: {
                  where: { type: { in: ['photo', 'gif', 'video'] } },
                  select: { id: true, url: true, thumbnailUrl: true, type: true, imageTags: true },
                },
                archive: { select: { resultJson: true } },
              },
            })
            if (!bm) return
            const classificationText = threadContextFromArchive(bm.archive?.resultJson, bm.text)

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

              if (imageTags.length === 0 && classificationText.length < 20) {
                // Trivial bookmark — skip enrichment
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
                    [{ id: bm.id, text: classificationText, imageTags, entities }],
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

  return NextResponse.json({ status: 'started', total, runId })
}
