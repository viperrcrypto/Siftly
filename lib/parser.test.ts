import { describe, it, expect } from 'vitest'
import { parseTweetsJson, parseTweetsWithMeta } from './parser'

// ---------------------------------------------------------------------------
// Helpers – build fixture strings
// ---------------------------------------------------------------------------

function likesArchive(items: object[]): string {
  return `window.YTD.like.part0 = ${JSON.stringify(items)}`
}

function bookmarksArchive(items: object[]): string {
  return `window.YTD.bookmark.part0 = ${JSON.stringify(items)}`
}

// A minimal raw tweet object (the standard API-style format)
function rawTweet(overrides: Record<string, unknown> = {}) {
  return {
    id_str: '999',
    full_text: 'default tweet text',
    created_at: 'Wed Oct 10 20:19:24 +0000 2018',
    user: { screen_name: 'testuser', name: 'Test User' },
    entities: { hashtags: [], urls: [], media: [] },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1. parseTweetsJson with archive .js content
// ---------------------------------------------------------------------------
describe('parseTweetsJson – archive .js content', () => {
  it('strips window.YTD.like prefix and parses correctly', () => {
    const content = likesArchive([
      { like: { tweetId: '123', fullText: 'hello world', expandedUrl: 'https://x.com/user/status/123' } },
    ])

    const result = parseTweetsJson(content)
    expect(result).toHaveLength(1)
    expect(result[0].tweetId).toBe('123')
    expect(result[0].text).toBe('hello world')
    expect(result[0].urls).toEqual(['https://x.com/user/status/123'])
  })

  it('strips window.YTD.bookmark prefix and parses correctly', () => {
    const content = bookmarksArchive([
      { bookmark: { tweetId: '456', fullText: 'saved tweet' } },
    ])

    const result = parseTweetsJson(content)
    expect(result).toHaveLength(1)
    expect(result[0].tweetId).toBe('456')
    expect(result[0].text).toBe('saved tweet')
  })
})

// ---------------------------------------------------------------------------
// 2. parseTweetsWithMeta – returns tweets AND detectedSource
// ---------------------------------------------------------------------------
describe('parseTweetsWithMeta', () => {
  it('returns detectedSource "like" for likes archive', () => {
    const content = likesArchive([
      { like: { tweetId: '100', fullText: 'liked tweet' } },
    ])

    const result = parseTweetsWithMeta(content)
    expect(result.detectedSource).toBe('like')
    expect(result.tweets).toHaveLength(1)
    expect(result.tweets[0].tweetId).toBe('100')
  })

  it('returns detectedSource "bookmark" for bookmarks archive', () => {
    const content = bookmarksArchive([
      { bookmark: { tweetId: '200', fullText: 'bookmarked tweet' } },
    ])

    const result = parseTweetsWithMeta(content)
    expect(result.detectedSource).toBe('bookmark')
    expect(result.tweets).toHaveLength(1)
  })

  it('returns undefined detectedSource for non-archive JSON', () => {
    const content = JSON.stringify([rawTweet({ id_str: '300' })])

    const result = parseTweetsWithMeta(content)
    expect(result.detectedSource).toBeUndefined()
    expect(result.tweets).toHaveLength(1)
    expect(result.tweets[0].tweetId).toBe('300')
  })
})

// ---------------------------------------------------------------------------
// 3. Likes archive format
// ---------------------------------------------------------------------------
describe('likes archive format', () => {
  it('parses a likes archive item with all fields', () => {
    const content = likesArchive([
      {
        like: {
          tweetId: '123',
          fullText: 'hello world',
          expandedUrl: 'https://x.com/user/status/123',
        },
      },
    ])

    const result = parseTweetsJson(content)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      tweetId: '123',
      text: 'hello world',
      urls: ['https://x.com/user/status/123'],
      authorHandle: 'unknown',
      authorName: 'Unknown',
    })
  })
})

// ---------------------------------------------------------------------------
// 4. Bookmarks archive format
// ---------------------------------------------------------------------------
describe('bookmarks archive format', () => {
  it('parses a bookmarks archive item with tweetId and fullText', () => {
    const content = bookmarksArchive([
      { bookmark: { tweetId: '456', fullText: 'saved tweet' } },
    ])

    const result = parseTweetsJson(content)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      tweetId: '456',
      text: 'saved tweet',
      authorHandle: 'unknown',
      authorName: 'Unknown',
    })
  })

  it('includes expandedUrl when present', () => {
    const content = bookmarksArchive([
      {
        bookmark: {
          tweetId: '456',
          fullText: 'saved tweet',
          expandedUrl: 'https://example.com',
        },
      },
    ])

    const result = parseTweetsJson(content)
    expect(result[0].urls).toEqual(['https://example.com'])
  })
})

