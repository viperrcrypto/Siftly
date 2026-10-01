import { NextRequest, NextResponse } from 'next/server'
import { isSafeHttpUrl, safeFetch } from '@/lib/archive/safe-fetch'
import { createLinkPreviewScreenshot } from '@/lib/link-preview-screenshot'

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=86400', // cache 24h
}
const ERROR_CACHE_HEADERS = { 'Cache-Control': 'no-store' }

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function youtubeVideoId(raw: string): string | null {
  try {
    const url = new URL(raw)
    const host = url.hostname.replace(/^www\./, '')
    let id = ''
    if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0] ?? ''
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      id = url.pathname === '/watch'
        ? url.searchParams.get('v') ?? ''
        : url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/)?.[1] ?? ''
    }
    return /^[\w-]{6,20}$/.test(id) ? id : null
  } catch { return null }
}

async function fetchYouTubePreview(finalUrl: string): Promise<{
  title: string; description: string; image: string; siteName: string; domain: string; url: string
} | null> {
  if (!youtubeVideoId(finalUrl)) return null
  try {
    const endpoint = new URL('https://www.youtube.com/oembed')
    endpoint.searchParams.set('url', finalUrl)
    endpoint.searchParams.set('format', 'json')
    const response = await safeFetch(endpoint.toString(), { maxBytes: 50_000, timeoutMs: 8_000, accept: 'application/json' })
    if (response.status !== 200) return null
    const data = JSON.parse(response.body.toString('utf8')) as { title?: string; author_name?: string; thumbnail_url?: string }
    if (!data.title) return null
    return {
      title: data.title,
      description: data.author_name ? `YouTube · ${data.author_name}` : 'YouTube',
      image: data.thumbnail_url ?? '',
      siteName: 'YouTube',
      domain: 'youtube.com',
      url: finalUrl,
    }
  } catch { return null }
}

/** For JS-rendered platforms that can't be scraped, derive a human-readable title */
function syntheticTitle(finalUrl: string, siteName: string): string {
  try {
    const { hostname, pathname } = new URL(finalUrl)
    const host = hostname.replace(/^www\./, '')

    // X / Twitter articles (x.com/i/article/...)
    if ((host === 'x.com' || host === 'twitter.com') && pathname.startsWith('/i/article')) {
      return 'Article on X'
    }
    // X/Twitter profile or status pages
    if (host === 'x.com' || host === 'twitter.com') {
      return 'View on X'
    }
    // Other platforms with a known site name but no scrape-able title
    if (siteName) return `Article on ${siteName}`
  } catch { /* ignore */ }
  return ''
}

function extractMeta(html: string, ...patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) return decodeHtmlEntities(match[1].trim())
  }
  return ''
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
}

function resolvePreviewImage(value: string, baseUrl: string): string {
  if (!value) return ''
  try {
    const resolved = new URL(value, baseUrl).toString()
    return isSafeHttpUrl(resolved) ? resolved : ''
  } catch { return '' }
}

