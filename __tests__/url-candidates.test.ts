import { describe, expect, it } from 'vitest'
import { urlCandidatesFrom } from '@/lib/archive/url-candidates'
import { resolveSources } from '@/lib/archive/source-resolver'

describe('URL候補とSource identity', () => {
  it('実rawの投稿URL領域だけを候補化し、aliasを保持する', () => {
    const candidates = urlCandidatesFrom({
      text: '本文 https://text.example/article',
      entities: { urls: [{ url: 'https://t.co/root', expanded_url: 'https://expanded.example/a', unwound_url: 'https://canonical.example/a' }] },
      note_tweet: {
        entities: { urls: [{ url: 'https://t.co/note', expanded_url: 'https://note.example/a' }] },
        note_tweet_results: { result: { entity_set: { urls: [{ url: 'https://t.co/graphql', expanded_url: 'https://graphql.example/a' }] } } },
      },
      legacy: { entities: { urls: [{ url: 'https://t.co/legacy', expanded_url: 'https://legacy.example/a' }] } },
      url: 'https://synthetic.example/a',
      urls: ['https://synthetic.example/b'],
      user: { url: 'https://profile.example/me' },
      core: { user_results: { result: { legacy: { url: 'https://profile.example/also-ignore' } } } },
      extended_entities: { media: [{ media_url_https: 'https://pbs.twimg.com/image.jpg' }] },
    })

    expect(candidates).toHaveLength(7)
    expect(candidates[0]).toEqual({
      originalUrl: 'https://t.co/root', expandedUrl: 'https://expanded.example/a', unwoundUrl: 'https://canonical.example/a',
      canonicalInputUrl: 'https://canonical.example/a', aliases: ['https://t.co/root', 'https://expanded.example/a', 'https://canonical.example/a'],
    })
    expect(candidates.map((candidate) => candidate.canonicalInputUrl)).toEqual([
      'https://canonical.example/a', 'https://note.example/a', 'https://graphql.example/a', 'https://legacy.example/a',
      'https://synthetic.example/a', 'https://synthetic.example/b', 'https://text.example/article',
    ])
    expect(candidates.map((candidate) => candidate.canonicalInputUrl)).not.toContain('https://profile.example/me')
  })

  it('root・self reply・quoteのaliasを1 Sourceに集約してtaxonomyを昇格する', () => {
    const sources = resolveSources([
      { id: 'root', relationship: 'root', text: '参考', urls: [{ originalUrl: 'https://t.co/a', expandedUrl: 'https://article.example/a', canonicalInputUrl: 'https://article.example/a', aliases: ['https://t.co/a', 'https://article.example/a'] }] },
      { id: 'reply', relationship: 'self_reply', text: '元記事', urls: ['https://article.example/a'] },
      { id: 'quote', relationship: 'quote', text: '公式', urls: ['https://t.co/a'] },
    ])

    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({
      sourceKey: 'url:https://article.example/a', canonicalInputUrl: 'https://article.example/a', sourceType: 'primary_source',
      originalUrl: 'https://t.co/a', expandedUrl: 'https://article.example/a', aliases: ['https://t.co/a', 'https://article.example/a'],
    })
    expect(sources[0].provenance).toEqual(expect.arrayContaining([
      expect.objectContaining({ discoveredFromPost: 'root', relationship: 'root', originalUrl: 'https://t.co/a', expandedUrl: 'https://article.example/a' }),
      expect.objectContaining({ discoveredFromPost: 'reply', relationship: 'self_reply', originalUrl: 'https://article.example/a', expandedUrl: 'https://article.example/a' }),
      expect.objectContaining({ discoveredFromPost: 'quote', relationship: 'quote', originalUrl: 'https://t.co/a', expandedUrl: 'https://t.co/a' }),
    ]))
  })

  it('外部aliasのないt.coはincidentalとして残し、X本体とCDNは除外する', () => {
    const sources = resolveSources([{ id: 'root', relationship: 'root', text: '', urls: ['https://t.co/unresolved', 'https://x.com/user/status/1', 'https://video.twimg.com/video.mp4'] }])

    expect(sources).toEqual([expect.objectContaining({ canonicalInputUrl: 'https://t.co/unresolved', sourceType: 'incidental' })])
  })
})
