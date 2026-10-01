import { describe, expect, it } from 'vitest'
import { getXArticleMedia, getXArticleText } from '@/lib/x-article'

describe('X Article payload normalization', () => {
  it('REST形式の本文・タイトル・画像キーを正規化する', () => {
    const tweet = {
      text: '短い投稿',
      article: {
        title: '記事タイトル',
        content_state: { blocks: [{ text: '本文1' }, { text: '本文2' }] },
        cover_media: { media_key: 'cover-key' },
        media_entities: [{ media_key: 'inline-key' }],
      },
    }

    expect(getXArticleText(tweet)).toMatchObject({
      title: '記事タイトル',
      body: '本文1\n\n本文2',
      text: '記事タイトル\n\n本文1\n\n本文2',
    })
    expect(getXArticleMedia(tweet)).toEqual([
      { mediaKey: 'cover-key' },
      { mediaKey: 'inline-key' },
    ])
  })

  it('GraphQL形式と直接URLの画像を正規化する', () => {
    const tweet = {
      article: {
        article_results: {
          result: {
            title: 'GraphQL記事',
            plain_text: 'GraphQL本文',
            cover_media: { media_info: { original_img_url: 'https://pbs.twimg.com/cover.jpg' } },
            media_entities: [{ mediaKey: 'inline-key', url: 'https://pbs.twimg.com/inline.jpg' }],
          },
        },
      },
    }

    expect(getXArticleText(tweet).text).toBe('GraphQL記事\n\nGraphQL本文')
    expect(getXArticleMedia(tweet)).toEqual([
      { url: 'https://pbs.twimg.com/cover.jpg', thumbnailUrl: 'https://pbs.twimg.com/cover.jpg' },
      { mediaKey: 'inline-key', url: 'https://pbs.twimg.com/inline.jpg', thumbnailUrl: 'https://pbs.twimg.com/inline.jpg' },
    ])
  })

  it('preview-onlyは完全なArticle本文として扱わない', () => {
    expect(getXArticleText({ article: { title: 'タイトル', preview_text: 'プレビュー本文' } })).toEqual({
      title: 'タイトル', body: '', text: 'タイトル',
    })
  })
})
