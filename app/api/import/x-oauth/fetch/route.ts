import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { enqueueIncompleteArchives, ensureArchiveRecord } from '@/lib/archive/pipeline'
import { createImportedBookmark, importedMediaData } from '@/lib/media-import'
import { getXArticle, getXArticleMedia, getXArticleText } from '@/lib/x-article'
import { urlCandidatesFrom } from '@/lib/archive/url-candidates'

interface XTweet {
  id: string
  text: string
  created_at?: string
  author_id?: string
  attachments?: { media_keys?: string[] }
  entities?: { urls?: Array<{ url?: string; expanded_url?: string; unwound_url?: string }> }
  note_tweet?: { text?: string; entities?: { urls?: Array<{ url?: string; expanded_url?: string; unwound_url?: string }> } }
  article?: {
    title?: string
    plain_text?: string
    preview_text?: string
    cover_media?: string
    media_entities?: string[]
    entities?: { urls?: Array<{ text?: string }> }
  }
  referenced_tweets?: Array<{ type: 'replied_to' | 'quoted' | 'retweeted'; id: string }>
  conversation_id?: string
  in_reply_to_user_id?: string
}

function tweetFullText(tweet: XTweet): string {
  if (tweet.note_tweet?.text) return tweet.note_tweet.text
  const articleText = getXArticleText(tweet)
  if (articleText.text) return articleText.text
  return tweet.text
}

function mergeArticleRaw(rawJson: string | null | undefined, tweet: XTweet): string {
  if (!rawJson) return JSON.stringify(tweet)
  try {
    const existing = JSON.parse(rawJson) as unknown
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return JSON.stringify(tweet)
    return JSON.stringify({ ...existing, article: tweet.article })
  } catch {
    return JSON.stringify(tweet)
  }
}

interface XUser {
  id: string
  name: string
  username: string
}

interface XMedia {
  media_key: string
  type: 'photo' | 'video' | 'animated_gif'
  url?: string
  preview_image_url?: string
  variants?: Array<{ content_type?: string; bit_rate?: number; url?: string }>
}

interface XBookmarksResponse {
  data?: XTweet[]
  includes?: { users?: XUser[]; media?: XMedia[] }
  meta?: { next_token?: string; result_count?: number }
}

interface ThreadRoot {
  bookmarkId: string
  tweet: XTweet
  authorHandle?: string
}

const ARTICLE_URL = /(?:x|twitter)\.com\/i\/article\//i
const X_TWEET_FIELDS = 'created_at,author_id,attachments,entities,note_tweet,article,referenced_tweets,conversation_id,in_reply_to_user_id'
const X_EXPANSIONS = 'author_id,attachments.media_keys,article.cover_media,article.media_entities'

function hasCompleteArticleBody(rawJson: string): boolean {
  try { return Boolean(getXArticleText(JSON.parse(rawJson)).body) } catch { return false }
}

function mergeHydrationResult(resultJson: string | null | undefined, hydration: Record<string, unknown>): string {
  try {
    const result = JSON.parse(resultJson || '{}')
    if (result && typeof result === 'object' && !Array.isArray(result)) return JSON.stringify({ ...result, xArticleHydration: hydration })
  } catch { /* replace malformed historical result data */ }
  return JSON.stringify({ xArticleHydration: hydration })
}

function threadTweet(tweet: XTweet, authorHandle?: string) {
  const text = tweetFullText(tweet)
  return {
    id: tweet.id,
    authorId: tweet.author_id,
    authorHandle,
    conversationId: tweet.conversation_id,
    inReplyToId: tweet.referenced_tweets?.find((reference) => reference.type === 'replied_to')?.id,
    text,
    urls: urlCandidatesFrom(tweet, text),
    media: [],
    raw: tweet,
  }
}

