import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'

interface XTweet {
  id: string
  text: string
  created_at?: string
  author_id?: string
  attachments?: { media_keys?: string[] }
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
}

interface XBookmarksResponse {
  data?: XTweet[]
  includes?: { users?: XUser[]; media?: XMedia[] }
  meta?: { next_token?: string; result_count?: number }
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
  const body = await req.json().catch(() => ({})) as { maxPages?: number }
  const maxPages = Math.min(body.maxPages ?? 5, 20)

  const token = await getValidToken()
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated with X. Please connect your account first.' }, { status: 401 })
  }

  let imported = 0
  let skipped = 0
  let total = 0
  let nextToken: string | undefined

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      'tweet.fields': 'created_at,author_id,attachments',
      'expansions': 'author_id,attachments.media_keys',
      'user.fields': 'name,username',
      'media.fields': 'type,url,preview_image_url',
      'max_results': '100',
    })
    if (nextToken) params.set('pagination_token', nextToken)

    const res = await fetch(`https://api.x.com/2/users/me/bookmarks?${params}`, {
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
      const existing = await prisma.bookmark.findUnique({
        where: { tweetId: tweet.id },
        select: { id: true },
      })
      if (existing) { skipped++; continue }

      const author = tweet.author_id ? usersMap.get(tweet.author_id) : undefined

      const created = await prisma.bookmark.create({
        data: {
          tweetId: tweet.id,
          text: tweet.text,
          authorHandle: author?.username ?? 'unknown',
          authorName: author?.name ?? 'Unknown',
          tweetCreatedAt: tweet.created_at ? new Date(tweet.created_at) : null,
          rawJson: JSON.stringify(tweet),
          source: 'bookmark',
        },
      })

      // Import media
      const mediaKeys = tweet.attachments?.media_keys ?? []
      const mediaItems = mediaKeys
        .map((key) => mediaMap.get(key))
        .filter((m): m is XMedia => !!m)

      if (mediaItems.length > 0) {
        await prisma.mediaItem.createMany({
          data: mediaItems.map((m) => ({
            bookmarkId: created.id,
            type: m.type === 'animated_gif' ? 'gif' : m.type,
            url: m.url ?? m.preview_image_url ?? '',
            thumbnailUrl: m.preview_image_url ?? null,
          })),
        })
      }

      imported++
    }

    nextToken = data.meta?.next_token
    if (!nextToken) break
  }

  return NextResponse.json({ imported, skipped, total })
}
