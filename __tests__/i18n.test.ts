import { describe, expect, it } from 'vitest'
import { normalizeUiLanguage, serializeUiLanguageCookie, uiLocale, uiText } from '@/lib/i18n'
import { buildCategorySuggestionPrompt } from '@/lib/category-suggester'
import { buildCategorizationPrompt } from '@/lib/categorizer'

describe('i18n', () => {
  it('日本語を既定値にし、英語だけを明示的に受け入れる', () => {
    expect(normalizeUiLanguage(undefined)).toBe('ja')
    expect(normalizeUiLanguage('fr')).toBe('ja')
    expect(normalizeUiLanguage('en')).toBe('en')
  })

  it('選択言語に対応する文言とロケールを返す', () => {
    expect(uiText('ja', '設定', 'Settings')).toBe('設定')
    expect(uiText('en', '設定', 'Settings')).toBe('Settings')
    expect(uiLocale('ja')).toBe('ja-JP')
    expect(uiLocale('en')).toBe('en-US')
    expect(serializeUiLanguageCookie('en')).toBe('siftly-language=en; Path=/; Max-Age=31536000; SameSite=Lax')
  })

  it('AIカテゴリ候補の出力言語を切り替える', () => {
    const bookmarks = [{ id: 'bookmark-1', tweetId: '1', text: 'Rust tools', authorHandle: 'dev' }]
    expect(buildCategorySuggestionPrompt(bookmarks, 'ja')).toContain('日本語の簡潔で明確なカテゴリ名')
    expect(buildCategorySuggestionPrompt(bookmarks, 'en')).toContain('concise English category name')
  })

  it('AI分類本体の指示言語を切り替える', () => {
    const bookmarks = [{ tweetId: '1', text: 'Earthquake alert' }]
    expect(buildCategorizationPrompt(bookmarks, { disaster: '災害' }, ['disaster'], 'ja')).toContain('利用可能なカテゴリ')
    expect(buildCategorizationPrompt(bookmarks, { disaster: 'Disasters' }, ['disaster'], 'en')).toContain('Available categories')
  })
})
