export const UI_LANGUAGE_COOKIE = 'siftly-language'
export const UI_LANGUAGE_STORAGE = 'siftly-language'

export type UiLanguage = 'ja' | 'en'

export function normalizeUiLanguage(value: unknown): UiLanguage {
  return value === 'en' ? 'en' : 'ja'
}

export function uiText(language: UiLanguage, japanese: string, english: string): string {
  return language === 'ja' ? japanese : english
}

export function uiLocale(language: UiLanguage): string {
  return language === 'ja' ? 'ja-JP' : 'en-US'
}

export function serializeUiLanguageCookie(language: UiLanguage): string {
  return `${UI_LANGUAGE_COOKIE}=${language}; Path=/; Max-Age=31536000; SameSite=Lax`
}