/** Try to fetch rich data from Twitter's syndication API (articles, cards, etc.) */
async function fetchXArticlePreview(tweetId: string): Promise<{
  title: string; description: string; image: string; siteName: string; domain: string; url: string
} | null> {
  try {
    const res = await fetch(
      `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&token=x`,
      { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(8000) },
    )
    if (!res.ok) return null
    const data = await res.json() as {
      article?: {
        rest_id?: string
        title?: string
        preview_text?: string
        cover_media?: { media_info?: { original_img_url?: string } }
      }
      card?: {
        name?: string
        binding_values?: Record<string, { string_value?: string; image_value?: { url?: string } }>
      }
      user?: { name?: string; screen_name?: string; profile_image_url_https?: string }
    }

    // X Article (native long-form posts)
    if (data.article?.title) {
      const articleId = data.article.rest_id || tweetId
      return {
        title: data.article.title,
        description: data.article.preview_text || '',
        image: data.article.cover_media?.media_info?.original_img_url || '',
        siteName: data.user?.name || 'X',
        domain: 'x.com',
        url: `https://x.com/i/article/${articleId}`,
      }
    }

    // Twitter Card (link previews embedded in tweets)
    if (data.card?.binding_values) {
      const bv = data.card.binding_values
      const cardTitle = bv.title?.string_value
      if (cardTitle) {
        return {
          title: cardTitle,
          description: bv.description?.string_value || '',
          image: bv.thumbnail_image_original?.image_value?.url
            || bv.thumbnail_image?.image_value?.url
            || bv.summary_photo_image_original?.image_value?.url
            || bv.summary_photo_image?.image_value?.url
            || '',
          siteName: bv.vanity_url?.string_value || data.user?.name || 'X',
          domain: bv.domain?.string_value || 'x.com',
          url: bv.card_url?.string_value || bv.url?.string_value || `https://x.com/i/status/${tweetId}`,
        }
      }
    }

    return null
  } catch {
    return null
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = request.nextUrl.searchParams.get('url')
  if (!url) {
    return NextResponse.json({ error: 'url required' }, { status: 400 })
  }

  if (!isSafeHttpUrl(url)) {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  // Also accept an optional tweetId param for X article enrichment
  const rawTweetId = request.nextUrl.searchParams.get('tweetId')
  const tweetId = rawTweetId && /^\d+$/.test(rawTweetId) ? rawTweetId : null
  const screenshot = request.nextUrl.searchParams.get('screenshot') === '1'

  try {
    const res = await safeFetch(url, { maxBytes: 50_000, timeoutMs: 10_000, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', truncate: true })

    if (res.status < 200 || res.status >= 300) {
      return NextResponse.json({ error: `HTTP ${res.status}` }, { status: 502 })
    }

    // SSRF: re-check the final URL after redirects to prevent open-redirect chaining into private networks
    if (!isSafeHttpUrl(res.url)) {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }

    const html = res.body.toString('utf8')

    let finalUrl = res.url

    // t.co with a browser UA returns a 200 JS-redirect page; the destination URL
    // appears in the <title> tag.  Detect this and use the real destination URL.
    const titleTagMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const titleTagText = titleTagMatch?.[1]?.trim() ?? ''
    if (
      titleTagText.match(/^https?:\/\//) &&
      (() => { try { return new URL(finalUrl).hostname.includes('t.co') } catch { return false } })()
    ) {
      finalUrl = titleTagText
    }

    const domain = (() => {
      try { return new URL(finalUrl).hostname.replace(/^www\./, '') } catch { return '' }
    })()

    const isXDomain = domain === 'x.com' || domain === 'twitter.com'

    // X article pages (and many X URLs) are JS-rendered — OG scraping returns
    // nothing useful. Try the syndication API first for any X URL when we have a tweetId.
    if (isXDomain && tweetId) {
      const articleData = await fetchXArticlePreview(tweetId)
      if (articleData) {
        return NextResponse.json(articleData, { headers: CACHE_HEADERS })
      }
    }

    const title = extractMeta(
      html,
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
      /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
    )

    const description = extractMeta(
      html,
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
    )

    const image = extractMeta(
      html,
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
    )

    const siteName = extractMeta(
      html,
      /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i,
    )

    // If OG scrape returned poor results for an X URL, try syndication as fallback
    if (isXDomain && tweetId && !image && (!title || /^(Article on X|View on X|post \/ X|X)$/i.test(title))) {
      const articleData = await fetchXArticlePreview(tweetId)
      if (articleData) {
        return NextResponse.json(articleData, { headers: CACHE_HEADERS })
      }
    }

    const documentTitle = /^https?:\/\//i.test(titleTagText) ? '' : decodeHtmlEntities(titleTagText)
    const resolvedTitle = title || documentTitle || syntheticTitle(finalUrl, siteName) || domain

    if (!screenshot && !image) {
      const youtube = await fetchYouTubePreview(finalUrl)
      if (youtube) return NextResponse.json(youtube, { headers: CACHE_HEADERS })
    }

    if (screenshot) {
      const png = await createLinkPreviewScreenshot({
        url: finalUrl,
        html,
        title: resolvedTitle,
        description,
        siteName,
      })
      return new NextResponse(new Uint8Array(png), {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' },
      })
    }

    const previewImage = resolvePreviewImage(image, finalUrl) || (!isXDomain
      ? `/api/link-preview?${new URLSearchParams({ url: finalUrl, screenshot: '1' })}`
      : '')

    return NextResponse.json(
      { title: resolvedTitle, description, image: previewImage, siteName, domain, url: finalUrl },
      { headers: CACHE_HEADERS },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'preview failed'
    return NextResponse.json({ error: msg }, { status: 502, headers: ERROR_CACHE_HEADERS })
  }
}