function selfThread(root: ThreadRoot, replies: XTweet[], users: Map<string, XUser>) {
  const rootAuthor = root.tweet.author_id
  const conversationId = root.tweet.conversation_id ?? root.tweet.id
  const all = [root.tweet, ...replies].filter((tweet, index, rows) => rows.findIndex((item) => item.id === tweet.id) === index)
  const byId = new Map(all.map((tweet) => [tweet.id, tweet]))
  const accepted = new Set([root.tweet.id])
  let changed = true
  while (changed) {
    changed = false
    for (const tweet of all) {
      const parent = tweet.referenced_tweets?.find((reference) => reference.type === 'replied_to')?.id
      if (tweet.id !== root.tweet.id && tweet.author_id === rootAuthor && (tweet.conversation_id ?? root.tweet.id) === conversationId && parent && accepted.has(parent) && !accepted.has(tweet.id)) {
        accepted.add(tweet.id)
        changed = true
      }
    }
  }
  return [...accepted]
    .map((id) => byId.get(id))
    .filter((tweet): tweet is XTweet => !!tweet)
    .sort((left, right) => String(left.created_at ?? '').localeCompare(String(right.created_at ?? '')))
    .map((tweet) => threadTweet(tweet, tweet.author_id ? users.get(tweet.author_id)?.username : root.authorHandle))
}

async function hydrateOAuthThreads(roots: ThreadRoot[], token: string): Promise<{ imported: number; partial: number }> {
  const eligible = roots.filter((root) => root.tweet.conversation_id && root.tweet.author_id)
  let imported = 0
  let partial = 0
  // X Recent Search is bounded to recent posts; keep the request count bounded as well.
  for (let start = 0; start < eligible.length; start += 10) {
    const batch = eligible.slice(start, start + 10)
    const query = batch.map((root) => `conversation_id:${root.tweet.conversation_id}`).join(' OR ')
    const params = new URLSearchParams({
      query,
      'tweet.fields': 'created_at,author_id,entities,note_tweet,referenced_tweets,conversation_id',
      expansions: 'author_id',
      'user.fields': 'name,username',
      max_results: '100',
    })
    const replies: XTweet[] = []
    const users = new Map<string, XUser>()
    let tokenCursor: string | undefined
    let failed = false
    const seen = new Set<string>()
    for (let page = 0; page < 5; page++) {
      if (tokenCursor) params.set('next_token', tokenCursor)
      try {
        const response = await fetch(`https://api.x.com/2/tweets/search/recent?${params}`, { headers: { Authorization: `Bearer ${token}` } })
        if (!response.ok) { failed = true; break }
        const data = await response.json() as XBookmarksResponse
        replies.push(...(data.data ?? []))
        for (const user of data.includes?.users ?? []) users.set(user.id, user)
        const next = data.meta?.next_token
        if (!next || seen.has(next)) break
        seen.add(next)
        tokenCursor = next
      } catch { failed = true; break }
    }
    for (const root of batch) {
      const tweets = selfThread(root, replies.filter((tweet) => tweet.conversation_id === root.tweet.conversation_id), users)
      const archive = await prisma.archiveRecord.findUnique({ where: { bookmarkId: root.bookmarkId }, select: { resultJson: true } })
      let existing: Record<string, unknown> = {}
      try { existing = JSON.parse(archive?.resultJson ?? '{}') as Record<string, unknown> } catch { /* replace malformed historical result */ }
      const previousThread = existing.thread as { source?: string; status?: string } | undefined
      if (previousThread?.source && previousThread.source !== 'x-oauth' && previousThread.status === 'success') continue
      const threadStatus = failed ? 'partial' : 'success'
      if (failed) partial++
      else imported++
      await prisma.archiveRecord.update({
        where: { bookmarkId: root.bookmarkId },
        data: { resultJson: JSON.stringify({ ...existing, thread: { source: 'x-oauth', retrieval: 'recent-search', status: threadStatus, retryable: true, ...(failed ? { error: 'X Recent Search failed' } : {}), tweets, quotes: [] } }) },
      })
    }
  }
  return { imported, partial }
}

