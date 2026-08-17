'use client'

import { useSyncExternalStore } from 'react'
import { Sun, Moon } from 'lucide-react'
import { useLanguage } from '@/components/language-provider'
import { uiText } from '@/lib/i18n'

const THEME_CHANGE_EVENT = 'siftly-theme-change'

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onChange)
  return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange)
}

function getSnapshot() {
  return document.documentElement.classList.contains('light')
}

function getServerSnapshot() {
  return false
}

export default function ThemeToggle() {
  const light = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const { language } = useLanguage()

  function toggle() {
    const next = !light
    if (next) {
      document.documentElement.classList.add('light')
      localStorage.setItem('theme', 'light')
    } else {
      document.documentElement.classList.remove('light')
      localStorage.setItem('theme', 'dark')
    }
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT))
  }

  return (
    <button
      onClick={toggle}
      title={light
        ? uiText(language, 'ダークモードに切り替え', 'Switch to dark mode')
        : uiText(language, 'ライトモードに切り替え', 'Switch to light mode')}
      aria-label={light
        ? uiText(language, 'ダークモードに切り替え', 'Switch to dark mode')
        : uiText(language, 'ライトモードに切り替え', 'Switch to light mode')}
      className="flex items-center justify-center w-7 h-7 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50 transition-all"
    >
      {light ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  )
}
