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
  description: 'Your Twitter bookmarks, organized and searchable.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='light')document.documentElement.classList.add('light');}catch(e){}})()` }} />
      </head>
      <body className="flex min-h-screen flex-col overflow-x-hidden bg-zinc-950 text-zinc-100 antialiased lg:flex-row">
        <Nav />
        <main className="flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
          {children}
        </main>
        <CommandPalette />
      </body>
    </html>
  )
}
