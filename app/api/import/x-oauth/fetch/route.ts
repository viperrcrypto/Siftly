import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'

interface TweetData {
  id: string
  text: string
  created_at?: string
  author_id?: string
  attachments?: { media_keys?: string[] }
}

interface UserData {
  id: string
  name: string
  username: string
}

interface MediaData {
  media_key: string
  type: string
  url?: string
  preview_image_url?: string
}

async function refreshAccessToken(): Promise<string | null> {
  const [refreshToken, dbClientId, dbClientSecret] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'x_oauth_refresh_token' } }),
    prisma.setting.findUnique({ where: { key: 'x_oauth_client_id' } }),
    prisma.setting.findUnique({ where: { key: 'x_oauth_client_secret' } }),
  ])

  if (!refreshToken?.value) return null

  const clientId = dbClientId?.value || process.env.X_OAUTH_CLIENT_ID || ''
  const clientSecret = dbClientSecret?.value || process.env.X_OAUTH_CLIENT_SECRET || ''

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  }

  if (clientSecret) {
    headers['Authorization'] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
  }

  const res = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers,
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken.value,
      client_id: clientId,
    }),
  })

  if (!res.ok) return null

  const data = await res.json()

  // Store new tokens
  const toStore = [
    { key: 'x_oauth_access_token', value: data.access_token },
    ...(data.refresh_token ? [{ key: 'x_oauth_refresh_token', value: data.refresh_token }] : []),
    ...(data.expires_in ? [{ key: 'x_oauth_expires_at', value: String(Date.now() + data.expires_in * 1000) }] : []),
  ]

  await Promise.all(
    toStore.map(({ key, value }) =>
      prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      }),
    ),
  )

  return data.access_token
}

async function getAccessToken(): Promise<string | null> {
  const [tokenSetting, expiresAt] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'x_oauth_access_token' } }),
    prisma.setting.findUnique({ where: { key: 'x_oauth_expires_at' } }),
  ])

  if (!tokenSetting?.value) return null

  // Try refresh if expired
  if (expiresAt?.value && Date.now() > Number(expiresAt.value)) {
    const refreshed = await refreshAccessToken()
    if (refreshed) return refreshed
  }

  return tokenSetting.value
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const maxPages = Math.min(body.maxPages ?? 5, 20)

    const accessToken = await getAccessToken()
    if (!accessToken) {
      return NextResponse.json({ error: 'Not connected to X. Please authorize first.' }, { status: 401 })
    }

    // Fetch the authenticated user's ID
    const meRes = await fetch('https://api.x.com/2/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!meRes.ok) {
      const err = await meRes.json().catch(() => ({}))
      return NextResponse.json(
        { error: `Failed to get user info: ${err.detail || err.title || meRes.statusText}` },
        { status: meRes.status },
      )
    }
    const meData = await meRes.json()
    const userId = meData.data?.id

    if (!userId) {
      return NextResponse.json({ error: 'Could not determine user ID' }, { status: 500 })
    }

    // Paginate through bookmarks
    let paginationToken: string | undefined
    let totalFetched = 0
    let importedCount = 0
    let skippedCount = 0
    const allUsers = new Map<string, UserData>()
    const allMedia = new Map<string, MediaData>()

    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({
        'tweet.fields': 'created_at,author_id,attachments',
        'user.fields': 'name,username',
        'media.fields': 'type,url,preview_image_url',
        expansions: 'author_id,attachments.media_keys',
        max_results: '100',
      })
      if (paginationToken) params.set('pagination_token', paginationToken)

      const bmRes = await fetch(
        `https://api.x.com/2/users/${userId}/bookmarks?${params.toString()}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      )

      if (!bmRes.ok) {
        const err = await bmRes.json().catch(() => ({}))
        if (totalFetched === 0) {
          return NextResponse.json(
            { error: `X API error: ${err.detail || err.title || bmRes.statusText}` },
            { status: bmRes.status },
          )
        }
        break // Return partial results
      }

      const bmData = await bmRes.json()
      const tweets: TweetData[] = bmData.data ?? []

      if (tweets.length === 0) break

      // Index includes
      for (const u of (bmData.includes?.users ?? []) as UserData[]) {
        allUsers.set(u.id, u)
      }
      for (const m of (bmData.includes?.media ?? []) as MediaData[]) {
        allMedia.set(m.media_key, m)
      }

      // Import each tweet
      for (const tweet of tweets) {
        totalFetched++
        try {
          const existing = await prisma.bookmark.findUnique({
            where: { tweetId: tweet.id },
            select: { id: true },
          })

          if (existing) {
            skippedCount++
            continue
          }

          const author = tweet.author_id ? allUsers.get(tweet.author_id) : undefined

          const created = await prisma.bookmark.create({
            data: {
              tweetId: tweet.id,
              text: tweet.text,
              authorHandle: author?.username ?? null,
              authorName: author?.name ?? null,
              tweetCreatedAt: tweet.created_at ? new Date(tweet.created_at) : null,
              rawJson: JSON.stringify(tweet),
              source: 'bookmark',
            },
          })

          // Import media
          const mediaKeys = tweet.attachments?.media_keys ?? []
          const mediaItems = mediaKeys
            .map((mk) => allMedia.get(mk))
            .filter((m): m is MediaData => !!m)

          if (mediaItems.length > 0) {
            await prisma.mediaItem.createMany({
              data: mediaItems.map((m) => ({
                bookmarkId: created.id,
                type: m.type === 'photo' ? 'image' : m.type,
                url: m.url ?? m.preview_image_url ?? '',
                thumbnailUrl: m.preview_image_url ?? null,
              })),
            })
          }

          importedCount++
        } catch (err) {
          console.error(`Failed to import tweet ${tweet.id}:`, err)
          skippedCount++
        }
      }

      paginationToken = bmData.meta?.next_token
      if (!paginationToken) break
    }

    return NextResponse.json({
      imported: importedCount,
      skipped: skippedCount,
      total: totalFetched,
    })
  } catch (err) {
    console.error('X OAuth fetch error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Fetch failed' },
      { status: 500 },
    )
  }
}