async function getValidToken(): Promise<string | null> {
  const accessToken = await prisma.setting.findUnique({ where: { key: 'x_oauth_access_token' } })
  const tokenExpiry = await prisma.setting.findUnique({ where: { key: 'x_oauth_token_expiry' } })

  if (!accessToken?.value) return null

  // Check if token is expired and try to refresh
  if (tokenExpiry?.value && Date.now() > Number(tokenExpiry.value)) {
    const refreshToken = await prisma.setting.findUnique({ where: { key: 'x_oauth_refresh_token' } })
    if (!refreshToken?.value) return null

    const clientId = await prisma.setting.findUnique({ where: { key: 'x_oauth_client_id' } })
    const clientSecret = await prisma.setting.findUnique({ where: { key: 'x_oauth_client_secret' } })
    if (!clientId?.value) return null

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken.value,
      client_id: clientId.value,
    })

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    }
    if (clientSecret?.value) {
      headers['Authorization'] = `Basic ${Buffer.from(`${clientId.value}:${clientSecret.value}`).toString('base64')}`
    }

    const res = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers,
      body,
    })

    if (!res.ok) return null

    const tokens = await res.json() as {
      access_token: string
      refresh_token?: string
      expires_in: number
    }

    const expiry = String(Date.now() + tokens.expires_in * 1000)
    await prisma.setting.upsert({ where: { key: 'x_oauth_access_token' }, create: { key: 'x_oauth_access_token', value: tokens.access_token }, update: { value: tokens.access_token } })
    await prisma.setting.upsert({ where: { key: 'x_oauth_token_expiry' }, create: { key: 'x_oauth_token_expiry', value: expiry }, update: { value: expiry } })
    if (tokens.refresh_token) {
      await prisma.setting.upsert({ where: { key: 'x_oauth_refresh_token' }, create: { key: 'x_oauth_refresh_token', value: tokens.refresh_token }, update: { value: tokens.refresh_token } })
    }

    return tokens.access_token
  }

  return accessToken.value
}

