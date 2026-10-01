import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Nav from '@/components/nav'
import CommandPalette from '@/components/command-palette'
import { LanguageProvider } from '@/components/language-provider'
import { cookies } from 'next/headers'
import { normalizeUiLanguage, UI_LANGUAGE_COOKIE } from '@/lib/i18n'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

export async function generateMetadata(): Promise<Metadata> {
  const language = normalizeUiLanguage((await cookies()).get(UI_LANGUAGE_COOKIE)?.value)
  return {
    title: 'Siftly',
    description: language === 'ja'
      ? 'Xのブックマークを整理して検索できるローカル管理ツール。'
      : 'A local app for organizing and searching your X bookmarks.',
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const language = normalizeUiLanguage((await cookies()).get(UI_LANGUAGE_COOKIE)?.value)

  return (
    <html lang={language} className={inter.variable} suppressHydrationWarning>
      {/* Anti-flash: apply stored theme before React hydrates */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='light')document.documentElement.classList.add('light');}catch(e){}})()` }} />
      </head>
      <body className="flex min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        <LanguageProvider initialLanguage={language}>
          <Nav />
          <main className="flex-1 min-w-0 overflow-auto">
            {children}
          </main>
          <CommandPalette />
        </LanguageProvider>
      </body>
    </html>
  )
}
