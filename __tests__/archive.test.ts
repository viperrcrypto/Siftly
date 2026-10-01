/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  db: {} as Record<string, any>, gallery: vi.fn(), safeFetch: vi.fn(), fetchArticle: vi.fn(), execFile: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ default: mocks.db, prisma: mocks.db }))
vi.mock('@/lib/archive/gallery-dl', () => ({ resolveWithGalleryDl: mocks.gallery }))
vi.mock('@/lib/archive/safe-fetch', async (original) => ({ ...(await original<typeof import('@/lib/archive/safe-fetch')>()), safeFetch: mocks.safeFetch }))
vi.mock('@/lib/archive/clipper', async (original) => ({ ...(await original<typeof import('@/lib/archive/clipper')>()), fetchArticle: mocks.fetchArticle }))
vi.mock('node:child_process', () => ({ execFile: mocks.execFile }))

import { createArchiveQueue, enqueueIncompleteArchives, initializeArchiveQueue, runArchive } from '@/lib/archive/pipeline'
import { isSafeHttpUrl } from '@/lib/archive/safe-fetch'
import { renderTemplate, selectTemplate, writeArchiveNote, type ClipPage, type ClipperTemplate } from '@/lib/archive/clipper'
import { resolveSources } from '@/lib/archive/source-resolver'
import { importedMediaData } from '@/lib/media-import'

type Media = { id: string; type: string; url: string; mediaKey?: string | null; localPath: string | null; downloadStatus: string; contentHash: string | null; downloadError?: string | null; downloadedAt?: Date | null; fileSize?: number | null; sourceTweetId?: string | null; sourceTweetUrl?: string | null; sourceMediaIndex?: number | null; sourceAuthorId?: string | null; sourceAuthorHandle?: string | null }
type Bookmark = { id: string; tweetId: string; text: string; authorHandle: string; authorName: string; rawJson: string; mediaItems: Media[] }

const page: ClipPage = { url: 'https://article.example/a', canonicalUrl: 'https://article.example/a', title: '記事', description: '', author: '', published: '', content: '<p>本文</p>', html: '<html><body><main>本文</main></body></html>', image: '', schema: {} }
const tweet = (id: string, raw: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ id, authorId: 'author', conversationId: '1', text: '', raw, ...extra })

function fakeDb(bookmark: Bookmark, values: Record<string, string>) {
  const archives = new Map<string, any>()
  const matches = (record: any, where: any = {}) => {
    const clause = (value: any) => {
      if (value.status && (typeof value.status === 'string' ? record.status !== value.status : value.status.in && !value.status.in.includes(record.status))) return false
      if ('startedAt' in value) {
        if (value.startedAt === null && record.startedAt !== null) return false
        if (value.startedAt.gt && !(record.startedAt > value.startedAt.gt)) return false
        if (value.startedAt.lte && !(record.startedAt <= value.startedAt.lte)) return false
      }
      return true
    }
    if (where.bookmarkId && record.bookmarkId !== where.bookmarkId) return false
    const base = { ...where }
    delete base.OR
    delete base.bookmarkId
    return clause(base) && (!where.OR || where.OR.some(clause))
  }
  const db: any = {
    archiveRecord: {
      upsert: vi.fn(async ({ where, create }: any) => archives.get(where.bookmarkId) ?? (() => { const record = { id: 'archive', bookmarkId: where.bookmarkId, status: 'pending', attemptCount: 0, resultJson: '{}', ...create }; archives.set(where.bookmarkId, record); return record })()),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const records = [...archives.values()].filter((record) => matches(record, where))
        for (const record of records) Object.assign(record, data, data.attemptCount ? { attemptCount: record.attemptCount + data.attemptCount.increment } : {})
        return { count: records.length }
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => archives.get(where.bookmarkId)),
      findUnique: vi.fn(async ({ where }: any) => archives.get(where.bookmarkId) ?? null),
      findMany: vi.fn(async ({ where, take }: any) => [...archives.values()].filter((record) => matches(record, where)).slice(0, take)),
      findFirst: vi.fn(async ({ where }: any) => [...archives.values()].filter((record) => matches(record, where)).sort((left, right) => Number(left.startedAt) - Number(right.startedAt))[0] ?? null),
      update: vi.fn(async ({ where, data }: any) => Object.assign(archives.get(where.bookmarkId), data)),
    },
    bookmark: { findUniqueOrThrow: vi.fn(async () => bookmark), findUnique: vi.fn(async () => bookmark) },
    setting: { findMany: vi.fn(async () => Object.entries(values).map(([key, value]) => ({ key, value }))) },
    mediaItem: {
      update: vi.fn(async ({ where, data }: any) => Object.assign(bookmark.mediaItems.find((item) => item.id === where.id)!, data)),
      findMany: vi.fn(async () => bookmark.mediaItems),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const key = where.bookmarkId_sourceTweetId_sourceMediaIndex
        const current = bookmark.mediaItems.find((item) => item.sourceTweetId === key.sourceTweetId && item.sourceMediaIndex === key.sourceMediaIndex)
        if (current) return Object.assign(current, update)
        const created: Media = { id: `gallery-${bookmark.mediaItems.length + 1}`, localPath: null, downloadStatus: 'pending', contentHash: null, ...create }
        bookmark.mediaItems.push(created)
        return created
      }),
    },
  }
  Object.assign(mocks.db, db)
  return { archive: () => archives.get(bookmark.id), db }
}

async function fixture(options: { raw?: Record<string, unknown>; text?: string; media?: Partial<Media>[]; gallery?: boolean; downloadPdf?: boolean; vault?: boolean; sourceResolverEnabled?: boolean; tweetId?: string } = {}) {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'siftly-vault-'))
  const templates = await fs.mkdtemp(path.join(os.tmpdir(), 'siftly-template-'))
  await fs.writeFile(path.join(templates, '一般用-clipper.json'), JSON.stringify({ name: '一般用', noteNameFormat: '{{title}}', path: 'Sources', noteContentFormat: '{{content|markdown}}' }))
  const bookmark: Bookmark = { id: 'b1', tweetId: options.tweetId ?? '1', text: options.text ?? 'root', authorHandle: 'alice', authorName: 'Alice', rawJson: JSON.stringify(options.raw ?? {}), mediaItems: (options.media ?? []).map((media, index) => ({ id: `m${index + 1}`, type: 'video', url: 'https://video.twimg.com/a.mp4', localPath: null, downloadStatus: 'pending', contentHash: null, ...media })) }
  const store = fakeDb(bookmark, {
    archiveEnabled: 'true', autoAfterImport: 'false', obsidianVaultPath: options.vault === false ? '' : vault, archiveTemplateDir: templates,
    galleryDlPath: options.gallery ? 'gallery-dl' : '', cookieBrowser: '', downloadXVideo: 'true', downloadPdf: String(!!options.downloadPdf), sourceResolverEnabled: String(options.sourceResolverEnabled !== false), archiveRoot: 'Archive',
  })
  mocks.gallery.mockReset(); mocks.safeFetch.mockReset(); mocks.fetchArticle.mockReset()
  mocks.fetchArticle.mockResolvedValue(page)
  return { vault, templates, bookmark, store }
}