export async function POST(req: NextRequest) {
  const parsed: unknown = await req.json().catch(() => ({}))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return NextResponse.json({ error: 'JSON body must be an object' }, { status: 400 })
  }
  const body = parsed as { maxPages?: number; nextToken?: string; repairArticles?: unknown; includeThreads?: unknown }
  if (body.repairArticles !== undefined && body.repairArticles !== true && body.repairArticles !== false) {
    return NextResponse.json({ error: 'repairArticles must be a boolean' }, { status: 400 })
  }
  if (body.includeThreads !== undefined && body.includeThreads !== true && body.includeThreads !== false) {
    return NextResponse.json({ error: 'includeThreads must be a boolean' }, { status: 400 })
  }
  if (body.repairArticles === true) return repairArticles()
  const maxPages = Math.min(Math.max(1, Number.isInteger(body.maxPages) ? body.maxPages! : 10), 10)
  if (body.nextToken !== undefined && (typeof body.nextToken !== 'string' || !body.nextToken.trim())) {
    return NextResponse.json({ error: 'Invalid nextToken' }, { status: 400 })
  }

  const token = await getValidToken()
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated with X. Please connect your account first.' }, { status: 401 })
  }
  const userId = await prisma.setting.findUnique({ where: { key: 'x_oauth_user_id' } })
  if (!userId?.value) {
    return NextResponse.json({ error: 'X user ID is missing. Please reconnect your X account.' }, { status: 401 })
  }

  let imported = 0
  let skipped = 0
  let total = 0
  const archiveIds: string[] = []
  let nextToken = body.nextToken?.trim() || undefined
  const seenTokens = new Set(nextToken ? [nextToken] : [])
  let truncated = false
  let deferred = 0
  const threadRoots: ThreadRoot[] = []

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      'tweet.fields': X_TWEET_FIELDS,
      'expansions': X_EXPANSIONS,
      'user.fields': 'name,username',
      'media.fields': 'type,url,preview_image_url,variants',
      'max_results': '100',
    })
    if (nextToken) params.set('pagination_token', nextToken)

    const res = await fetch(`https://api.x.com/2/users/${encodeURIComponent(userId.value)}/bookmarks?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('X API bookmarks error:', res.status, errText)
      if (total === 0) {
        return NextResponse.json({ error: `X API error: ${res.status}` }, { status: 502 })
      }
      break
    }

    const data = (await res.json()) as XBookmarksResponse
    if (!data.data?.length) break

    const usersMap = new Map<string, XUser>()
    for (const u of data.includes?.users ?? []) usersMap.set(u.id, u)

    const mediaMap = new Map<string, XMedia>()
    for (const m of data.includes?.media ?? []) mediaMap.set(m.media_key, m)

    for (const tweet of data.data) {
      total++
      const author = tweet.author_id ? usersMap.get(tweet.author_id) : undefined
      const threadRoot = { tweet, authorHandle: author?.username }
      const articleMedia = getXArticleMedia(tweet)
      const mediaKeys = [...new Set([
        ...(tweet.attachments?.media_keys ?? []),
        ...articleMedia.map((media) => media.mediaKey).filter((key): key is string => !!key),
      ])]
      const mediaItems = mediaKeys
        .map((key) => {
          const media = mediaMap.get(key)
          if (!media) return undefined
          if (media.type !== 'video' && media.type !== 'animated_gif') return media
          const url = media.variants?.filter((variant) => variant.content_type === 'video/mp4' && variant.url).sort((a, b) => (b.bit_rate ?? 0) - (a.bit_rate ?? 0))[0]?.url
          return url ? { ...media, url } : undefined
        })
        .filter((m): m is XMedia => !!m)
      const directArticleMedia = articleMedia
        .filter((media) => media.url)
        .map((media, index): XMedia => ({
          media_key: media.mediaKey ?? `article-${tweet.id}-${index}`,
          type: 'photo',
          url: media.url,
          preview_image_url: media.thumbnailUrl ?? media.url,
        }))
      const allMediaItems = [...mediaItems, ...directArticleMedia]
      const importedMedia = allMediaItems.map((m, sourceMediaIndex) => ({
        type: m.type === 'animated_gif' ? 'gif' : m.type,
        url: m.url,
        thumbnailUrl: m.preview_image_url ?? null,
        mediaKey: m.media_key,
        sourceTweetId: tweet.id,
        sourceTweetUrl: `https://x.com/${author?.username ?? 'i'}/status/${tweet.id}`,
        sourceMediaIndex,
        sourceAuthorId: tweet.author_id,
        sourceAuthorHandle: author?.username,
      }))

      const existing = await prisma.bookmark.findUnique({
        where: { tweetId: tweet.id },
        select: { id: true, text: true, rawJson: true, deletedAt: true },
      })
      if (existing) {
        threadRoots.push({ bookmarkId: existing.id, ...threadRoot })
        if (existing.deletedAt) await prisma.bookmark.update({ where: { id: existing.id }, data: { deletedAt: null } })
        await ensureArchiveRecord(existing.id)
        const articleText = getXArticleText(tweet)
        const preserveExistingText = !!(getXArticle(tweet) && !articleText.body &&
          existing.text.trim() && existing.text.trim() !== tweet.text.trim())
        const text = preserveExistingText ? existing.text : tweetFullText(tweet)
        let refreshDeferred = false
        if (getXArticle(tweet)) {
          refreshDeferred = await prisma.$transaction(async (tx) => {
            const archive = await tx.archiveRecord.findUnique({
              where: { bookmarkId: existing.id },
              select: { status: true, lastError: true, startedAt: true, finishedAt: true },
            })
            if (!archive || archive.status === 'processing') return true
            const claim = await tx.archiveRecord.updateMany({
              where: { bookmarkId: existing.id, status: archive.status },
              data: { status: 'processing', startedAt: new Date(), finishedAt: null, lastError: null },
            })
            if (claim.count !== 1) return true
            const existingMedia = await tx.mediaItem.findMany({
              where: { bookmarkId: existing.id },
              select: { url: true, mediaKey: true },
            })
            const urls = new Set(existingMedia.map((item) => item.url))
            const mediaKeys = new Set(existingMedia.map((item) => item.mediaKey).filter(Boolean))
            const missingMedia = importedMediaData(existing.id, importedMedia).filter(
              (item) => !urls.has(item.url) && !(item.mediaKey && mediaKeys.has(item.mediaKey)),
            )
            const rawJson = mergeArticleRaw(existing.rawJson, tweet)
            await tx.bookmark.update({
              where: { id: existing.id },
              data: { text, rawJson },
            })
            if (missingMedia.length) await tx.mediaItem.createMany({ data: missingMedia })
            const changed = text !== existing.text || rawJson !== existing.rawJson || missingMedia.length > 0
            await tx.archiveRecord.update({
              where: { bookmarkId: existing.id },
              data: changed
                ? { status: 'pending', lastError: null, startedAt: null, finishedAt: null }
                : { status: archive.status, lastError: archive.lastError, startedAt: archive.startedAt, finishedAt: archive.finishedAt },
            })
            return false
          })
        }
        if (refreshDeferred) deferred++
        else archiveIds.push(existing.id)
        skipped++
        continue
      }

      const created = await createImportedBookmark(
        prisma,
        {
          tweetId: tweet.id,
          text: tweetFullText(tweet),
          authorHandle: author?.username ?? 'unknown',
          authorName: author?.name ?? 'Unknown',
          tweetCreatedAt: tweet.created_at ? new Date(tweet.created_at) : null,
          rawJson: JSON.stringify(tweet),
          source: 'bookmark',
          archive: { create: {} },
        },
        importedMedia,
      )

      imported++
      archiveIds.push(created.id)
      threadRoots.push({ bookmarkId: created.id, ...threadRoot })
    }

    const pageToken = data.meta?.next_token
    if (!pageToken || seenTokens.has(pageToken)) { nextToken = undefined; break }
    nextToken = pageToken
    if (page === maxPages - 1) { truncated = true; break }
    seenTokens.add(nextToken)
  }

  const threads = body.includeThreads === true ? await hydrateOAuthThreads(threadRoots, token) : { imported: 0, partial: 0 }
  await enqueueIncompleteArchives(archiveIds)
  return NextResponse.json({ imported, skipped, total, ...(threads.imported ? { threadsImported: threads.imported } : {}), ...(threads.partial ? { threadsPartial: threads.partial } : {}), ...(deferred ? { deferred } : {}), ...(truncated ? { truncated: true, nextToken } : {}) })
}