// ---------------------------------------------------------------------------
// 5. Sparse data – archive items with only tweetId
// ---------------------------------------------------------------------------
describe('sparse archive data', () => {
  it('parses archive item with only tweetId (no fullText, no expandedUrl)', () => {
    const content = likesArchive([
      { like: { tweetId: '789' } },
    ])

    const result = parseTweetsJson(content)
    expect(result).toHaveLength(1)
    expect(result[0].tweetId).toBe('789')
    expect(result[0].text).toBe('')
    expect(result[0].urls).toEqual([])
  })

  it('skips archive items with no tweetId at all', () => {
    const content = likesArchive([
      { like: {} },
    ])

    const result = parseTweetsJson(content)
    expect(result).toHaveLength(0)
  })

  it('skips archive items with empty inner object', () => {
    const content = likesArchive([
      { like: { tweetId: undefined } },
    ])

    const result = parseTweetsJson(content)
    expect(result).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 6. Empty archive
// ---------------------------------------------------------------------------
describe('empty archive', () => {
  it('returns empty array for empty likes archive', () => {
    const content = 'window.YTD.like.part0 = []'
    const result = parseTweetsJson(content)
    expect(result).toEqual([])
  })

  it('returns empty array for empty bookmarks archive', () => {
    const content = 'window.YTD.bookmark.part0 = []'
    const result = parseTweetsJson(content)
    expect(result).toEqual([])
  })

  it('parseTweetsWithMeta returns empty tweets and no detectedSource for empty likes', () => {
    const content = 'window.YTD.like.part0 = []'
    const result = parseTweetsWithMeta(content)
    expect(result.tweets).toEqual([])
    // archiveType is still detected from the prefix even with empty array
    expect(result.detectedSource).toBe('like')
  })
})

// ---------------------------------------------------------------------------
// 7. Multiple items
// ---------------------------------------------------------------------------
describe('multiple archive items', () => {
  it('parses all items from a likes archive', () => {
    const content = likesArchive([
      { like: { tweetId: '1', fullText: 'first' } },
      { like: { tweetId: '2', fullText: 'second' } },
      { like: { tweetId: '3', fullText: 'third' } },
    ])

    const result = parseTweetsJson(content)
    expect(result).toHaveLength(3)
    expect(result.map((b) => b.tweetId)).toEqual(['1', '2', '3'])
    expect(result.map((b) => b.text)).toEqual(['first', 'second', 'third'])
  })

  it('parses all items from a bookmarks archive', () => {
    const content = bookmarksArchive([
      { bookmark: { tweetId: '10', fullText: 'a' } },
      { bookmark: { tweetId: '20', fullText: 'b' } },
    ])

    const result = parseTweetsJson(content)
    expect(result).toHaveLength(2)
    expect(result.map((b) => b.tweetId)).toEqual(['10', '20'])
  })

  it('skips invalid items among valid ones', () => {
    const content = likesArchive([
      { like: { tweetId: '1', fullText: 'valid' } },
      { like: {} },
      { like: { tweetId: '3', fullText: 'also valid' } },
    ])

    const result = parseTweetsJson(content)
    expect(result).toHaveLength(2)
    expect(result.map((b) => b.tweetId)).toEqual(['1', '3'])
  })
})

// ---------------------------------------------------------------------------
// 8. Backward compatibility – existing JSON formats still work
// ---------------------------------------------------------------------------
describe('backward compatibility – existing formats', () => {
  it('parses raw tweet array (API-style)', () => {
    const content = JSON.stringify([
      rawTweet({ id_str: '111', full_text: 'api tweet', user: { screen_name: 'alice', name: 'Alice' } }),
    ])

    const result = parseTweetsJson(content)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      tweetId: '111',
      text: 'api tweet',
      authorHandle: 'alice',
      authorName: 'Alice',
    })
  })

  it('parses console export format', () => {
    const content = JSON.stringify({
      exportDate: '2024-01-01',
      totalBookmarks: 1,
      bookmarks: [
        {
          id: '222',
          text: 'console tweet',
          author: 'Bob',
          handle: '@bob',
          timestamp: '2024-01-01T00:00:00Z',
        },
      ],
    })

    const result = parseTweetsJson(content)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      tweetId: '222',
      text: 'console tweet',
      authorHandle: 'bob',
      authorName: 'Bob',
    })
  })

  it('appends quoted tweet text in console export format', () => {
    const content = JSON.stringify({
      bookmarks: [
        {
          id: '223',
          text: 'check this out',
          author: 'Alice',
          handle: '@alice',
          quotedText: 'the original thought',
          quotedAuthor: 'carol',
        },
      ],
    })

    const result = parseTweetsJson(content)
    expect(result).toHaveLength(1)
    expect(result[0].tweetId).toBe('223')
    expect(result[0].text).toBe(
      'check this out\n\n[Quote @carol]: the original thought'
    )
    expect(result[0].authorHandle).toBe('alice')
  })

  it('uses "unknown" for quotedAuthor when missing in console export format', () => {
    const content = JSON.stringify({
      bookmarks: [
        {
          id: '224',
          text: 'interesting',
          handle: '@dave',
          quotedText: 'some quoted content',
        },
      ],
    })

    const result = parseTweetsJson(content)
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe(
      'interesting\n\n[Quote @unknown]: some quoted content'
    )
  })

  it('handles empty main text with quoted tweet in console export format', () => {
    const content = JSON.stringify({
      bookmarks: [
        {
          id: '225',
          handle: '@eve',
          quotedText: 'just the quote',
          quotedAuthor: 'frank',
        },
      ],
    })

    const result = parseTweetsJson(content)
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe(
      '\n\n[Quote @frank]: just the quote'
    )
  })

  it('parses flat export format (CSV-style)', () => {
    const content = JSON.stringify([
      {
        'Tweet Id': '333',
        'Full Text': 'flat tweet',
        'User Screen Name': 'charlie',
        'User Name': 'Charlie',
        'Created At': '2024-06-15T12:00:00Z',
      },
    ])

    const result = parseTweetsJson(content)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      tweetId: '333',
      text: 'flat tweet',
      authorHandle: 'charlie',
      authorName: 'Charlie',
    })
  })

  it('parses Siftly re-export format', () => {
    const content = JSON.stringify([
      {
        tweetId: '444',
        text: 'siftly tweet',
        authorHandle: 'dave',
        authorName: 'Dave',
      },
    ])

    const result = parseTweetsJson(content)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      tweetId: '444',
      text: 'siftly tweet',
      authorHandle: 'dave',
      authorName: 'Dave',
    })
  })

  it('parses twitter-web-exporter format (object with array value)', () => {
    const content = JSON.stringify({
      tweets: [
        rawTweet({ id_str: '555', full_text: 'wrapped tweet' }),
      ],
    })

    const result = parseTweetsJson(content)
    expect(result).toHaveLength(1)
    expect(result[0].tweetId).toBe('555')
  })
})

