import { describe, expect, it, vi } from 'vitest'
import { createImportedBookmark, importedMediaData } from '@/lib/media-import'

describe('media import helper', () => {
  it('空URLを除外し、生URLの先勝ち順序を維持する', () => {
    expect(importedMediaData('bookmark-1', [
      { type: 'photo', url: '' },
      { type: 'photo', url: ' https://cdn.example/a?sig=one ' },
      { type: 'video', url: 'https://cdn.example/a?sig=one' },
      { type: 'photo', url: 'https://cdn.example/a?sig=two' },
    ])).toMatchObject([
      { bookmarkId: 'bookmark-1', type: 'photo', url: 'https://cdn.example/a?sig=one', thumbnailUrl: null, mediaKey: null },
      { bookmarkId: 'bookmark-1', type: 'photo', url: 'https://cdn.example/a?sig=two', thumbnailUrl: null, mediaKey: null },
    ])
  })

  it('同一X CDN媒体のquery違いは先頭URLと識別子を保持して1件にする', () => {
    expect(importedMediaData('bookmark-1', [
      { type: 'photo', url: 'https://pbs.twimg.com/media/a.jpg?name=small', mediaKey: 'media-a', sourceTweetId: 'tweet-1', sourceMediaIndex: 0 },
      { type: 'photo', url: 'https://pbs.twimg.com/media/a.jpg?name=large', mediaKey: 'media-b', sourceTweetId: 'tweet-1', sourceMediaIndex: 1 },
    ])).toMatchObject([{
      url: 'https://pbs.twimg.com/media/a.jpg?name=small', mediaKey: 'media-a', sourceTweetId: 'tweet-1', sourceMediaIndex: 0,
    }])
  })

  it('X媒体のsource provenanceをMediaItem作成値へ渡す', () => {
    expect(importedMediaData('bookmark-1', [{
      type: 'photo', url: 'https://pbs.twimg.com/media/a.jpg', mediaKey: 'media-a', sourceTweetId: 'tweet-1', sourceMediaIndex: 0,
    }])[0]).toMatchObject({ mediaKey: 'media-a', sourceTweetId: 'tweet-1', sourceMediaIndex: 0 })
  })

  it('呼出し元が省略してもroot tweetのprovenanceと配列順indexを補完する', async () => {
    const tx = { bookmark: { create: vi.fn().mockResolvedValue({ id: 'bookmark-1' }) }, mediaItem: { createMany: vi.fn() } }
    await createImportedBookmark({ $transaction: vi.fn((fn) => fn(tx)) } as never, {
      tweetId: 'tweet-1', text: '', authorHandle: 'alice', authorName: 'Alice', rawJson: '{}',
    }, [{ type: 'photo', url: 'https://pbs.twimg.com/a.jpg' }])
    expect(tx.mediaItem.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
      sourceTweetId: 'tweet-1', sourceTweetUrl: 'https://x.com/alice/status/tweet-1', sourceAuthorHandle: 'alice', sourceMediaIndex: 0,
    })] })
  })

  it('Bookmark作成とmedia挿入を同一transactionで行う', async () => {
    const tx = {
      bookmark: { create: vi.fn().mockResolvedValue({ id: 'bookmark-1' }) },
      mediaItem: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    }
    const db = { $transaction: vi.fn((fn) => fn(tx)) }

    await createImportedBookmark(db as never, {
      tweetId: 'tweet-1', text: '', authorHandle: 'a', authorName: 'A', rawJson: '{}',
    }, [{ type: 'photo', url: 'https://cdn.example/a' }])

    expect(db.$transaction).toHaveBeenCalledOnce()
    expect(tx.mediaItem.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ bookmarkId: 'bookmark-1', url: 'https://cdn.example/a' })] })
  })
})