async function files(root: string): Promise<string[]> {
  const found: string[] = []
  async function visit(dir: string) { for (const entry of await fs.readdir(dir, { withFileTypes: true })) { const next = path.join(dir, entry.name); if (entry.isDirectory()) await visit(next); else found.push(next) } }
  await visit(root); return found
}

describe('runArchive 受入', () => {
  beforeEach(() => { mocks.gallery.mockReset(); mocks.safeFetch.mockReset(); mocks.fetchArticle.mockReset() })

  it('1 単独Tweet: gallery未設定でもroot/thread noteを保存しpartialにする', async () => {
    const f = await fixture(); const out = await runArchive(f.bookmark.id)
    expect(out.status).toBe('partial'); expect((out.result.thread as any).retryable).toBe(true); expect((await files(f.vault)).filter((x) => x.endsWith('.md'))).toHaveLength(1)
  })
  it('2 X native MP4: 一度取得し実ファイルとMediaItem状態を保存する', async () => {
    const f = await fixture({ media: [{}] }); mocks.safeFetch.mockResolvedValue({ url: 'https://video.twimg.com/a.mp4', headers: { 'content-type': 'video/mp4' }, body: Buffer.from('mp4') })
    await runArchive(f.bookmark.id); expect(mocks.safeFetch).toHaveBeenCalledTimes(1); expect(f.bookmark.mediaItems[0]).toMatchObject({ downloadStatus: 'success', fileSize: 3 }); expect(f.bookmark.mediaItems[0].contentHash).toMatch(/[a-f0-9]{64}/); await expect(fs.readFile(f.bookmark.mediaItems[0].localPath!)).resolves.toEqual(Buffer.from('mp4'))
  })
  it('3 YouTube: 動画DLせずplatform付きexternal_video URLを保持する', async () => {
    const f = await fixture({ raw: { url: 'https://youtube.com/watch?v=a' } }); const out = await runArchive(f.bookmark.id)
    expect(mocks.safeFetch).not.toHaveBeenCalled(); expect((out.result.sources as any).items).toContainEqual(expect.objectContaining({ sourceType: 'external_video', platform: 'youtube' }))
  })
  it('4 Vimeo: 動画DLせずexternal_video URLを保持する', async () => {
    const f = await fixture({ raw: { url: 'https://vimeo.com/1' } }); const out = await runArchive(f.bookmark.id)
    expect(mocks.safeFetch).not.toHaveBeenCalled(); expect((out.result.sources as any).items[0]).toMatchObject({ sourceType: 'external_video' })
  })
  it('5 rootとself reply: 同一作者chainだけをthread noteへ保存しrootを一度だけ解決する', async () => {
    const f = await fixture({ gallery: true }); mocks.gallery.mockResolvedValue([tweet('1'), tweet('2', { url: 'https://article.example/a' }, { inReplyToId: '1', text: '元記事' })])
    const out = await runArchive(f.bookmark.id); expect(mocks.gallery).toHaveBeenCalledTimes(1); expect((out.result.thread as any).tweets.map((x: any) => x.id)).toEqual(['1', '2']); expect((await files(f.vault)).filter((x) => x.endsWith('.md'))).toHaveLength(2)
  })
  it('6 self reply末尾の元記事: original_articleをclipしSource noteへrelationを入れる', async () => {
    const f = await fixture({ gallery: true }); mocks.gallery.mockResolvedValue([tweet('1'), tweet('2', { url: 'https://article.example/a' }, { inReplyToId: '1', authorHandle: 'alice', text: '元記事 https://article.example/a' })])
    const out = await runArchive(f.bookmark.id); expect(mocks.fetchArticle).toHaveBeenCalledTimes(1); expect((out.result.sources as any).items[0]).toMatchObject({ sourceType: 'original_article', relationship: 'self_reply', provenance: [expect.objectContaining({ authorId: 'author', authorHandle: 'alice', threadPosition: 1 })] }); const source = (await files(f.vault)).find((x) => /Sources/.test(x))!; await expect(fs.readFile(source, 'utf8')).resolves.toContain('referenced_from: "[[alice-1]]"')
  })
  it('7 YouTubeと元記事: 記事だけclipしYouTubeはURL-onlyにする', async () => {
    const f = await fixture({ raw: { urls: ['https://youtube.com/x', 'https://article.example/a'] }, text: '元記事 https://article.example/a' }); await runArchive(f.bookmark.id)
    expect(mocks.fetchArticle).toHaveBeenCalledTimes(1); expect(mocks.safeFetch).not.toHaveBeenCalled()
  })
  it('8 quoteの公式URL: quote provenanceを保持しthreadへ混ぜずprimary sourceにする', async () => {
    const f = await fixture({ gallery: true }); mocks.gallery.mockResolvedValue([tweet('1'), tweet('9', { url: 'https://who.int/report.pdf' }, { inReplyToId: '1', text: '公式', quotedById: '1' })])
    const out = await runArchive(f.bookmark.id); const source = (out.result.sources as any).items[0]; expect(mocks.gallery).toHaveBeenCalledTimes(1); expect(source).toMatchObject({ relationship: 'quote', sourceType: 'primary_source', discoveredFromPost: '9' }); expect((out.result.thread as any).quotes[0]).toMatchObject({ id: '9', quotedById: '1' }); expect((out.result.thread as any).tweets).toHaveLength(1)
  })
  it('galleryにないquotedTweetIdはfailed quoteとして保持し、次回だけ解決してSourceへ渡す', async () => {
    const f = await fixture({ gallery: true })
    mocks.gallery.mockResolvedValueOnce([tweet('1', {}, { quotedTweetId: '9' })]).mockResolvedValueOnce([tweet('9', { url: 'https://who.int/report.pdf' }, { text: '公式' })])
    const first = await runArchive(f.bookmark.id)
    expect((first.result.thread as any)).toMatchObject({ status: 'partial', quotes: [expect.objectContaining({ id: '9', url: 'https://x.com/i/status/9', relationship: 'quote', status: 'failed', quotedById: '1', retryable: true })] })
    expect((first.result.thread as any).tweets.map((item: any) => item.id)).toEqual(['1'])
    expect((first.result.sources as any).items).toEqual([])
    const second = await runArchive(f.bookmark.id)
    expect(mocks.gallery).toHaveBeenCalledTimes(2)
    expect((second.result.thread as any)).toMatchObject({ status: 'success', quotes: [expect.objectContaining({ id: '9', status: 'success', quotedById: '1' })] })
    expect((second.result.sources as any).items).toEqual([expect.objectContaining({ discoveredFromPost: '9', relationship: 'quote', sourceType: 'primary_source' })])
  })
  it('9 同一bookmark再実行: 成功済gallery/source/media/noteを重複実行しない', async () => {
    const f = await fixture({ gallery: true, media: [{}], raw: { url: 'https://article.example/a' } }); mocks.gallery.mockResolvedValue([tweet('1')]); mocks.safeFetch.mockResolvedValue({ url: 'https://video.twimg.com/a.mp4', headers: { 'content-type': 'video/mp4' }, body: Buffer.from('mp4') })
    await runArchive(f.bookmark.id); const count = (await files(f.vault)).length; await runArchive(f.bookmark.id); expect(mocks.gallery).toHaveBeenCalledTimes(1); expect(mocks.fetchArticle).toHaveBeenCalledTimes(1); expect(mocks.safeFetch).toHaveBeenCalledTimes(1); expect((await files(f.vault)).length).toBe(count)
  })
  it('10 記事失敗後retry: gallery/mediaを再DLせずclipだけ成功させる', async () => {
    const f = await fixture({ gallery: true, media: [{}], raw: { url: 'https://article.example/a' } }); mocks.gallery.mockResolvedValue([tweet('1')]); mocks.safeFetch.mockResolvedValue({ url: 'https://video.twimg.com/a.mp4', headers: { 'content-type': 'video/mp4' }, body: Buffer.from('mp4') }); mocks.fetchArticle.mockRejectedValueOnce(new Error('temporary'))
    expect((await runArchive(f.bookmark.id)).status).toBe('partial'); const out = await runArchive(f.bookmark.id); expect(out.status).toBe('success'); expect(mocks.gallery).toHaveBeenCalledTimes(1); expect(mocks.safeFetch).toHaveBeenCalledTimes(1); expect(mocks.fetchArticle).toHaveBeenCalledTimes(2)
  })
  it('11 gallery root失敗: fallback thread noteと既存mediaを継続しpartial/retryableにする', async () => {
    const f = await fixture({ gallery: true, media: [{}] }); mocks.gallery.mockRejectedValue(new Error('offline')); mocks.safeFetch.mockResolvedValue({ url: 'https://video.twimg.com/a.mp4', headers: { 'content-type': 'video/mp4' }, body: Buffer.from('mp4') })
    const out = await runArchive(f.bookmark.id); expect(out.status).toBe('partial'); expect((out.result.thread as any)).toMatchObject({ rootFallback: true, retryable: true }); expect(f.bookmark.mediaItems[0].downloadStatus).toBe('success'); expect((await files(f.vault)).some((x) => x.endsWith('.md'))).toBe(true)
  })
  it('12 第三者reply大量: root作者のchainだけをresult/thread noteにする', async () => {
    const f = await fixture({ gallery: true }); mocks.gallery.mockResolvedValue([tweet('1'), ...Array.from({ length: 20 }, (_, i) => tweet(String(i + 2), {}, { authorId: 'other', inReplyToId: '1' }))])
    const out = await runArchive(f.bookmark.id); expect((out.result.thread as any).tweets.map((x: any) => x.id)).toEqual(['1'])
  })
  it('13 X videoとYouTube: XだけをdownloadしYouTube URLは残す', async () => {
    const f = await fixture({ media: [{}], raw: { url: 'https://youtube.com/x' } }); mocks.safeFetch.mockResolvedValue({ url: 'https://video.twimg.com/a.mp4', headers: { 'content-type': 'video/mp4' }, body: Buffer.from('mp4') })
    const out = await runArchive(f.bookmark.id); expect(mocks.safeFetch).toHaveBeenCalledTimes(1); expect((out.result.sources as any).items[0]).toMatchObject({ sourceType: 'external_video' })
  })
  it('14 最終self replyだけのURL: rootからgallery復元してsource clipへ到達する', async () => {
    const f = await fixture({ gallery: true }); mocks.gallery.mockResolvedValue([tweet('1'), tweet('2', { url: 'https://article.example/a' }, { inReplyToId: '1', text: '元記事' })])
    const out = await runArchive(f.bookmark.id); expect(mocks.fetchArticle).toHaveBeenCalledWith('https://article.example/a'); expect((out.result.sources as any).items[0].discoveredFromPost).toBe('2')
  })
  it('15 PDF: 既定はURL-only、downloadPdf時のみapplication/pdfを安全保存する', async () => {
    const f = await fixture({ raw: { url: 'https://who.int/report.pdf' } }); await runArchive(f.bookmark.id); expect(mocks.safeFetch).not.toHaveBeenCalled(); f.store.db.setting.findMany.mockResolvedValue(Object.entries({ archiveEnabled: 'true', autoAfterImport: 'false', obsidianVaultPath: f.vault, archiveTemplateDir: f.templates, galleryDlPath: '', cookieBrowser: '', downloadXVideo: 'true', downloadPdf: 'true', archiveRoot: 'Archive' }).map(([key, value]) => ({ key, value }))); mocks.safeFetch.mockResolvedValue({ url: 'https://who.int/report.pdf', headers: { 'content-type': 'application/pdf' }, body: Buffer.from('pdf') })
    const out = await runArchive(f.bookmark.id); expect(mocks.safeFetch).toHaveBeenCalledTimes(1); expect((out.result.clips as any).items[0]).toMatchObject({ sourceKeys: ['url:https://who.int/report.pdf'] }); expect((out.result.clips as any).items[0].file.path).toMatch(/\.pdf$/); await expect(fs.readFile((out.result.clips as any).items[0].file.path)).resolves.toEqual(Buffer.from('pdf'))
  })
  it('galleryのroot/self/quote mediaだけをprovenance付きでupsertし、rerunで再downloadしない', async () => {
    const f = await fixture({ gallery: true })
    mocks.gallery.mockResolvedValue([
      tweet('1', {}, { authorHandle: 'alice', media: [{ type: 'photo', url: 'https://pbs.twimg.com/root.jpg', mediaKey: 'root', sourceMediaIndex: 0 }] }),
      tweet('2', {}, { authorHandle: 'alice', inReplyToId: '1', media: [{ type: 'animated_gif', url: 'https://video.twimg.com/self.mp4', mediaKey: 'self', sourceMediaIndex: 0 }] }),
      tweet('9', {}, { quotedById: '1', authorHandle: 'quoted', media: [{ type: 'video', url: 'https://video.twimg.com/quote.mp4', mediaKey: 'quote', sourceMediaIndex: 0 }] }),
      tweet('3', {}, { authorId: 'third-party', inReplyToId: '1', media: [{ type: 'photo', url: 'https://pbs.twimg.com/third.jpg', mediaKey: 'third', sourceMediaIndex: 0 }] }),
    ])
    mocks.safeFetch.mockImplementation(async (url: string) => ({ status: 200, url, headers: { 'content-type': url.includes('root') ? 'image/jpeg' : 'video/mp4' }, body: Buffer.from('media') }))
    const first = await runArchive(f.bookmark.id)
    expect(f.bookmark.mediaItems).toHaveLength(3)
    expect((first.result.media as any).items).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'photo', sourceTweetId: '1', sourceMediaIndex: 0 }), expect.objectContaining({ type: 'gif', sourceTweetId: '2' }), expect.objectContaining({ type: 'video', sourceTweetId: '9' })]))
    await runArchive(f.bookmark.id)
    expect(mocks.safeFetch).toHaveBeenCalledTimes(3)
  })
  it('t.co単独は一度だけtruncate probeで解決し、stable input keyでclipする', async () => {
    const f = await fixture({ raw: { url: 'https://t.co/a' } })
    mocks.safeFetch.mockResolvedValue({ status: 200, url: 'https://article.example/a', headers: {}, body: Buffer.alloc(0) })
    const out = await runArchive(f.bookmark.id)
    expect(mocks.safeFetch).toHaveBeenCalledWith('https://t.co/a', expect.objectContaining({ maxBytes: 16_384, truncate: true }))
    expect((out.result.sources as any).items[0]).toMatchObject({ canonicalUrl: 'https://article.example/a', sourceKey: 'url:https://t.co/a' })
    expect(mocks.fetchArticle).toHaveBeenCalledTimes(1)
    await runArchive(f.bookmark.id)
    expect(mocks.safeFetch).toHaveBeenCalledTimes(1)
  })
  it('partial sourcesでも成功済みt.coだけをseedし、失敗分だけretryする', async () => {
    const f = await fixture({ raw: { urls: ['https://t.co/ok', 'https://t.co/retry'] } })
    let retries = 0
    mocks.safeFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/ok')) return { status: 200, url: 'https://article.example/ok', headers: {}, body: Buffer.alloc(0) }
      retries++
      if (retries === 1) throw new Error('offline')
      return { status: 200, url: 'https://article.example/retry', headers: {}, body: Buffer.alloc(0) }
    })
    await runArchive(f.bookmark.id)
    await runArchive(f.bookmark.id)
    expect(mocks.safeFetch.mock.calls.filter(([url]) => url === 'https://t.co/ok')).toHaveLength(1)
    expect(mocks.safeFetch.mock.calls.filter(([url]) => url === 'https://t.co/retry')).toHaveLength(2)
  })
  it('expanded aliasは1 Source/1 clipに統合し、rerunでfetch/noteを増やさない', async () => {
    const f = await fixture({ raw: { entities: { urls: [{ url: 'https://t.example/a', expanded_url: 'https://article.example/a' }, { url: 'https://article.example/a' }] } } })
    await runArchive(f.bookmark.id)
    const count = (await files(f.vault)).filter((file) => file.endsWith('.md')).length
    const provenanceCount = JSON.parse(f.store.archive().resultJson).clips.items[0].provenance.length
    await runArchive(f.bookmark.id)
    expect(mocks.fetchArticle).toHaveBeenCalledTimes(1)
    expect((await files(f.vault)).filter((file) => file.endsWith('.md')).length).toBe(count)
    expect(JSON.parse(f.store.archive().resultJson).clips.items[0].provenance).toHaveLength(provenanceCount)
  })
  it('media/PDFの404を成功扱いにしない', async () => {
    const f = await fixture({ downloadPdf: true, media: [{}], raw: { url: 'https://who.int/report.pdf' } })
    mocks.safeFetch.mockImplementation(async (url: string) => ({ status: 404, url, headers: { 'content-type': url.endsWith('.pdf') ? 'application/pdf' : 'video/mp4' }, body: Buffer.alloc(0) }))
    const out = await runArchive(f.bookmark.id)
    expect(f.bookmark.mediaItems[0].downloadStatus).toBe('failed')
    expect((out.result.clips as any).items[0]).toMatchObject({ status: 'failed', retryable: true })
  })
  it('未選択templateの診断は成功clipをpartialにせず、render reasonはnote保存後もretryableにする', async () => {
    const f = await fixture({ raw: { url: 'https://article.example/a' } })
    await fs.writeFile(path.join(f.templates, 'broken.json'), '{')
    const first = await runArchive(f.bookmark.id)
    expect((first.result.clips as any)).toMatchObject({ status: 'success', retryable: false })
    await runArchive(f.bookmark.id)
    expect(mocks.fetchArticle).toHaveBeenCalledTimes(1)
    await fs.writeFile(path.join(f.templates, '一般用-clipper.json'), JSON.stringify({ name: '一般用', noteNameFormat: '{{title}}', path: 'Sources', noteContentFormat: '{{unknown}}' }))
    f.bookmark.rawJson = JSON.stringify({ urls: ['https://article.example/a', 'https://article.example/b'] })
    mocks.fetchArticle.mockResolvedValue({ ...page, url: 'https://article.example/b', canonicalUrl: 'https://article.example/b' })
    const reason = await runArchive(f.bookmark.id)
    const item = (reason.result.clips as any).items.find((clip: any) => clip.status === 'partial')
    expect(item).toMatchObject({ retryable: true })
    expect(item.note.path).toMatch(/\.md$/)
  })
  it('partial clipはtemplate修復後に同一noteを安全更新し、手編集は保持する', async () => {
    const f = await fixture({ raw: { url: 'https://article.example/a' } })
    await fs.writeFile(path.join(f.templates, '一般用-clipper.json'), JSON.stringify({ name: '一般用', noteNameFormat: '{{title}}', path: 'Sources', noteContentFormat: '{{unknown}}' }))
    const first = await runArchive(f.bookmark.id)
    const note = (first.result.clips as any).items[0].note.path
    const count = (await files(f.vault)).length
    await fs.writeFile(path.join(f.templates, '一般用-clipper.json'), JSON.stringify({ name: '一般用', noteNameFormat: '{{title}}', path: 'Sources', noteContentFormat: '{{content}}' }))
    const second = await runArchive(f.bookmark.id)
    expect((second.result.clips as any).items[0].note.path).toBe(note)
    expect((await files(f.vault)).length).toBe(count)
    expect((second.result.clips as any).items[0]).toMatchObject({ status: 'success' })
    await expect(fs.readFile(note, 'utf8')).resolves.toContain('本文')
    const g = await fixture({ raw: { url: 'https://article.example/a' } })
    await fs.writeFile(path.join(g.templates, '一般用-clipper.json'), JSON.stringify({ name: '一般用', noteNameFormat: '{{title}}', path: 'Sources', noteContentFormat: '{{unknown}}' }))
    const partial = await runArchive(g.bookmark.id)
    const edited = (partial.result.clips as any).items[0].note.path
    const hash = (partial.result.clips as any).items[0].note.hash
    await fs.writeFile(edited, 'user edit')
    await fs.writeFile(path.join(g.templates, '一般用-clipper.json'), JSON.stringify({ name: '一般用', noteNameFormat: '{{title}}', path: 'Sources', noteContentFormat: '{{content}}' }))
    const retry = await runArchive(g.bookmark.id)
    expect(retry.status).toBe('partial')
    expect((retry.result.clips as any).items[0].note).toMatchObject({ path: edited, hash })
    const retryAgain = await runArchive(g.bookmark.id)
    expect(retryAgain.status).toBe('partial')
    expect((retryAgain.result.clips as any).items[0].note).toMatchObject({ path: edited, hash })
    await expect(fs.readFile(edited, 'utf8')).resolves.toBe('user edit')
    expect((await files(g.vault)).filter((file) => file.endsWith('.md'))).toHaveLength(2)
  })
  it('Vault未設定でもgallery media provenanceを保存し、同一CDN URLはfirst-winsで継続する', async () => {
    const f = await fixture({ gallery: true, vault: false })
    mocks.gallery.mockResolvedValue([
      tweet('1', {}, { media: [{ type: 'photo', url: 'https://pbs.twimg.com/shared.jpg', sourceMediaIndex: 0 }] }),
      tweet('2', {}, { inReplyToId: '1', media: [{ type: 'photo', url: 'https://pbs.twimg.com/shared.jpg?signature=next', sourceMediaIndex: 0 }] }),
    ])
    const out = await runArchive(f.bookmark.id)
    expect(f.bookmark.mediaItems).toHaveLength(1)
    expect(f.bookmark.mediaItems[0]).toMatchObject({ sourceTweetId: '1', sourceMediaIndex: 0 })
    expect((out.result.media as any)).toMatchObject({ status: 'partial', items: [expect.objectContaining({ status: 'discovered', sourceTweetId: '1' })] })
  })
  it('import済みX媒体はgalleryのquery違いと照合し、先頭URLの1行だけをdownloadする', async () => {
    const f = await fixture({ gallery: true, media: [{ type: 'photo', url: 'https://pbs.twimg.com/shared.jpg?name=small', sourceTweetId: '1', sourceMediaIndex: 0, mediaKey: 'media-1' }] })
    mocks.gallery.mockResolvedValue([tweet('1', {}, { media: [{ type: 'photo', url: 'https://pbs.twimg.com/shared.jpg?name=large', mediaKey: 'media-1', sourceMediaIndex: 0 }] })])
    mocks.safeFetch.mockResolvedValue({ status: 200, url: 'https://pbs.twimg.com/shared.jpg?name=small', headers: { 'content-type': 'image/jpeg' }, body: Buffer.from('media') })
    await runArchive(f.bookmark.id)
    expect(f.bookmark.mediaItems).toHaveLength(1)
    expect(f.bookmark.mediaItems[0].url).toBe('https://pbs.twimg.com/shared.jpg?name=small')
    expect(mocks.safeFetch).toHaveBeenCalledTimes(1)
  })

  it('galleryのpbs動画previewはMP4へ昇格して1回だけ保存する', async () => {
    const f = await fixture({ gallery: true })
    const { galleryTweetsFromDataJobs } = await vi.importActual<typeof import('@/lib/archive/gallery-dl')>('@/lib/archive/gallery-dl')
    const raw = { rest_id: '1', legacy: { full_text: 'video', conversation_id_str: '1', extended_entities: { media: [{ type: 'video', id_str: 'video-1', media_url_https: 'https://pbs.twimg.com/ext_tw_video_thumb/a.jpg', video_info: { variants: [{ url: 'https://video.twimg.com/ext_tw_video/low.mp4?tag=1', bit_rate: '832000' }, { url: 'https://video.twimg.com/ext_tw_video/high.mp4?tag=1', bitrate: 2176000 }] } }] } }, core: { user_results: { result: { rest_id: 'author', legacy: { screen_name: 'alice' } } } } }
    mocks.gallery.mockResolvedValue(galleryTweetsFromDataJobs([[2, raw], [3, 'https://pbs.twimg.com/ext_tw_video_thumb/a.jpg?name=small', raw]]))
    mocks.safeFetch.mockResolvedValue({ status: 200, url: 'https://video.twimg.com/ext_tw_video/high.mp4?tag=1', headers: { 'content-type': 'video/mp4' }, body: Buffer.from('mp4') })
    await runArchive(f.bookmark.id)
    expect(mocks.safeFetch).toHaveBeenCalledTimes(1)
    expect(mocks.safeFetch).toHaveBeenCalledWith('https://video.twimg.com/ext_tw_video/high.mp4?tag=1', expect.anything())
    expect(f.bookmark.mediaItems[0]).toMatchObject({ url: 'https://video.twimg.com/ext_tw_video/high.mp4?tag=1', downloadStatus: 'success' })
  })

  it('source resolver無効時はt.co/記事を取得せずThreadとmediaを継続する', async () => {
    const f = await fixture({ gallery: true, sourceResolverEnabled: false, media: [{}], raw: { urls: ['https://t.co/a', 'https://article.example/a'] } })
    mocks.gallery.mockResolvedValue([tweet('1'), tweet('2', {}, { inReplyToId: '1', text: 'reply' })])
    mocks.safeFetch.mockResolvedValue({ status: 200, url: 'https://video.twimg.com/a.mp4', headers: { 'content-type': 'video/mp4' }, body: Buffer.from('mp4') })
    const out = await runArchive(f.bookmark.id)
    expect(mocks.safeFetch).not.toHaveBeenCalledWith('https://t.co/a', expect.anything())
    expect(mocks.fetchArticle).not.toHaveBeenCalled()
    expect((out.result.sources as any).items).toEqual([])
    expect((out.result.thread as any).status).toBe('success')
    expect((out.result.media as any).items[0]).toMatchObject({ status: 'success' })
  })

  it('19桁root_idを引用文字列としてThread noteへ保存する', async () => {
    const f = await fixture({ tweetId: '9223372036854775807' })
    const out = await runArchive(f.bookmark.id)
    await expect(fs.readFile((out.result.threadNote as any).note.path, 'utf8')).resolves.toContain('root_id: "9223372036854775807"')
  })
})

