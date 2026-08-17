'use client'

import { Languages } from 'lucide-react'
import { useLanguage } from '@/components/language-provider'
import { uiText } from '@/lib/i18n'

export default function LanguageToggle() {
  const { language, setLanguage } = useLanguage()
  const next = language === 'ja' ? 'en' : 'ja'
  const label = uiText(language, '表示を英語に切り替え', 'Switch display to Japanese')

  return (
    <button
      type="button"
      onClick={() => setLanguage(next)}
      title={label}
      aria-label={label}
      className="flex h-7 items-center justify-center gap-1 rounded-lg px-1.5 text-[10px] font-semibold text-zinc-500 transition-all hover:bg-zinc-700/50 hover:text-zinc-300"
    >
      <Languages size={13} aria-hidden="true" />
      {language === 'ja' ? 'JA' : 'EN'}
    </button>
  )
}
