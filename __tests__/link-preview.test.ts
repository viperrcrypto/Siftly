import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ safeFetch: vi.fn(), screenshot: vi.fn() }))

vi.mock('@/lib/archive/safe-fetch', async (original) => ({
  ...(await original<typeof import('@/lib/archive/safe-fetch')>()),
  safeFetch: mocks.safeFetch,
}))
vi.mock('@/lib/link-preview-screenshot', () => ({ createLinkPreviewScreenshot: mocks.screenshot }))

import { GET } from '@/app/api/link-preview/route'

function request(url: string, screenshot = false): NextRequest {
  const params = new URLSearchParams({ url, ...(screenshot ? { screenshot: '1' } : {}) })
  return new NextRequest(`http://localhost/api/link-preview?${params}`)
}

describe('外部リンクプレビュー', () => {
  beforeEach(() => {
    mocks.safeFetch.mockReset()
    mocks.screenshot.mockReset()
  })

  it('noteやZenn相当のOG画像をそのまま返す', async () => {
    mocks.safeFetch.mockResolvedValue({
      status: 200,
      url: 'https://note.com/user/n/example',
      headers: { 'content-type': 'text/html' },
      body: Buffer.from('<meta property="og:title" content="記事タイトル"><meta property="og:image" content="https://assets.example/cover.png"><meta property="og:site_name" content="note">'),
    })

    const response = await GET(request('https://t.co/example'))
    await expect(response.json()).resolves.toMatchObject({
      title: '記事タイトル',
      image: 'https://assets.example/cover.png',
      siteName: 'note',
      url: 'https://note.com/user/n/example',
    })
    expect(mocks.screenshot).not.toHaveBeenCalled()
  })

  it('YouTubeはoEmbedのタイトルとサムネイルを返す', async () => {
    mocks.safeFetch
      .mockResolvedValueOnce({ status: 200, url: 'https://youtu.be/abcdefghijk', headers: {}, body: Buffer.from('<html></html>') })
      .mockResolvedValueOnce({ status: 200, url: 'https://www.youtube.com/oembed', headers: {}, body: Buffer.from(JSON.stringify({ title: '動画タイトル', author_name: '投稿者', thumbnail_url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' })) })

    const response = await GET(request('https://t.co/youtube'))
    await expect(response.json()).resolves.toMatchObject({
      title: '動画タイトル',
      description: 'YouTube · 投稿者',
      image: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
      siteName: 'YouTube',
    })
  })

  it('本文から直接渡されたYouTube URLもoEmbedで解決する', async () => {
    mocks.safeFetch
      .mockResolvedValueOnce({ status: 200, url: 'https://www.youtube.com/watch?v=abcdefghijk', headers: {}, body: Buffer.from('<html><title>YouTube</title></html>') })
      .mockResolvedValueOnce({ status: 200, url: 'https://www.youtube.com/oembed', headers: {}, body: Buffer.from(JSON.stringify({ title: '直接動画', thumbnail_url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' })) })

    const response = await GET(request('https://www.youtube.com/watch?v=abcdefghijk'))
    await expect(response.json()).resolves.toMatchObject({ title: '直接動画', image: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' })
  })

  it('YouTubeでもOG画像があればoEmbedより優先する', async () => {
    mocks.safeFetch.mockResolvedValue({
      status: 200,
      url: 'https://youtu.be/abcdefghijk',
      headers: {},
      body: Buffer.from('<meta property="og:title" content="OG動画"><meta property="og:image" content="https://img.example/og.jpg">'),
    })

    const response = await GET(request('https://youtu.be/abcdefghijk'))
    await expect(response.json()).resolves.toMatchObject({ title: 'OG動画', image: 'https://img.example/og.jpg' })
    expect(mocks.safeFetch).toHaveBeenCalledTimes(1)
  })

  it('OG画像がない公開ページにはローカルスナップショットURLを返す', async () => {
    mocks.safeFetch.mockResolvedValue({ status: 200, url: 'https://example.com/article', headers: {}, body: Buffer.from('<html><title>一般サイトの記事</title><body>本文</body></html>') })

    const response = await GET(request('https://example.com/article'))
    const data = await response.json() as { title: string; image: string }
    expect(data.title).toBe('一般サイトの記事')
    expect(data.image).toContain('/api/link-preview?')
    expect(data.image).toContain('screenshot=1')
  })

  it('スナップショット要求はPNGを返す', async () => {
    mocks.safeFetch.mockResolvedValue({ status: 200, url: 'https://example.com/article', headers: {}, body: Buffer.from('<html><body>本文</body></html>') })
    mocks.screenshot.mockResolvedValue(Buffer.from('png'))

    const response = await GET(request('https://example.com/article', true))
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from('png'))
    expect(mocks.screenshot).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com/article' }))
  })

  it('スナップショット生成に失敗してもAPIは制御されたエラーを返す', async () => {
    mocks.safeFetch.mockResolvedValue({ status: 200, url: 'https://example.com/article', headers: {}, body: Buffer.from('<html><body>本文</body></html>') })
    mocks.screenshot.mockRejectedValue(new Error('Chrome unavailable'))

    const response = await GET(request('https://example.com/article', true))
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'Chrome unavailable' })
  })

  it('一時的な取得失敗をキャッシュしない', async () => {
    mocks.safeFetch.mockRejectedValue(new Error('network unavailable'))

    const response = await GET(request('https://example.com/article'))

    expect(response.status).toBe(502)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('ローカルネットワークURLは撮影しない', async () => {
    const response = await GET(request('http://127.0.0.1/private', true))
    expect(response.status).toBe(400)
    expect(mocks.safeFetch).not.toHaveBeenCalled()
    expect(mocks.screenshot).not.toHaveBeenCalled()
  })
})
