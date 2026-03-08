import prisma from '@/lib/db'
import type { CleanupStatus, CleanupSource, CleanupSpeed } from '@/lib/types'

// GraphQL mutation query IDs — update if X returns 400 after a platform deploy
const DELETE_BOOKMARK_QUERY_ID = 'Wlmlj2-xzyS1GN3a6cj-mQ'
const UNLIKE_QUERY_ID = 'ZYKSe-w7KEslx3JhSIk5LA'

const BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

// Delay between requests per speed setting
const SPEED_DELAY_MS: Record<CleanupSpeed, number> = {
  fast: 1000,    // ~1/sec — 1 hour for 3600 items
  normal: 3000,  // ~1/3sec — 3 hours for 3600 items
  safe: 5000,    // ~1/5sec — 5 hours for 3600 items
}

const RATE_LIMIT_BACKOFF_MS = 60_000

// ── State ────────────────────────────────────────────────────────────────────

let cleanupRunning = false
let cleanupShouldStop = false
let status: CleanupStatus = { running: false, done: 0, total: 0, failed: 0, speed: 'normal', lastError: null }

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
const NETWORK_RETRY_DELAY_MS = 5_000

async function sendMutationRequest(
  url: string,
  body: unknown,
  authToken: string,
  ct0: string,
  logPrefix: string,
): Promise<Response | null> {
  const requestInit: RequestInit = {
    method: 'POST',
    headers: xHeaders(authToken, ct0),
    body: JSON.stringify(body),
  }

  try {
    return await fetch(url, requestInit)
  } catch (err) {
    console.error(`[x-cleanup] ${logPrefix} network error, retrying in ${NETWORK_RETRY_DELAY_MS / 1000}s...`, err)
  }

  await sleep(NETWORK_RETRY_DELAY_MS)

  try {
    return await fetch(url, requestInit)
  } catch (err) {
    console.error(`[x-cleanup] ${logPrefix} retry failed`, err)
    return null
  }
}

function isAlreadyRemovedError(json: unknown): boolean {
  const errors =
    typeof json === 'object' && json !== null && 'errors' in json
      ? (json as { errors?: Array<{ code?: number }> }).errors
      : undefined

  // X may return these when the bookmark/like is already gone.
  return Boolean(errors?.some((e) => e.code === 34 || e.code === 144))
}

async function deleteBookmark(
  authToken: string,
  ct0: string,
  tweetId: string,
): Promise<MutationResult> {
  const res = await sendMutationRequest(
    `https://x.com/i/api/graphql/${DELETE_BOOKMARK_QUERY_ID}/DeleteBookmark`,
    {
      variables: { tweet_id: tweetId },
      queryId: DELETE_BOOKMARK_QUERY_ID,
    },
    authToken,
    ct0,
    `DeleteBookmark ${tweetId}`,
  )
  if (!res) return 'error'

  if (res.status === 429) return 'rate_limit'
  if (res.status === 401 || res.status === 403) return 'auth_error'

  try {
    const json = await res.json()
    if (isAlreadyRemovedError(json)) return 'already_removed'

    if (!res.ok) {
      console.error(`[x-cleanup] DeleteBookmark ${tweetId} HTTP ${res.status}:`, JSON.stringify(json).slice(0, 300))
      return 'error'
    }

    return 'ok'
  } catch {
    if (!res.ok) {
      console.error(`[x-cleanup] DeleteBookmark ${tweetId} HTTP ${res.status} (no JSON body)`)
      return 'error'
    }
    return 'ok'
  }
}

async function unlikeTweet(
  authToken: string,
  ct0: string,
  tweetId: string,
): Promise<MutationResult> {
  const res = await sendMutationRequest(
    `https://x.com/i/api/graphql/${UNLIKE_QUERY_ID}/UnfavoriteTweet`,
    {
      variables: { tweet_id: tweetId },
      queryId: UNLIKE_QUERY_ID,
    },
    authToken,
    ct0,
    `UnfavoriteTweet ${tweetId}`,
  )
  if (!res) return 'error'

  if (res.status === 429) return 'rate_limit'
  if (res.status === 401 || res.status === 403) return 'auth_error'

  try {
    const json = await res.json()
    if (isAlreadyRemovedError(json)) return 'already_removed'

    if (!res.ok) {
      console.error(`[x-cleanup] UnfavoriteTweet ${tweetId} HTTP ${res.status}:`, JSON.stringify(json).slice(0, 300))
      return 'error'
    }

    return 'ok'
  } catch {
    if (!res.ok) {
      console.error(`[x-cleanup] UnfavoriteTweet ${tweetId} HTTP ${res.status} (no JSON body)`)
      return 'error'
    }
    return 'ok'
  }
}

// ── Session health check ─────────────────────────────────────────────────────

export async function checkSession(
  authToken: string,
  ct0: string,
): Promise<{ valid: boolean; error?: string }> {
  try {
    // Use the viewer endpoint — lightweight and works with session cookies
    const res = await fetch('https://x.com/i/api/graphql/boP0x_MHAG1GhZ3svMKl3g/Viewer', {
      method: 'POST',
      headers: xHeaders(authToken, ct0),
      body: JSON.stringify({
        variables: { withCommunitiesMemberships: false },
        features: { responsive_web_graphql_exclude_directive_enabled: true },
        queryId: 'boP0x_MHAG1GhZ3svMKl3g',
      }),
    })
    if (res.status === 200) return { valid: true }
    if (res.status === 401 || res.status === 403) {
      return { valid: false, error: 'Session expired — re-save your credentials in Import > Live Import.' }
    }
    return { valid: false, error: `Unexpected response from X (${res.status})` }
  } catch {
    return { valid: false, error: 'Could not reach X — check your internet connection.' }
  }
}

// ── Cleanup job ──────────────────────────────────────────────────────────────

export async function startCleanup(
  authToken: string,
  ct0: string,
  source: CleanupSource,
  speed: CleanupSpeed = 'normal',
): Promise<void> {
  if (cleanupRunning) throw new Error('Cleanup already in progress')

  const where: Record<string, unknown> = { cleanedFromX: null }
  if (source !== 'all') where.source = source

  const items = await prisma.bookmark.findMany({
    where,
    select: { id: true, tweetId: true, source: true },
    orderBy: { importedAt: 'asc' },
  })

  const delayMs = SPEED_DELAY_MS[speed]

  cleanupRunning = true
  cleanupShouldStop = false
  status = { running: true, done: 0, total: items.length, failed: 0, speed, lastError: null }

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

      await sleep(delayMs)
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