// ---------------------------------------------------------------------------
// 9. Mixed / archive detection doesn't break other formats
// ---------------------------------------------------------------------------
describe('archive detection does not break other formats', () => {
  it('regular JSON array without window.YTD prefix works', () => {
    const content = JSON.stringify([rawTweet({ id_str: '600' })])

    const result = parseTweetsJson(content)
    expect(result).toHaveLength(1)
    expect(result[0].tweetId).toBe('600')
  })

  it('parseTweetsWithMeta correctly returns no source for regular JSON', () => {
    const content = JSON.stringify([rawTweet({ id_str: '601' })])

    const meta = parseTweetsWithMeta(content)
    expect(meta.detectedSource).toBeUndefined()
    expect(meta.tweets).toHaveLength(1)
  })

  it('content starting with whitespace before window.YTD prefix still works', () => {
    const content = `  \n  window.YTD.like.part0 = [{"like":{"tweetId":"700","fullText":"padded"}}]`

    const result = parseTweetsJson(content)
    expect(result).toHaveLength(1)
    expect(result[0].tweetId).toBe('700')
    expect(result[0].text).toBe('padded')
  })

  it('handles part numbers > 0', () => {
    const content = `window.YTD.like.part3 = [{"like":{"tweetId":"800","fullText":"part three"}}]`

    const result = parseTweetsJson(content)
    expect(result).toHaveLength(1)
    expect(result[0].tweetId).toBe('800')
  })
})

// ---------------------------------------------------------------------------
// Edge cases / error handling
// ---------------------------------------------------------------------------
describe('error handling', () => {
  it('throws on empty string', () => {
    expect(() => parseTweetsJson('')).toThrow('Empty JSON string provided')
  })

  it('throws on whitespace-only string', () => {
    expect(() => parseTweetsJson('   ')).toThrow('Empty JSON string provided')
  })

  it('throws on invalid JSON', () => {
    expect(() => parseTweetsJson('not json at all')).toThrow('Invalid JSON')
  })

  it('throws on invalid JSON after stripping archive prefix', () => {
    expect(() => parseTweetsJson('window.YTD.like.part0 = {broken')).toThrow('Invalid JSON')
  })

  it('parseTweetsWithMeta throws on empty content', () => {
    expect(() => parseTweetsWithMeta('')).toThrow('Empty content provided')
  })
})
