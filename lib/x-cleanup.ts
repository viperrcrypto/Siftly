import prisma from '@/lib/db'
import type { CleanupStatus, CleanupSource } from '@/lib/types'

// GraphQL mutation query IDs — update if X returns 400 after a platform deploy
const DELETE_BOOKMARK_QUERY_ID = 'Fn36NTYDO0hkMlBM4eoLcA'
const UNLIKE_QUERY_ID = 'ZYKSe-w7KEslx3JhSIk5LA'

const BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

const INTER_REQUEST_DELAY_MS = 1000
const RATE_LIMIT_BACKOFF_MS = 60_000

// ── State ────────────────────────────────────────────────────────────────────

let cleanupRunning = false
let cleanupShouldStop = false
let status: CleanupStatus = { running: false, done: 0, total: 0, failed: 0, lastError: null }

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function xHeaders(authToken: string, ct0: string): Record<string, string> {
  return {
    Authorization: `Bearer ${BEARER}`,
    'X-Csrf-Token': ct0,
    Cookie: `auth_token=${authToken}; ct0=${ct0}`,
    'X-Twitter-Auth-Type': 'OAuth2Session',
    'X-Twitter-Active-User': 'yes',
    'X-Twitter-Client-Language': 'en',
    'Content-Type': 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  }
}

// ── Mutations ────────────────────────────────────────────────────────────────

type MutationResult = 'ok' | 'already_removed' | 'rate_limit' | 'auth_error' | 'error'

async function deleteBookmark(
  authToken: string,
  ct0: string,
  tweetId: string,
): Promise<MutationResult> {
  const res = await fetch(
    `https://x.com/i/api/graphql/${DELETE_BOOKMARK_QUERY_ID}/DeleteBookmark`,
    {
      method: 'POST',
      headers: xHeaders(authToken, ct0),
      body: JSON.stringify({
        variables: { tweet_id: tweetId },
        queryId: DELETE_BOOKMARK_QUERY_ID,
      }),
    },
  )

  if (res.status === 429) return 'rate_limit'
  if (res.status === 401 || res.status === 403) return 'auth_error'
  if (!res.ok) return 'error'

  try {
    const json = await res.json()
    // Tweet already deleted or not found
    if (json.errors?.some((e: { code?: number }) => e.code === 144)) return 'already_removed'
    return 'ok'
  } catch {
    return 'ok' // 200 with empty/non-JSON body is fine
  }
}

async function unlikeTweet(
  authToken: string,
  ct0: string,
  tweetId: string,
): Promise<MutationResult> {
  const res = await fetch(
    `https://x.com/i/api/graphql/${UNLIKE_QUERY_ID}/UnfavoriteTweet`,
    {
      method: 'POST',
      headers: xHeaders(authToken, ct0),
      body: JSON.stringify({
        variables: { tweet_id: tweetId },
        queryId: UNLIKE_QUERY_ID,
      }),
    },
  )

  if (res.status === 429) return 'rate_limit'
  if (res.status === 401 || res.status === 403) return 'auth_error'
  if (!res.ok) return 'error'

  try {
    const json = await res.json()
    if (json.errors?.some((e: { code?: number }) => e.code === 144)) return 'already_removed'
    return 'ok'
  } catch {
    return 'ok'
  }
}

// ── Cleanup job ──────────────────────────────────────────────────────────────

export async function startCleanup(
  authToken: string,
  ct0: string,
  source: CleanupSource,
): Promise<void> {
  if (cleanupRunning) throw new Error('Cleanup already in progress')

  const where: Record<string, unknown> = { cleanedFromX: null }
  if (source !== 'all') where.source = source

  const items = await prisma.bookmark.findMany({
    where,
    select: { id: true, tweetId: true, source: true },
    orderBy: { importedAt: 'asc' },
  })

  cleanupRunning = true
  cleanupShouldStop = false
  status = { running: true, done: 0, total: items.length, failed: 0, lastError: null }

  try {
    for (const item of items) {
      if (cleanupShouldStop) {
        status.lastError = 'Stopped by user'
        break
      }

      // 1-to-1 safety check: verify item still exists in Siftly before touching X
      const existsInSiftly = await prisma.bookmark.findUnique({
        where: { id: item.id },
        select: { id: true },
      })
      if (!existsInSiftly) {
        console.log(`[x-cleanup] Skipping ${item.tweetId} — no longer in Siftly, not touching X`)
        status.done++
        continue
      }

      const mutate = item.source === 'like' ? unlikeTweet : deleteBookmark
      let result = await mutate(authToken, ct0, item.tweetId)

      // On rate limit, back off once and retry
      if (result === 'rate_limit') {
        console.log(`[x-cleanup] Rate limited, backing off ${RATE_LIMIT_BACKOFF_MS / 1000}s...`)
        await sleep(RATE_LIMIT_BACKOFF_MS)
        result = await mutate(authToken, ct0, item.tweetId)
      }

      if (result === 'auth_error') {
        status.lastError = 'Session expired — re-save credentials in Import > Live Import and try again.'
        status.failed++
        break
      }

      if (result === 'ok' || result === 'already_removed') {
        await prisma.bookmark.update({
          where: { id: item.id },
          data: { cleanedFromX: new Date() },
        })
        status.done++
      } else {
        status.failed++
        status.lastError = `Failed to clean tweet ${item.tweetId}`
      }

      await sleep(INTER_REQUEST_DELAY_MS)
    }
  } catch (err) {
    status.lastError = err instanceof Error ? err.message : String(err)
  } finally {
    cleanupRunning = false
    cleanupShouldStop = false
    status.running = false
  }
}

export function stopCleanup() {
  cleanupShouldStop = true
}

export function isCleanupRunning() {
  return cleanupRunning
}

export function getCleanupStatus(): CleanupStatus {
  return { ...status }
}
