'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  UI_LANGUAGE_STORAGE,
  serializeUiLanguageCookie,
  type UiLanguage,
} from '@/lib/i18n'

interface LanguageContextValue {
  language: UiLanguage
  setLanguage: (language: UiLanguage) => void
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

function persistLanguage(language: UiLanguage) {
  localStorage.setItem(UI_LANGUAGE_STORAGE, language)
  document.cookie = serializeUiLanguageCookie(language)
  document.documentElement.lang = language
}

export function LanguageProvider({
  initialLanguage,
  children,
}: {
  initialLanguage: UiLanguage
  children: React.ReactNode
}) {
  const router = useRouter()
  const [language, setLanguageState] = useState(initialLanguage)

  const setLanguage = useCallback((next: UiLanguage) => {
    persistLanguage(next)
    setLanguageState(next)
    router.refresh()
  }, [router])

  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage(): LanguageContextValue {
  const value = useContext(LanguageContext)
  if (!value) throw new Error('useLanguage must be used inside LanguageProvider')
  return value
}
