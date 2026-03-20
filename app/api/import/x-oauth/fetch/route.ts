import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'

interface XMedia {
  media_key: string
  type: string
  url?: string
  preview_image_url?: string
  variants?: Array<{ content_type?: string; bit_rate?: number; url: string }>
}

interface XUser { id: string; username: string; name: string }

interface XTweet {
  id: string
  text: string
  author_id?: string
  created_at?: string
  attachments?: { media_keys?: string[] }
}

function bestVideoUrl(variants: NonNullable<XMedia['variants']>): string | null {
  return variants
    .filter((v) => v.content_type === 'video/mp4' && v.url)
    .sort((a, b) => (b.bit_rate ?? 0) - (a.bit_rate ?? 0))[0]?.url ?? null
}

function extractMedia(tweet: XTweet, mediaMap: Map<string, XMedia>) {
  return (tweet.attachments?.media_keys ?? [])
    .map((key) => {
      const m = mediaMap.get(key)
      if (!m) return null
      if (m.type === 'photo') {
        const url = m.url ?? m.preview_image_url ?? ''
        return url ? { type: 'photo', url, thumbnailUrl: url } : null
      }
      if (m.type === 'video' || m.type === 'animated_gif') {
        const url = m.variants ? (bestVideoUrl(m.variants) ?? m.preview_image_url ?? '') : (m.preview_image_url ?? '')
        return url ? { type: m.type === 'animated_gif' ? 'gif' : 'video', url, thumbnailUrl: m.preview_image_url ?? url } : null
      }
      return null
    })
    .filter(Boolean) as { type: string; url: string; thumbnailUrl: string }[]
}

async function tryRefreshToken(
  refreshToken: string,
  clientId: string,
  clientSecret?: string,
): Promise<string | null> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  })
  const authHeader = clientSecret
    ? 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    : undefined
  const res = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body,
  })
  if (!res.ok) return null
  const data = await res.json()
  if (!data.access_token) return null

  const expiresAt = data.expires_in
    ? String(Date.now() + data.expires_in * 1000)
    : String(Date.now() + 7200 * 1000)

  await Promise.all([
    prisma.setting.upsert({ where: { key: 'x_oauth_access_token' }, update: { value: data.access_token }, create: { key: 'x_oauth_access_token', value: data.access_token } }),
    prisma.setting.upsert({ where: { key: 'x_oauth_token_expires_at' }, update: { value: expiresAt }, create: { key: 'x_oauth_token_expires_at', value: expiresAt } }),
    data.refresh_token && prisma.setting.upsert({ where: { key: 'x_oauth_refresh_token' }, update: { value: data.refresh_token }, create: { key: 'x_oauth_refresh_token', value: data.refresh_token } }),
  ].filter(Boolean))

  return data.access_token
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let maxPages = 10
  try {
    const body = await request.json()
    if (typeof body.maxPages === 'number') maxPages = Math.min(body.maxPages, 50)
  } catch { /* use default */ }

  try {
    const [accessTokenS, refreshTokenS, userIdS, clientIdS, clientSecretS, expiresAtS] = await Promise.all([
      prisma.setting.findUnique({ where: { key: 'x_oauth_access_token' } }),
      prisma.setting.findUnique({ where: { key: 'x_oauth_refresh_token' } }),
      prisma.setting.findUnique({ where: { key: 'x_oauth_user_id' } }),
      prisma.setting.findUnique({ where: { key: 'x_oauth_client_id' } }),
      prisma.setting.findUnique({ where: { key: 'x_oauth_client_secret' } }),
      prisma.setting.findUnique({ where: { key: 'x_oauth_token_expires_at' } }),
    ])

    if (!accessTokenS?.value || !userIdS?.value) {
      return NextResponse.json({ error: 'Not connected to X. Please authenticate first.' }, { status: 401 })
    }

    let accessToken = accessTokenS.value
    const userId = userIdS.value

    // Auto-refresh if expired
    if (expiresAtS?.value && Date.now() > parseInt(expiresAtS.value)) {
      if (refreshTokenS?.value && clientIdS?.value) {
        const newToken = await tryRefreshToken(refreshTokenS.value, clientIdS.value, clientSecretS?.value)
        if (newToken) {
          accessToken = newToken
        } else {
          return NextResponse.json(
            { error: 'Token expired and refresh failed. Please reconnect your X account.' },
            { status: 401 },
          )
        }
      }
    }

    let imported = 0, skipped = 0, total = 0
    let nextToken: string | undefined

    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({
        max_results: '100',
        expansions: 'author_id,attachments.media_keys',
        'tweet.fields': 'created_at,text,attachments,entities',
        'user.fields': 'username,name',
        'media.fields': 'url,type,variants,preview_image_url',
        ...(nextToken ? { pagination_token: nextToken } : {}),
      })

      const res = await fetch(`https://api.twitter.com/2/users/${userId}/bookmarks?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!res.ok) {
        const errText = await res.text()
        return NextResponse.json(
          { error: `X API ${res.status}: ${errText.slice(0, 200)}`, imported, skipped, total },
          { status: 502 },
        )
      }

      const data = await res.json()
      if (!data.data?.length) break
      total += data.data.length

      const userMap = new Map<string, XUser>((data.includes?.users ?? []).map((u: XUser) => [u.id, u]))
      const mediaMap = new Map<string, XMedia>((data.includes?.media ?? []).map((m: XMedia) => [m.media_key, m]))

      for (const tweet of data.data as XTweet[]) {
        const exists = await prisma.bookmark.findUnique({ where: { tweetId: tweet.id }, select: { id: true } })
        if (exists) { skipped++; continue }

        const author = tweet.author_id ? userMap.get(tweet.author_id) : undefined
        const media = extractMedia(tweet, mediaMap)

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

        if (media.length > 0) {
          await prisma.mediaItem.createMany({
            data: media.map((m) => ({
              bookmarkId: created.id,
              type: m.type,
              url: m.url,
              thumbnailUrl: m.thumbnailUrl ?? null,
            })),
          })
        }
        imported++
      }

      nextToken = data.meta?.next_token
      if (!nextToken) break
    }

    return NextResponse.json({ imported, skipped, total })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Fetch failed' },
      { status: 500 },
    )
  }
}
