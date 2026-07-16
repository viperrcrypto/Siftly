import { describe, expect, it } from 'vitest'
import quoteFixture from './fixtures/twitter-rich/quote.json'
import cardFixture from './fixtures/twitter-rich/card.json'
import articleFixture from './fixtures/twitter-rich/article.json'
import repostNoteFixture from './fixtures/twitter-rich/repost-note.json'
import noteWithUrlFixture from './fixtures/twitter-rich/note-with-url.json'
import { normalizeTweetForImport } from '@/app/api/import/twitter/route-logic'

describe('rich Twitter bookmark normalization', () => {
  it('keeps a quote separate from the bookmarked outer tweet', () => {
    const result = normalizeTweetForImport(quoteFixture)

    expect(result.tweetId).toBe('9100000000000000001')
    expect(result.authorHandle).toBe('quote_author')
    expect(result.text).toBe('A useful observation about the quoted resource')
    expect(result.entities.tweetType).toBe('quote')
    expect(result.entities.quote).toMatchObject({
      tweetId: '9100000000000000002',
      authorHandle: 'cited_author',
      text: 'https://t.co/exampleQuote',
      urls: ['https://x.com/i/article/9100000000000000003'],
    })
  })

  it('keeps expanded URLs and link-card metadata', () => {
    const result = normalizeTweetForImport(cardFixture)

    expect(result.entities.urls).toContain('https://example.com/design-guide')
    expect(result.entities.card).toMatchObject({
      type: 'summary_large_image',
      title: 'Example Design Guide',
      description: expect.stringContaining('representative field guide'),
      domain: 'example.com',
      imageUrl: expect.stringContaining('pbs.twimg.com/card_img/'),
    })
    expect(result.media).toContainEqual(expect.objectContaining({
      type: 'photo',
      url: expect.stringContaining('pbs.twimg.com/card_img/'),
    }))
  })

  it('persists the complete X Article body rather than a timeline preview', () => {
    const result = normalizeTweetForImport(articleFixture)

    expect(result.text).toContain('Example long-form article')
    expect(result.text).toContain('appears only in the hydrated article body')
    expect(result.entities.article).toMatchObject({
      articleId: '9300000000000000002',
      title: 'Example long-form article',
      body: expect.stringContaining('appears only in the hydrated article body'),
    })
    expect(result.media).toContainEqual(expect.objectContaining({
      url: 'https://pbs.twimg.com/media/example-article-cover.jpg',
    }))
  })

  it('keeps note-tweet full text and its expanded URL entities', () => {
    const result = normalizeTweetForImport(noteWithUrlFixture)

    expect(result.text).toContain('continues well past the collapsed timeline preview')
    expect(result.text).toContain('useful conclusion')
    expect(result.entities.urls).toContain('https://example.com/full-note-source')
  })

  it('preserves repost attribution and nested note-tweet text', () => {
    const result = normalizeTweetForImport(repostNoteFixture)

    expect(result.tweetId).toBe('9000000000000000001')
    expect(result.authorHandle).toBe('reposter')
    expect(result.entities.tweetType).toBe('repost')
    expect(result.entities.repost).toMatchObject({
      tweetId: '8000000000000000001',
      authorHandle: 'source',
      text: 'This is the complete long-form note-tweet text that must survive normalization.',
    })
  })
})
