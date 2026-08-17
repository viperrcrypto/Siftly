import { describe, expect, it } from 'vitest'
import { extractLinkPreviewUrls } from '@/lib/link-preview-url'

describe('ブックマーク本文のプレビューURL抽出', () => {
  it('t.coを優先する', () => {
    expect(extractLinkPreviewUrls('記事 https://t.co/abc123 と https://example.com/article')).toEqual(['https://t.co/abc123'])
  })

  it('t.coでないYouTubeなどの外部URLも抽出する', () => {
    expect(extractLinkPreviewUrls('動画 https://www.youtube.com/watch?v=abc12345678')).toEqual(['https://www.youtube.com/watch?v=abc12345678'])
  })

  it('X内部リンクと末尾記号を除外し、最大3件にする', () => {
    expect(extractLinkPreviewUrls('https://x.com/a/status/1 https://example.com/a。 https://note.com/a https://zenn.dev/a https://example.org/extra')).toEqual([
      'https://example.com/a',
      'https://note.com/a',
      'https://zenn.dev/a',
    ])
  })
})
