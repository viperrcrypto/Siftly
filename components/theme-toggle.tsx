'use client'

import { useState } from 'react'
import { Sun, Moon } from 'lucide-react'

export default function ThemeToggle() {
  const [light, setLight] = useState(() => {
    if (typeof document === 'undefined') return false
    return document.documentElement.classList.contains('light')
  })

  function toggle() {
    const next = !light
    setLight(next)
    if (next) {
      document.documentElement.classList.add('light')
      localStorage.setItem('theme', 'light')
    } else {
      document.documentElement.classList.remove('light')
      localStorage.setItem('theme', 'dark')
    }
  }

  return (
    <button
      onClick={toggle}
      title={light ? 'Switch to dark mode' : 'Switch to light mode'}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition-all hover:bg-zinc-700/50 hover:text-zinc-300"
    >
      {light ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  )
}
