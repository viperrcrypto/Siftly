import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Nav from '@/components/nav'
import CommandPalette from '@/components/command-palette'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: 'Siftly',
  description: 'Your Twitter/X bookmarks and likes, organized and searchable.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      {/* Anti-flash: apply stored theme before React hydrates */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='light')document.documentElement.classList.add('light');}catch(e){}})()` }} />
      </head>
      <body className="flex min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        <Nav />
        <main className="flex-1 min-w-0 overflow-auto">
          {children}
        </main>
        <CommandPalette />
      </body>
    </html>
  )
}
