'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import ThemeToggle from './theme-toggle'
import {
  LayoutDashboard,
  Upload,
  Search,
  Tag,
  GitBranch,
  Settings,
  Sparkles,
  ChevronRight,
  Command,
  Bookmark,
  Copy,
  Check,
  Coffee,
  Menu,
  X,
} from 'lucide-react'

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ size?: number; className?: string }>
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/ai-search', label: 'AI Search', icon: Sparkles },
  { href: '/bookmarks', label: 'Browse', icon: Search },
  { href: '/mindmap', label: 'Mindmap', icon: GitBranch },
  { href: '/import', label: 'Import', icon: Upload },
  { href: '/settings', label: 'Settings', icon: Settings },
]

const DONATION_ADDRESS = '0xcF10B967a9e422753812004Cd59990f62E360760'
const BUILDER_X = 'https://x.com/viperr'

interface CategoryItem {
  name: string
  slug: string
  color: string
  bookmarkCount: number
}

interface PipelineStatus {
  status: 'idle' | 'running' | 'stopping'
  stage: string | null
  done: number
  total: number
}

const PIPELINE_STAGE_LABELS: Record<string, string> = {
  vision: 'Analyzing images',
  entities: 'Extracting entities',
  enrichment: 'Generating tags',
  categorize: 'Categorizing',
  parallel: 'Processing in parallel',
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname.startsWith(href)
}

function SupportFooter({ className }: { className?: string }) {
  const [copied, setCopied] = useState(false)

  function copyAddress() {
    void navigator.clipboard.writeText(DONATION_ADDRESS).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className={`mx-3 mt-auto mb-3 border-t border-zinc-800/50 pt-3 ${className ?? ''}`}>
      <a
        href={BUILDER_X}
        target="_blank"
        rel="noopener noreferrer"
        className="mb-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-zinc-500 transition-all hover:bg-zinc-800/50 hover:text-zinc-300 group"
      >
        <span className="text-[13px]">𝕏</span>
        <span className="text-[11px] font-medium">Built by @viperr</span>
      </a>

      <div className="rounded-xl border border-zinc-700/30 bg-zinc-800/40 p-3">
        <div className="mb-2 flex items-center gap-1.5">
          <Coffee size={12} className="shrink-0 text-amber-400" />
          <span className="text-[11px] font-semibold text-zinc-300">Support Siftly</span>
        </div>
        <p className="mb-2 text-[10px] leading-relaxed text-zinc-600">
          If Siftly saves you time, consider leaving a tip ☕
        </p>
        <button
          onClick={copyAddress}
          title="Copy ETH address"
          className="group flex w-full items-center justify-between gap-1.5 rounded-lg border border-zinc-700/40 bg-zinc-900/80 px-2 py-1.5 transition-all hover:border-amber-500/40 hover:bg-zinc-900"
        >
          <span className="truncate text-[9.5px] font-mono text-zinc-500 transition-colors group-hover:text-zinc-300">
            {DONATION_ADDRESS.slice(0, 10)}…{DONATION_ADDRESS.slice(-6)}
          </span>
          {copied
            ? <Check size={11} className="shrink-0 text-emerald-400" />
            : <Copy size={11} className="shrink-0 text-zinc-600 transition-colors group-hover:text-amber-400" />
          }
        </button>
      </div>
    </div>
  )
}

