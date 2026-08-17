import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  db: {
    setting: { findUnique: vi.fn(), upsert: vi.fn() },
    bookmark: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    mediaItem: { findMany: vi.fn(), createMany: vi.fn() },
    archiveRecord: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
  enqueue: vi.fn(),
  ensure: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ default: mocks.db }))
vi.mock('@/lib/archive/pipeline', () => ({ enqueueIncompleteArchives: mocks.enqueue, ensureArchiveRecord: mocks.ensure }))

import { POST } from '@/app/api/import/x-oauth/fetch/route'

describe('X OAuth bookmark fetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    mocks.db.setting.findUnique.mockImplementation(({ where }: { where: { key: string } }) => Promise.resolve(
      where.key === 'x_oauth_access_token' ? { value: 'token' }
        : where.key === 'x_oauth_user_id' ? { value: 'x-user-1' }
          : null,
    ))
    mocks.db.bookmark.findUnique.mockResolvedValue(null)
    mocks.db.bookmark.findMany.mockResolvedValue([])
    mocks.db.bookmark.create.mockResolvedValue({ id: 'bookmark-1' })
    mocks.db.archiveRecord.updateMany.mockResolvedValue({ count: 1 })
    mocks.db.archiveRecord.findUnique.mockResolvedValue({
      status: 'pending', lastError: null, startedAt: null, finishedAt: null,
    })
    mocks.db.mediaItem.findMany.mockResolvedValue([])
    mocks.db.$transaction.mockImplementation((fn: (tx: typeof mocks.db) => unknown) => fn(mocks.db))
    mocks.enqueue.mockResolvedValue(undefined)
  })

  it('公式tweet fieldsを要求しnote_tweet本文を保存する', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{
        id: '1', text: 'short text', author_id: 'author',
        note_tweet: { text: '長文 https://article.example/a', entities: { urls: [{ url: 'https://t.co/a', expanded_url: 'https://article.example/a' }] } },
        referenced_tweets: [{ type: 'quoted', id: '2' }], conversation_id: '1', in_reply_to_user_id: 'other',
      }], includes: { users: [{ id: 'author', name: 'Alice', username: 'alice' }] } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(new Request('http://localhost/api/import/x-oauth/fetch', { method: 'POST', body: '{}' }) as never)
    const requestUrl = new URL(fetchMock.mock.calls[0][0])

    expect(requestUrl.pathname).toBe('/2/users/x-user-1/bookmarks')
    expect(requestUrl.searchParams.get('tweet.fields')).toBe('created_at,author_id,attachments,entities,note_tweet,article,referenced_tweets,conversation_id,in_reply_to_user_id')
    expect(mocks.db.bookmark.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ text: '長文 https://article.example/a' }) }))
    expect(mocks.enqueue).toHaveBeenCalledWith(['bookmark-1'])
    await expect(response.json()).resolves.toMatchObject({ imported: 1, total: 1 })
  })

  it('明示した場合は自己スレッドをRecent SearchからArchiveRecordへ保存する', async () => {
    mocks.db.archiveRecord.findUnique.mockResolvedValue({ resultJson: '{}' })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: '1', text: 'root', author_id: 'author', conversation_id: '1' }], includes: { users: [{ id: 'author', name: 'Alice', username: 'alice' }] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [
          { id: '2', text: 'reply', author_id: 'author', conversation_id: '1', referenced_tweets: [{ type: 'replied_to', id: '1' }] },
        ], includes: { users: [{ id: 'author', name: 'Alice', username: 'alice' }] } }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(new Request('http://localhost/api/import/x-oauth/fetch', { method: 'POST', body: JSON.stringify({ includeThreads: true }) }) as never)
    const update = mocks.db.archiveRecord.update.mock.calls[0]?.[0]

    expect(new URL(fetchMock.mock.calls[1][0]).pathname).toBe('/2/tweets/search/recent')
    expect(JSON.parse(update.data.resultJson).thread.tweets.map((tweet: { id: string }) => tweet.id)).toEqual(['1', '2'])
    await expect(response.json()).resolves.toMatchObject({ threadsImported: 1 })
  })

  it.each(['null', '[]'])('null/配列のJSON bodyを400で拒否する: %s', async (body) => {
    const response = await POST(new Request('http://localhost/api/import/x-oauth/fetch', { method: 'POST', body }) as never)
    expect(response.status).toBe(400)
  })

  it('X Articleの本文を要求してタイトルと本文を保存する', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{
        id: 'article-post',
        text: 'https://t.co/article',
        article: {
          title: '記事タイトル',
          plain_text: '記事本文',
          entities: { urls: [{ url: 'https://t.co/source', expanded_url: 'https://example.com/source' }] },
        },
      }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await POST(new Request('http://localhost/api/import/x-oauth/fetch', { method: 'POST', body: '{}' }) as never)
    const requestUrl = new URL(fetchMock.mock.calls[0][0])

    expect(requestUrl.searchParams.get('tweet.fields')?.split(',')).toContain('article')
    expect(requestUrl.searchParams.get('expansions')?.split(',')).toEqual(expect.arrayContaining([
      'article.cover_media', 'article.media_entities',
    ]))
    expect(mocks.db.bookmark.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ text: '記事タイトル\n\n記事本文' }),
    }))
  })

  it('GraphQL型のArticle本文とオブジェクト型mediaも保存する', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{
        id: 'graphql-article',
        text: 'https://t.co/article',
        article: {
          article_results: { result: {
            title: 'GraphQL記事',
            content_state: { blocks: [{ text: '本文1' }, { text: '本文2' }] },
            cover_media: { media_key: 'cover-key' },
            media_entities: [{ media_key: 'inline-key' }],
          } },
        },
      }], includes: { media: [
        { media_key: 'cover-key', type: 'photo', url: 'https://pbs.twimg.com/cover.jpg' },
        { media_key: 'inline-key', type: 'photo', url: 'https://pbs.twimg.com/inline.jpg' },
      ] } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await POST(new Request('http://localhost/api/import/x-oauth/fetch', { method: 'POST', body: '{}' }) as never)

    expect(mocks.db.bookmark.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ text: 'GraphQL記事\n\n本文1\n\n本文2' }),
    }))
    expect(mocks.db.mediaItem.createMany).toHaveBeenCalledWith({ data: expect.arrayContaining([
      expect.objectContaining({ mediaKey: 'cover-key', url: 'https://pbs.twimg.com/cover.jpg' }),
      expect.objectContaining({ mediaKey: 'inline-key', url: 'https://pbs.twimg.com/inline.jpg' }),
    ]) })
  })

  it('既存のX Articleを再インポートすると本文とrawを更新する', async () => {
    mocks.db.bookmark.findUnique.mockResolvedValue({
      id: 'existing-article', text: 'https://t.co/article', rawJson: '{"legacy":{"full_text":"旧GraphQL本文"}}',
    })
    mocks.db.mediaItem.findMany.mockResolvedValue([{ url: 'https://pbs.twimg.com/cover.jpg', mediaKey: 'cover-key' }])
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{
        id: 'article-post',
        text: 'https://t.co/article',
        article: {
          title: '記事タイトル', plain_text: '記事本文', cover_media: 'cover-key', media_entities: ['inline-key'],
        },
      }], includes: { media: [
        { media_key: 'cover-key', type: 'photo', url: 'https://pbs.twimg.com/cover.jpg' },
        { media_key: 'inline-key', type: 'photo', url: 'https://pbs.twimg.com/inline.jpg' },
      ] } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(new Request('http://localhost/api/import/x-oauth/fetch', { method: 'POST', body: '{}' }) as never)

    expect(mocks.db.bookmark.update).toHaveBeenCalledWith({
      where: { id: 'existing-article' },
      data: {
        text: '記事タイトル\n\n記事本文',
        rawJson: expect.stringMatching(/"legacy".*"article".*"plain_text"/),
      },
    })
    expect(mocks.db.archiveRecord.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { bookmarkId: 'existing-article', status: 'pending' },
      data: expect.objectContaining({ status: 'processing' }),
    }))
    expect(mocks.db.archiveRecord.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { bookmarkId: 'existing-article' },
      data: expect.objectContaining({ status: 'pending' }),
    }))
    expect(mocks.db.mediaItem.createMany).toHaveBeenCalledWith({ data: [
      expect.objectContaining({ bookmarkId: 'existing-article', mediaKey: 'inline-key', url: 'https://pbs.twimg.com/inline.jpg' }),
    ] })
    await expect(response.json()).resolves.toMatchObject({ imported: 0, skipped: 1, total: 1 })
  })

  it('本文未提供の既存Articleでもタイトルと画像を補完する', async () => {
    mocks.db.bookmark.findUnique.mockResolvedValue({ id: 'existing-article', text: 'https://t.co/article' })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{
        id: 'article-post', text: 'https://t.co/article',
        article: { title: '記事タイトル', cover_media: 'cover-key' },
      }], includes: { media: [
        { media_key: 'cover-key', type: 'photo', url: 'https://pbs.twimg.com/cover.jpg' },
      ] } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await POST(new Request('http://localhost/api/import/x-oauth/fetch', { method: 'POST', body: '{}' }) as never)

    expect(mocks.db.bookmark.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ text: '記事タイトル' }),
    }))
    expect(mocks.db.mediaItem.createMany).toHaveBeenCalledWith({ data: [
      expect.objectContaining({ mediaKey: 'cover-key', url: 'https://pbs.twimg.com/cover.jpg' }),
    ] })
  })

  it('本文未提供のOAuth応答で既存の豊富な本文を上書きしない', async () => {
    mocks.db.bookmark.findUnique.mockResolvedValue({
      id: 'existing-article', text: '別経路で取得済みの長い記事本文', rawJson: '{"legacy":{"full_text":"既存本文"}}',
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{
        id: 'article-post', text: 'https://t.co/article', article: { title: '記事タイトル' },
      }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await POST(new Request('http://localhost/api/import/x-oauth/fetch', { method: 'POST', body: '{}' }) as never)

    expect(mocks.db.bookmark.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ text: '別経路で取得済みの長い記事本文' }),
    }))
  })

  it('Archive処理中は既存Articleの更新を延期する', async () => {
    mocks.db.bookmark.findUnique.mockResolvedValue({ id: 'existing-article', text: '旧本文', rawJson: '{}' })
    mocks.db.archiveRecord.findUnique.mockResolvedValue({ status: 'processing' })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{
        id: 'article-post', text: 'https://t.co/article',
        article: { title: '記事タイトル', plain_text: '記事本文' },
      }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(new Request('http://localhost/api/import/x-oauth/fetch', { method: 'POST', body: '{}' }) as never)

    expect(mocks.db.bookmark.update).not.toHaveBeenCalled()
    expect(mocks.db.archiveRecord.updateMany).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({ deferred: 1, skipped: 1 })
  })

  it('状態確認直後にArchiveがclaimされた場合もArticle更新を延期する', async () => {
    mocks.db.bookmark.findUnique.mockResolvedValue({ id: 'existing-article', text: '旧本文', rawJson: '{}' })
    mocks.db.archiveRecord.updateMany.mockResolvedValueOnce({ count: 0 })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{
        id: 'article-post', text: 'https://t.co/article',
        article: { title: '記事タイトル', plain_text: '記事本文' },
      }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(new Request('http://localhost/api/import/x-oauth/fetch', { method: 'POST', body: '{}' }) as never)

    expect(mocks.db.bookmark.update).not.toHaveBeenCalled()
    expect(mocks.db.archiveRecord.update).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({ deferred: 1, skipped: 1 })
  })

  it('10ページで継続tokenを返し、次のrequestで11ページ目まで到達する', async () => {
    const fetchMock = vi.fn()
    for (let index = 1; index <= 11; index++) fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: String(index), text: `tweet-${index}` }], meta: index < 11 ? { next_token: `token-${index}` } : {} }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const first = await POST(new Request('http://localhost/api/import/x-oauth/fetch', { method: 'POST', body: '{}' }) as never)
    await expect(first.json()).resolves.toMatchObject({ imported: 10, truncated: true, nextToken: 'token-10' })
    const second = await POST(new Request('http://localhost/api/import/x-oauth/fetch', { method: 'POST', body: JSON.stringify({ nextToken: 'token-10' }) }) as never)
    await expect(second.json()).resolves.toMatchObject({ imported: 1, total: 1 })
    expect(new URL(fetchMock.mock.calls[10][0]).searchParams.get('pagination_token')).toBe('token-10')
  })

  it('明示repairだけがlink-only X Articleを公式tweet APIで本文へ補完する', async () => {
    mocks.db.bookmark.findMany.mockResolvedValue([{ id: 'article-bookmark', tweetId: '123', text: 'https://x.com/i/article/example', rawJson: '{}' }])
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: '123', text: 'https://x.com/i/article/example', article: { title: '完全記事', plain_text: '完全な本文' } }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(new Request('http://localhost/api/import/x-oauth/fetch', { method: 'POST', body: JSON.stringify({ repairArticles: true }) }) as never)

    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe('/2/tweets')
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('ids')).toBe('123')
    expect(mocks.db.bookmark.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ text: '完全記事\n\n完全な本文' }) }))
    await expect(response.json()).resolves.toMatchObject({ total: 1, repaired: 1, failed: 0 })
  })

  it('repair候補がなければX APIを呼ばず0件で成功する', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(new Request('http://localhost/api/import/x-oauth/fetch', { method: 'POST', body: JSON.stringify({ repairArticles: true }) }) as never)

    expect(fetchMock).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({ total: 0, repaired: 0, failed: 0 })
  })

  it('repairの部分成功ではpreview-onlyを失敗にし、archive statusを保持して再試行情報を残す', async () => {
    mocks.db.bookmark.findMany.mockResolvedValue([
      { id: 'complete', tweetId: '123', text: 'https://x.com/i/article/complete', rawJson: '{}' },
      { id: 'preview', tweetId: '124', text: 'https://x.com/i/article/preview', rawJson: '{}' },
    ])
    mocks.db.archiveRecord.findUnique.mockResolvedValue({ status: 'partial', resultJson: '{"existing":true}' })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [
        { id: '123', text: 'https://x.com/i/article/complete', article: { title: '完全記事', plain_text: '完全な本文' } },
        { id: '124', text: 'https://x.com/i/article/preview', article: { title: 'プレビュー', preview_text: '短い要約' } },
      ] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(new Request('http://localhost/api/import/x-oauth/fetch', { method: 'POST', body: JSON.stringify({ repairArticles: true }) }) as never)
    const failedUpdate = mocks.db.archiveRecord.update.mock.calls.find(([call]) => call.data.lastError)![0]

    expect(failedUpdate.data.status).toBeUndefined()
    expect(failedUpdate.data.lastError).toContain('preview')
    expect(JSON.parse(failedUpdate.data.resultJson)).toMatchObject({ existing: true, xArticleHydration: { status: 'failed', retryable: true } })
    await expect(response.json()).resolves.toMatchObject({ total: 2, repaired: 1, failed: 1 })
  })

  it('候補ごとのtransaction失敗を記録して次のArticle修復を続行する', async () => {
    mocks.db.bookmark.findMany.mockResolvedValue([
      { id: 'failed', tweetId: '123', text: 'https://x.com/i/article/failed', rawJson: '{}' },
      { id: 'repaired', tweetId: '124', text: 'https://x.com/i/article/repaired', rawJson: '{}' },
    ])
    mocks.db.archiveRecord.findUnique.mockResolvedValue({ status: 'partial', resultJson: '{}' })
    mocks.db.$transaction.mockRejectedValueOnce(new Error('write failed'))
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [
        { id: '123', text: 'https://x.com/i/article/failed', article: { title: '失敗', plain_text: '本文' } },
        { id: '124', text: 'https://x.com/i/article/repaired', article: { title: '成功', plain_text: '本文' } },
      ] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(new Request('http://localhost/api/import/x-oauth/fetch', { method: 'POST', body: JSON.stringify({ repairArticles: true }) }) as never)
    const failedUpdate = mocks.db.archiveRecord.update.mock.calls.find(([call]) => call.data.lastError)![0]

    expect(failedUpdate.data.status).toBeUndefined()
    expect(failedUpdate.data.lastError).toContain('write failed')
    expect(JSON.parse(failedUpdate.data.resultJson)).toMatchObject({ xArticleHydration: { status: 'failed', retryable: true } })
    expect(mocks.db.bookmark.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'repaired' } }))
    await expect(response.json()).resolves.toMatchObject({ total: 2, repaired: 1, failed: 1 })
  })

  it('repairは100 IDずつ処理し、API失敗をbookmarkごとの再試行可能な失敗として残す', async () => {
    mocks.db.bookmark.findMany.mockResolvedValue(Array.from({ length: 101 }, (_, index) => ({
      id: `bookmark-${index}`, tweetId: String(index + 1), text: `https://twitter.com/i/article/${index}`, rawJson: '{}',
    })))
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 })
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(new Request('http://localhost/api/import/x-oauth/fetch', { method: 'POST', body: JSON.stringify({ repairArticles: true }) }) as never)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(mocks.db.bookmark.findMany).toHaveBeenCalledWith(expect.not.objectContaining({ take: 500 }))
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('ids')?.split(',')).toHaveLength(100)
    expect(mocks.db.archiveRecord.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastError: expect.stringContaining('X Article hydration') }) }))
    await expect(response.json()).resolves.toMatchObject({ total: 101, repaired: 0, failed: 101 })
  })

})