async function repairArticles(): Promise<NextResponse> {
  const token = await getValidToken()
  if (!token) return NextResponse.json({ error: 'Not authenticated with X. Please connect your account first.' }, { status: 401 })

  const candidates = (await prisma.bookmark.findMany({
    where: {
      deletedAt: null,
      OR: [
        { text: { contains: 'x.com/i/article/' } }, { text: { contains: 'twitter.com/i/article/' } },
        { rawJson: { contains: 'x.com/i/article/' } }, { rawJson: { contains: 'twitter.com/i/article/' } },
      ],
    },
    select: { id: true, tweetId: true, text: true, rawJson: true },
  })).filter((bookmark) => /^\d+$/.test(bookmark.tweetId) && ARTICLE_URL.test(`${bookmark.text}\n${bookmark.rawJson}`) && !hasCompleteArticleBody(bookmark.rawJson)).slice(0, 500)

  if (candidates.length === 0) return NextResponse.json({ total: 0, repaired: 0, failed: 0 })
  await Promise.all(candidates.map((bookmark) => ensureArchiveRecord(bookmark.id)))
  const archiveIds: string[] = []
  let repaired = 0
  let failed = 0

  const markFailure = async (bookmark: typeof candidates[number], error: string): Promise<void> => {
    failed++
    await prisma.$transaction(async (tx) => {
      const archive = await tx.archiveRecord.findUnique({ where: { bookmarkId: bookmark.id }, select: { status: true, resultJson: true } })
      if (!archive) return
      await tx.archiveRecord.update({
        where: { bookmarkId: bookmark.id },
        data: {
          lastError: `X Article hydration: ${error}`.slice(0, 1000),
          resultJson: mergeHydrationResult(archive.resultJson, { status: 'failed', retryable: true, error }),
        },
      })
    })
  }

  for (let start = 0; start < candidates.length; start += 100) {
    const chunk = candidates.slice(start, start + 100)
    const params = new URLSearchParams({
      ids: chunk.map((bookmark) => bookmark.tweetId).join(','),
      'tweet.fields': X_TWEET_FIELDS,
      'expansions': X_EXPANSIONS,
      'user.fields': 'name,username',
      'media.fields': 'type,url,preview_image_url,variants',
    })
    let data: XBookmarksResponse
    try {
      const response = await fetch(`https://api.x.com/2/tweets?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) throw new Error(`X API error: ${response.status}`)
      data = await response.json() as XBookmarksResponse
    } catch (error) {
      const message = error instanceof Error ? error.message : 'X API request failed'
      await Promise.all(chunk.map((bookmark) => markFailure(bookmark, message)))
      continue
    }

    const tweets = new Map((data.data ?? []).map((tweet) => [tweet.id, tweet]))
    const mediaByKey = new Map((data.includes?.media ?? []).map((media) => [media.media_key, media]))
    const usersById = new Map((data.includes?.users ?? []).map((user) => [user.id, user]))
    for (const bookmark of chunk) {
      const tweet = tweets.get(bookmark.tweetId)
      if (!tweet) { await markFailure(bookmark, 'Tweet was not returned by X'); continue }
      const article = getXArticleText(tweet)
      if (!article.body) { await markFailure(bookmark, 'X returned only an article preview'); continue }

      const author = tweet.author_id ? usersById.get(tweet.author_id) : undefined
      const media = getXArticleMedia(tweet).flatMap((reference, index) => {
        const item = reference.mediaKey ? mediaByKey.get(reference.mediaKey) : undefined
        const url = reference.url ?? item?.url ?? item?.preview_image_url
        if (!url) return []
        return [{
          type: item?.type === 'animated_gif' ? 'gif' : item?.type ?? 'photo', url,
          thumbnailUrl: reference.thumbnailUrl ?? item?.preview_image_url ?? null,
          mediaKey: reference.mediaKey ?? item?.media_key ?? `article-${tweet.id}-${index}`,
          sourceTweetId: tweet.id, sourceTweetUrl: `https://x.com/${author?.username ?? 'i'}/status/${tweet.id}`,
          sourceMediaIndex: index, sourceAuthorId: tweet.author_id, sourceAuthorHandle: author?.username,
        }]
      })
      let outcome: { success: boolean; changed: boolean }
      try {
        outcome = await prisma.$transaction(async (tx) => {
        const archive = await tx.archiveRecord.findUnique({
          where: { bookmarkId: bookmark.id },
          select: { status: true, resultJson: true },
        })
        if (!archive || archive.status === 'processing') return { success: false, changed: false }
        const claim = await tx.archiveRecord.updateMany({
          where: { bookmarkId: bookmark.id, status: archive.status },
          data: { status: 'processing', startedAt: new Date(), finishedAt: null, lastError: null },
        })
        if (claim.count !== 1) return { success: false, changed: false }
        const existingMedia = await tx.mediaItem.findMany({ where: { bookmarkId: bookmark.id }, select: { url: true, mediaKey: true } })
        const urls = new Set(existingMedia.map((item) => item.url))
        const mediaKeys = new Set(existingMedia.map((item) => item.mediaKey).filter(Boolean))
        const missing = importedMediaData(bookmark.id, media).filter((item) => !urls.has(item.url) && !(item.mediaKey && mediaKeys.has(item.mediaKey)))
        const text = article.text
        const rawJson = mergeArticleRaw(bookmark.rawJson, tweet)
        await tx.bookmark.update({ where: { id: bookmark.id }, data: { text, rawJson } })
        if (missing.length) await tx.mediaItem.createMany({ data: missing })
        const changed = text !== bookmark.text || rawJson !== bookmark.rawJson || missing.length > 0
        await tx.archiveRecord.update({
          where: { bookmarkId: bookmark.id },
          data: {
            ...(changed ? { status: 'pending', startedAt: null, finishedAt: null } : { status: archive.status }),
            lastError: null,
            resultJson: mergeHydrationResult(archive.resultJson, { status: 'success', repairedAt: new Date().toISOString() }),
          },
        })
          return { success: true, changed }
        })
      } catch (error) {
        await markFailure(bookmark, error instanceof Error ? error.message : 'X Article hydration transaction failed')
        continue
      }
      if (outcome.success) {
        repaired++
        if (outcome.changed) archiveIds.push(bookmark.id)
      } else await markFailure(bookmark, 'Archive record is currently being processed')
    }
  }
  await enqueueIncompleteArchives(archiveIds)
  return NextResponse.json({ total: candidates.length, repaired, failed })
}