function NavContent({
  pathname,
  categories,
  totalBookmarks,
  showAllCats,
  setShowAllCats,
  collectionsOpen,
  toggleCollections,
  pipeline,
  onNavigate,
  mobile,
}: {
  pathname: string
  categories: CategoryItem[]
  totalBookmarks: number | null
  showAllCats: boolean
  setShowAllCats: Dispatch<SetStateAction<boolean>>
  collectionsOpen: boolean
  toggleCollections: () => void
  pipeline: PipelineStatus | null
  onNavigate: () => void
  mobile?: boolean
}) {
  const visibleCats = showAllCats ? categories : categories.slice(0, 8)

  function openSearch() {
    onNavigate()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800/50 px-4 py-3.5">
        <Link href="/" onClick={onNavigate} className="flex min-w-0 items-center gap-3">
          <img src="/logo.svg" alt="Siftly" className="h-9 w-9 shrink-0" />
          <span className="truncate text-[17px] font-bold tracking-tight text-zinc-100">
            Sift<span style={{ color: '#F5A623' }}>ly</span>
          </span>
        </Link>
        <div className="flex shrink-0 items-center gap-1.5">
          <ThemeToggle />
        </div>
      </div>

      {pipeline && (pipeline.status === 'running' || pipeline.status === 'stopping') &&
       pathname !== '/categorize' && pathname !== '/import' && (
        <Link
          href="/categorize"
          onClick={onNavigate}
          className="mx-3 mt-2 flex items-center gap-2 rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-3 py-2 transition-colors hover:bg-indigo-500/15"
        >
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
          </span>
          <span className="truncate text-[11px] font-medium text-indigo-300">
            {pipeline.stage ? (PIPELINE_STAGE_LABELS[pipeline.stage] ?? pipeline.stage) : 'AI pipeline'}
            {pipeline.stage === 'categorize' && pipeline.total > 0
              ? ` ${pipeline.done}/${pipeline.total}`
              : '…'}
          </span>
        </Link>
      )}

      <div className="px-3 pb-1 pt-3">
        <button
          onClick={openSearch}
          className="flex w-full items-center gap-2 rounded-lg border border-zinc-700/40 bg-zinc-800/50 px-3 py-2 text-left text-xs text-zinc-500 transition-all hover:border-zinc-600/60 hover:bg-zinc-800 hover:text-zinc-300"
        >
          <Search size={12} className="shrink-0" />
          <span className="flex-1">Search…</span>
          <kbd className="flex items-center gap-0.5 font-mono text-[10px] text-zinc-600">
            <Command size={9} />K
          </kbd>
        </button>
      </div>

      <nav className="flex flex-col gap-px px-2 py-2">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href)
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all ${
                active
                  ? 'bg-blue-500/12 text-blue-400'
                  : 'text-zinc-500 hover:bg-zinc-800/70 hover:text-zinc-200'
              }`}
            >
              <Icon size={14} className="shrink-0" />
              <span className="truncate">{label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="mx-3 border-t border-zinc-800/50" />

      <div className="flex min-h-0 flex-1 flex-col px-2 py-3">
        <div className="mb-2 flex items-center justify-between px-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
              Collections
            </p>
            {typeof totalBookmarks === 'number' && totalBookmarks > 0 && (
              <p className="mt-0.5 text-[11px] text-zinc-700">
                {totalBookmarks.toLocaleString()} saved
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Link
              href="/categories"
              onClick={onNavigate}
              className="rounded p-0.5 text-zinc-700 transition-colors hover:text-zinc-400"
              title="Manage categories"
            >
              <Tag size={11} />
            </Link>
            <button
              onClick={toggleCollections}
              className="rounded p-0.5 text-zinc-600 transition-colors hover:text-zinc-400"
              aria-label={collectionsOpen ? 'Collapse collections' : 'Expand collections'}
            >
              <ChevronRight
                size={10}
                className={`transition-transform duration-200 ${collectionsOpen ? 'rotate-90' : ''}`}
              />
            </button>
          </div>
        </div>

        {categories.length > 0 && collectionsOpen && (
          <>
            <div className={`flex min-h-0 flex-1 flex-col gap-px overflow-y-auto ${mobile ? 'max-h-none' : 'max-h-64'}`}>
              {visibleCats.map((cat) => {
                const catActive = pathname === `/categories/${cat.slug}`
                return (
                  <Link
                    key={cat.slug}
                    href={`/categories/${cat.slug}`}
                    onClick={onNavigate}
                    className={`group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] font-medium transition-all ${
                      catActive
                        ? 'bg-zinc-800 text-zinc-100'
                        : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                    }`}
                  >
                    <Bookmark
                      size={12}
                      className="shrink-0 transition-colors"
                      style={{ color: cat.color, fill: cat.color }}
                    />
                    <span className="min-w-0 flex-1 truncate">{cat.name}</span>
                    <span className="shrink-0 text-[11px] font-normal tabular-nums text-zinc-600 group-hover:text-zinc-500">
                      {cat.bookmarkCount}
                    </span>
                  </Link>
                )
              })}
            </div>

            {categories.length > 8 && (
              <button
                onClick={() => setShowAllCats((v) => !v)}
                className="mt-1.5 flex items-center gap-1.5 px-2 text-[11px] text-zinc-600 transition-colors hover:text-zinc-400"
              >
                <ChevronRight
                  size={10}
                  className={`transition-transform ${showAllCats ? 'rotate-90' : ''}`}
                />
                {showAllCats ? 'Show less' : `${categories.length - 8} more`}
              </button>
            )}
          </>
        )}
      </div>
    </>
  )
}

export default function Nav() {
  const pathname = usePathname()
  const [categories, setCategories] = useState<CategoryItem[]>([])
  const [totalBookmarks, setTotalBookmarks] = useState<number | null>(null)
  const [showAllCats, setShowAllCats] = useState(false)
  const [collectionsOpen, setCollectionsOpen] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('nav-collections-open') !== 'false'
  })
  const [pipeline, setPipeline] = useState<PipelineStatus | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    function handleCleared() {
      setCategories([])
      setTotalBookmarks(0)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileOpen(false)
    }

    window.addEventListener('siftly:cleared', handleCleared)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('siftly:cleared', handleCleared)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  useEffect(() => {
    document.body.classList.toggle('siftly-nav-open', mobileOpen)
    return () => document.body.classList.remove('siftly-nav-open')
  }, [mobileOpen])

  useEffect(() => {
    fetch('/api/stats')
      .then((r) => r.json())
      .then((d: { totalBookmarks?: number }) => {
        if (d.totalBookmarks !== undefined) setTotalBookmarks(d.totalBookmarks)
      })
      .catch(() => {})

    fetch('/api/categories')
      .then((r) => r.json())
      .then((d: { categories: CategoryItem[] }) => setCategories(d.categories ?? []))
      .catch(() => {})

    function pollPipeline() {
      fetch('/api/categorize')
        .then((r) => r.json())
        .then((d: PipelineStatus) => setPipeline(d))
        .catch(() => {})
    }

    pollPipeline()
    const interval = setInterval(pollPipeline, 3000)
    return () => clearInterval(interval)
  }, [])

  function toggleCollections() {
    setCollectionsOpen((value) => {
      const next = !value
      localStorage.setItem('nav-collections-open', String(next))
      return next
    })
  }

  const commonProps = useMemo(() => ({
    pathname,
    categories,
    totalBookmarks,
    showAllCats,
    setShowAllCats,
    collectionsOpen,
    toggleCollections,
    pipeline,
  }), [pathname, categories, totalBookmarks, showAllCats, collectionsOpen, pipeline])

  return (
    <>
      <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-zinc-800/60 bg-zinc-950/90 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={() => setMobileOpen(true)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-200 transition-colors hover:bg-zinc-800"
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
            aria-controls="mobile-navigation"
          >
            <Menu size={18} />
          </button>
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <img src="/logo.svg" alt="Siftly" className="h-8 w-8 shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-100">
                Sift<span style={{ color: '#F5A623' }}>ly</span>
              </p>
              <p className="truncate text-[11px] text-zinc-500">Bookmark manager</p>
            </div>
          </Link>
        </div>
        <ThemeToggle />
      </header>

      <aside className="sticky top-0 hidden h-screen w-[228px] shrink-0 flex-col overflow-y-auto border-r border-zinc-800/50 bg-zinc-900 lg:flex">
        <NavContent {...commonProps} onNavigate={() => {}} />
        <SupportFooter />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-black/65 transition-opacity"
            aria-label="Close navigation overlay"
          />

          <aside
            id="mobile-navigation"
            className="absolute inset-y-0 left-0 flex w-[min(88vw,21rem)] max-w-full flex-col overflow-y-auto border-r border-zinc-800/60 bg-zinc-900 shadow-2xl shadow-black/50 transition-transform duration-200 ease-out"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile navigation"
          >
            <div className="flex items-center justify-end border-b border-zinc-800/50 px-3 py-3">
              <button
                onClick={() => setMobileOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-300 transition-colors hover:bg-zinc-800"
                aria-label="Close navigation"
              >
                <X size={16} />
              </button>
            </div>
            <NavContent {...commonProps} onNavigate={() => setMobileOpen(false)} mobile />
            <SupportFooter className="pb-safe" />
          </aside>
        </div>
      )}
    </>
  )
}