describe('境界とテンプレート', () => {
  it('IPv4-mapped IPv6を拒否する', () => expect(isSafeHttpUrl('http://[::ffff:7f00:1]/')).toBe(false))
  it('Vault symlinkと同名note collisionを拒否/分離する', async () => { const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'siftly-vault-')); await fs.symlink(os.tmpdir(), path.join(vault, 'escape')); await expect(writeArchiveNote(vault, 'escape', 'x', 'x')).rejects.toThrow(/symlink/); const one = await writeArchiveNote(vault, 'n', 'same', 'one', 'one'); const two = await writeArchiveNote(vault, 'n', 'same', 'two', 'two'); expect(one.path).not.toBe(two.path) })
  it('一般用fallback、実X regex flag/filter、空noteNameはtitle fallbackを扱う', () => { const template: ClipperTemplate & { file: string } = { file: '一般用-clipper.json', name: '一般用', noteNameFormat: '{{title}}', path: 'C', noteContentFormat: '{{content|markdown}}' }; expect(selectTemplate([template], { ...page, url: 'https://example.com' })).toBe(template); const x = { ...template, file: 'x.json', triggers: ['/https:\\/\\/x\\.com\\/.*$/i'], noteNameFormat: '{{"llm"}}', noteContentFormat: '{{content|markdown}}' }; expect(selectTemplate([template, x], { ...page, url: 'https://X.com/a' })).toBe(x); expect(renderTemplate(x, page).noteName).toBe(page.title) })
  it('gallery-dl 1.32 metadataのquote_idはquotedByIdであり、quoted出力も有効にする', async () => { const { galleryDlArgs, galleryTweetFromRaw } = await vi.importActual<typeof import('@/lib/archive/gallery-dl')>('@/lib/archive/gallery-dl'); const quoted = galleryTweetFromRaw({ tweet_id: 9, conversation_id: 1, quote_id: 1, author: { id: 7 }, content: 'quote' }); expect(quoted).toMatchObject({ id: '9', authorId: '7', quotedById: '1', quotedTweetId: undefined }); expect(galleryDlArgs()).toEqual(expect.arrayContaining(['--no-download', 'extractor.twitter.quoted=true'])) })
  it('queueは実workerを2並行で55 pendingまで処理し、完了済みpartial/failedを再投入しない', async () => {
    const pending = Array.from({ length: 55 }, (_, index) => `pending-${index}`)
    const started: string[] = []
    const releases = new Map<string, () => void>()
    const completed = new Map<string, string>()
    let concurrent = 0
    let maximum = 0
    const run = vi.fn((bookmarkId: string) => new Promise<{ status: string }>((resolve) => {
      started.push(bookmarkId); concurrent++; maximum = Math.max(maximum, concurrent)
      releases.set(bookmarkId, () => {
        concurrent--
        const status = bookmarkId === 'pending-0' ? 'partial' : bookmarkId === 'pending-1' ? 'failed' : 'success'
        completed.set(bookmarkId, status)
        resolve({ status })
      })
    }))
    async function refillPending() {
      while (pending.length && queue.stats().queued < 50) expect(queue.enqueue(pending.shift()!)).toBe(true)
    }
    const refill = vi.fn(refillPending)
    const queue = createArchiveQueue(run, refill)
    await refillPending()
    await vi.waitFor(() => expect(started).toHaveLength(2))
    expect(queue.enqueue(started[0])).toBe(true)
    expect(queue.enqueue('pending-2')).toBe(true)
    expect(queue.enqueue('overflow')).toBe(false)
    while (started.length < 55) {
      const before = started.length
      for (const release of releases.values()) release()
      releases.clear()
      await vi.waitFor(() => expect(started.length).toBeGreaterThan(before))
    }
    for (const release of releases.values()) release()
    await vi.waitFor(() => expect(queue.stats()).toEqual({ active: 0, queued: 0 }))
    expect(started).toHaveLength(55)
    expect(new Set(started).size).toBe(55)
    expect(completed.get('pending-0')).toBe('partial')
    expect(completed.get('pending-1')).toBe('failed')
    expect(started.filter((id) => id === 'pending-0' || id === 'pending-1')).toHaveLength(2)
    expect(maximum).toBe(2)
    expect(refill).toHaveBeenCalled()
  })

  it('archive無効時の初期化はstale processingだけpendingへ戻しworker/refillを起動しない', async () => {
    const f = await fixture()
    const run = vi.fn().mockResolvedValue(undefined)
    const refill = vi.fn().mockResolvedValue(undefined)
    f.store.db.setting.findMany.mockResolvedValue(Object.entries({ archiveEnabled: 'false', autoAfterImport: 'false' }).map(([key, value]) => ({ key, value })))
    await initializeArchiveQueue(createArchiveQueue(run, refill))
    expect(f.store.db.archiveRecord.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'pending', startedAt: null, finishedAt: null } }))
    expect(run).not.toHaveBeenCalled()
    expect(refill).not.toHaveBeenCalled()
  })

  it('non-stale processingは次のstale境界で一度だけpending化してworkerを起動する', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-14T00:00:00.000Z'))
      const f = await fixture()
      await f.store.db.archiveRecord.upsert({ where: { bookmarkId: f.bookmark.id }, create: { bookmarkId: f.bookmark.id } })
      await f.store.db.archiveRecord.update({ where: { bookmarkId: f.bookmark.id }, data: { status: 'processing', startedAt: new Date(Date.now() - 60_000) } })
      f.store.db.setting.findMany.mockResolvedValue(Object.entries({ archiveEnabled: 'true', autoAfterImport: 'true' }).map(([key, value]) => ({ key, value })))
      vi.resetModules()
      const fresh = await import('@/lib/archive/pipeline')
      const run = vi.fn(async (bookmarkId: string) => { await f.store.db.archiveRecord.update({ where: { bookmarkId }, data: { status: 'success' } }) })
      async function refillPending() {
        for (const archive of await f.store.db.archiveRecord.findMany({ where: { status: 'pending' } })) queue.enqueue(archive.bookmarkId)
      }
      const refill = vi.fn(refillPending)
      const queue = fresh.createArchiveQueue(run, refill)
      await Promise.all([fresh.initializeArchiveQueue(queue), fresh.initializeArchiveQueue(queue)])
      expect(f.store.db.archiveRecord.findFirst).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(14 * 60_000)
      await vi.runAllTimersAsync()
      expect(run).toHaveBeenCalledWith(f.bookmark.id)
      expect(f.store.archive()).toMatchObject({ status: 'success' })
      expect(refill).toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('non-stale processingは無効時も次のstale境界でpending化するだけでworkerを起動しない', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-14T00:00:00.000Z'))
      const f = await fixture()
      await f.store.db.archiveRecord.upsert({ where: { bookmarkId: f.bookmark.id }, create: { bookmarkId: f.bookmark.id } })
      await f.store.db.archiveRecord.update({ where: { bookmarkId: f.bookmark.id }, data: { status: 'processing', startedAt: new Date(Date.now() - 60_000) } })
      f.store.db.setting.findMany.mockResolvedValue(Object.entries({ archiveEnabled: 'false', autoAfterImport: 'false' }).map(([key, value]) => ({ key, value })))
      vi.resetModules()
      const fresh = await import('@/lib/archive/pipeline')
      const run = vi.fn().mockResolvedValue(undefined)
      const refill = vi.fn().mockResolvedValue(undefined)
      await fresh.initializeArchiveQueue(fresh.createArchiveQueue(run, refill))
      await vi.advanceTimersByTimeAsync(14 * 60_000)
      await vi.runAllTimersAsync()
      expect(f.store.archive()).toMatchObject({ status: 'pending', startedAt: null })
      expect(run).not.toHaveBeenCalled()
      expect(refill).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('auto importはpendingだけをqueueしpartial/failed/successを投入しない', async () => {
    const f = await fixture()
    for (const status of ['pending', 'partial', 'failed', 'success']) {
      await f.store.db.archiveRecord.upsert({ where: { bookmarkId: status }, create: { bookmarkId: status } })
      await f.store.db.archiveRecord.update({ where: { bookmarkId: status }, data: { status } })
    }
    f.store.db.setting.findMany.mockResolvedValue(Object.entries({ archiveEnabled: 'true', autoAfterImport: 'true' }).map(([key, value]) => ({ key, value })))
    const started: string[] = []
    const refill = vi.fn().mockResolvedValue(undefined)
    await enqueueIncompleteArchives(['pending', 'partial', 'failed', 'success'], createArchiveQueue(async (bookmarkId) => { started.push(bookmarkId) }, refill))
    await vi.waitFor(() => expect(started).toEqual(['pending']))
    expect(refill).toHaveBeenCalled()
  })

  it('background APIはqueue満杯(false)の場合だけ503を返す', async () => {
    const f = await fixture()
    const enqueue = vi.spyOn(await import('@/lib/archive/pipeline'), 'enqueueArchive').mockReturnValue(false)
    const { POST } = await import('@/app/api/archive/[bookmarkId]/route')
    const response = await POST(new Request('http://localhost/api/archive/b1', { method: 'POST', body: JSON.stringify({ background: true }) }) as any, { params: Promise.resolve({ bookmarkId: f.bookmark.id }) })
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ queued: false })
    enqueue.mockRestore()
  })
  it('本文だけのself reply URLもSourceになる', () => expect(resolveSources([{ id: '2', relationship: 'self_reply', text: '元記事 https://article.example/a', urls: ['https://article.example/a'] }])[0]).toMatchObject({ discoveredFromPost: '2', sourceType: 'original_article' }))
  it('実raw候補のX/CDN/profileは除外し、未解決t.coはpipeline再試行対象として残す', () => expect(resolveSources([{ id: '1', relationship: 'root', text: '', urls: ['https://x.com/a/status/1', 'https://pbs.twimg.com/a.jpg', 'https://t.co/a', 'https://article.example/a'] }]).map((x) => x.canonicalUrl)).toEqual(['https://t.co/a', 'https://article.example/a']))
  it('同URLのprovenanceを3件集約する', () => { const out = resolveSources(['root', 'self_reply', 'quote'].map((relationship, index) => ({ id: String(index), relationship: relationship as 'root' | 'self_reply' | 'quote', text: '', urls: ['https://article.example/a'] }))); expect(out).toHaveLength(1); expect(out[0].provenance).toHaveLength(3) })
  it('quote metadataは公式status URLを保持する', async () => { const f = await fixture({ gallery: true }); mocks.gallery.mockResolvedValue([tweet('1'), tweet('9', {}, { quotedById: '1' })]); const out = await runArchive(f.bookmark.id); expect((out.result.thread as any).quotes[0].url).toBe('https://x.com/i/status/9') })
  it('media URLの空値と重複はfirst-winsで除外する', () => expect(importedMediaData('bookmark', [{ type: 'photo', url: '' }, { type: 'photo', url: ' https://a ' }, { type: 'photo', url: 'https://a' }, { type: 'photo', url: 'https://b' }]).map((x) => x.url)).toEqual(['https://a', 'https://b']))
  it('異なるPDF sourceKeyは異なるhashを生成する', () => { const a = crypto.createHash('sha256').update('url:https://a/x.pdf').digest('hex').slice(0, 12); const b = crypto.createHash('sha256').update('url:https://b/y.pdf').digest('hex').slice(0, 12); expect(a).not.toBe(b) })
  it('fallback後にgallery復元するとthread本文が更新される', async () => { const f = await fixture({ gallery: true }); mocks.gallery.mockRejectedValueOnce(new Error('offline')); const first = await runArchive(f.bookmark.id); const before = (first.result.threadNote as any).note.path; mocks.gallery.mockResolvedValue([tweet('1'), tweet('2', {}, { inReplyToId: '1', text: 'reply' })]); const second = await runArchive(f.bookmark.id); expect((second.result.threadNote as any).note.path).toBe(before); await expect(fs.readFile(before, 'utf8')).resolves.toContain('reply') })
  it('実raw entitiesから外部URLをSource候補にし、未解決t.coをretryableにする', async () => { const f = await fixture({ raw: { entities: { urls: [{ expanded_url: 'https://article.example/a' }, { expanded_url: 'https://x.com/user' }, { expanded_url: 'https://t.co/x' }], media: [{ media_url_https: 'https://pbs.twimg.com/a.jpg' }] }, user: { url: 'https://profile.example/me' }, extended_entities: { media: [{ media_url_https: 'https://video.twimg.com/a.mp4' }] } } }); const out = await runArchive(f.bookmark.id); expect((out.result.sources as any)).toMatchObject({ status: 'partial', retryable: true }); expect((out.result.sources as any).items.filter((item: any) => item.canonicalUrl === 'https://article.example/a')).toHaveLength(1); expect(mocks.fetchArticle).toHaveBeenCalledWith('https://article.example/a') })
  it('self reply本文URLはrunArchive経由でclipされる', async () => { const f = await fixture({ gallery: true }); mocks.gallery.mockResolvedValue([tweet('1'), tweet('2', {}, { inReplyToId: '1', text: '元記事 https://article.example/a' })]); await runArchive(f.bookmark.id); expect(mocks.fetchArticle).toHaveBeenCalledWith('https://article.example/a') })
  it('canonicalが変わってもsourceKeyでrerun clipを再利用する', async () => { const f = await fixture({ raw: { entities: { urls: [{ expanded_url: 'https://article.example/a' }] } } }); mocks.fetchArticle.mockResolvedValue({ ...page, canonicalUrl: 'https://canonical.example/a' }); const one = await runArchive(f.bookmark.id); const count = (await files(f.vault)).length; await runArchive(f.bookmark.id); expect(mocks.fetchArticle).toHaveBeenCalledTimes(1); expect((one.result.clips as any).items[0]).toMatchObject({ sourceKey: 'url:https://article.example/a', canonicalUrl: 'https://canonical.example/a' }); expect((await files(f.vault)).length).toBe(count) })
  it('2 PDFはrunArchiveで別々の保存先になる', async () => { const f = await fixture({ downloadPdf: true, raw: { entities: { urls: [{ expanded_url: 'https://who.int/a.pdf' }, { expanded_url: 'https://who.int/b.pdf' }] } } }); mocks.safeFetch.mockResolvedValueOnce({ url: 'https://who.int/a.pdf', headers: { 'content-type': 'application/pdf' }, body: Buffer.from('a') }).mockResolvedValueOnce({ url: 'https://who.int/b.pdf', headers: { 'content-type': 'application/pdf' }, body: Buffer.from('b') }); const out = await runArchive(f.bookmark.id); const items = (out.result.clips as any).items; expect(items).toHaveLength(2); expect(items[0].file.path).not.toBe(items[1].file.path); await expect(fs.readFile(items[0].file.path)).resolves.toEqual(Buffer.from('a')); await expect(fs.readFile(items[1].file.path)).resolves.toEqual(Buffer.from('b')) })
  it('後発の公式provenanceでprimaryへ昇格する', () => expect(resolveSources([{ id: '1', relationship: 'root', text: '参考', urls: ['https://example.com/a'] }, { id: '2', relationship: 'quote', text: '公式', urls: ['https://example.com/a'] }])[0]).toMatchObject({ sourceType: 'primary_source', provenance: [{ discoveredFromPost: '1' }, { discoveredFromPost: '2' }] }))
  it('trim済みURLがMediaItemへ渡る', () => expect(importedMediaData('bookmark', [{ type: 'photo', url: ' https://a ' }])[0].url).toBe('https://a'))
  it('thread note手編集はretryでpartialとして保持する', async () => { const f = await fixture(); const one = await runArchive(f.bookmark.id); const note = (one.result.threadNote as any).note.path; await fs.writeFile(note, 'user edit'); const two = await runArchive(f.bookmark.id); expect(two.status).toBe('partial'); await expect(fs.readFile(note, 'utf8')).resolves.toBe('user edit') })
  it('gallery未設定retryable rootは設定後に再解決して同一Threadノートを更新する', async () => {
    const f = await fixture({ gallery: false })
    const first = await runArchive(f.bookmark.id)
    const note = (first.result.threadNote as any).note.path
    const count = (await files(f.vault)).filter((file) => file.endsWith('.md')).length
    f.store.db.setting.findMany.mockResolvedValue(Object.entries({ archiveEnabled: 'true', autoAfterImport: 'false', obsidianVaultPath: f.vault, archiveTemplateDir: f.templates, galleryDlPath: 'gallery-dl', cookieBrowser: '', downloadXVideo: 'true', downloadPdf: 'false', archiveRoot: 'Archive' }).map(([key, value]) => ({ key, value })))
    mocks.gallery.mockResolvedValue([tweet('1'), tweet('2', {}, { inReplyToId: '1', text: '復元reply' })])
    const second = await runArchive(f.bookmark.id)
    expect(mocks.gallery).toHaveBeenCalledTimes(1)
    expect((second.result.thread as any).tweets.map((item: any) => item.id)).toEqual(['1', '2'])
    expect((second.result.threadNote as any).note.path).toBe(note)
    expect((await files(f.vault)).filter((file) => file.endsWith('.md'))).toHaveLength(count)
    await expect(fs.readFile(note, 'utf8')).resolves.toContain('復元reply')
  })
})
