export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { BookmarkIcon, Tag, Image, Layers, Upload, Sparkles, Search, ArrowRight, TrendingUp, Bookmark } from 'lucide-react'
import prisma from '@/lib/db'
import BookmarkCard from '@/components/bookmark-card'
import type { BookmarkWithMedia } from '@/lib/types'
import { getServerUiLanguage } from '@/lib/i18n-server'
import { uiLocale, uiText, type UiLanguage } from '@/lib/i18n'

const RECENT_QUERY = {
  where: { deletedAt: null },
  take: 6,
  orderBy: [{ tweetCreatedAt: 'desc' as const }, { importedAt: 'desc' as const }],
  include: {
    mediaItems: { select: { id: true, type: true, url: true, thumbnailUrl: true } },
    categories: {
      include: {
        category: { select: { id: true, name: true, slug: true, color: true } },
      },
    },
    categoryFeedback: { select: { categoryId: true, action: true } },
  },
}

const TOP_CATS_QUERY = {
  include: {
    _count: {
      select: {
        bookmarks: { where: { bookmark: { deletedAt: null } } },
      },
    },
  },
} as const

async function queryDashboard() {
  return Promise.all([
    prisma.bookmark.count({ where: { deletedAt: null } }),
    prisma.category.count(),
    prisma.mediaItem.count({ where: { bookmark: { deletedAt: null } } }),
    prisma.bookmark.count({ where: { categories: { none: {} }, deletedAt: null } }),
    prisma.bookmark.findMany(RECENT_QUERY),
    prisma.category.findMany(TOP_CATS_QUERY),
    prisma.bookmark.count({ where: { source: 'bookmark', deletedAt: null } }),
    prisma.bookmark.count({ where: { source: 'like', deletedAt: null } }),
  ])
}

type QueryResult = Awaited<ReturnType<typeof queryDashboard>>

function buildDashboardData(result: QueryResult) {
  const [totalBookmarks, totalCategories, totalMedia, uncategorizedCount, recentRaw, catsRaw, bookmarkSourceCount, likeSourceCount] = result

  const recentBookmarks: BookmarkWithMedia[] = recentRaw.map((b) => ({
    id: b.id,
    tweetId: b.tweetId,
    text: b.text,
    authorHandle: b.authorHandle,
    authorName: b.authorName,
    tweetCreatedAt: b.tweetCreatedAt?.toISOString() ?? null,
    importedAt: b.importedAt.toISOString(),
    mediaItems: b.mediaItems,
    categories: b.categories.map((bc) => ({
      id: bc.category.id,
      name: bc.category.name,
      slug: bc.category.slug,
      color: bc.category.color,
      confidence: null,
      manual: b.categoryFeedback.some((feedback) => feedback.categoryId === bc.category.id && feedback.action === 'include'),
    })),
    hasCategoryFeedback: b.categoryFeedback.length > 0,
  }))

  return {
    totalBookmarks,
    bookmarkSourceCount,
    likeSourceCount,
    totalCategories,
    totalMedia,
    uncategorizedCount,
    recentBookmarks,
    topCategories: catsRaw.map((c) => ({
      name: c.name,
      slug: c.slug,
      color: c.color,
      count: c._count.bookmarks,
    })).sort((a, b) => b.count - a.count).slice(0, 10),
  }
}

const EMPTY_DASHBOARD = {
  totalBookmarks: 0,
  bookmarkSourceCount: 0,
  likeSourceCount: 0,
  totalCategories: 0,
  totalMedia: 0,
  uncategorizedCount: 0,
  recentBookmarks: [] as BookmarkWithMedia[],
  topCategories: [] as { name: string; slug: string; color: string; count: number }[],
}

async function getDashboardData() {
  try {
    const result = await queryDashboard()
    return buildDashboardData(result)
  } catch {
    return EMPTY_DASHBOARD
  }
}

function getGreeting(language: UiLanguage): string {
  const hour = new Date().getHours()
  if (hour < 12) return uiText(language, 'おはようございます', 'Good morning')
  if (hour < 17) return uiText(language, 'こんにちは', 'Good afternoon')
  return uiText(language, 'こんばんは', 'Good evening')
}

function formatDate(language: UiLanguage): string {
  return new Date().toLocaleDateString(uiLocale(language), {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

interface StatCardProps {
  label: string
  value: number
  icon: React.ComponentType<{ size?: number; className?: string }>
  iconColor: string
  iconBg: string
  borderColor: string
  trend?: string
  href?: string
}

function StatCard({ label, value, icon: Icon, iconColor, iconBg, borderColor, trend, href }: StatCardProps) {
  const inner = (
    <>
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2.5 rounded-xl ${iconBg}`}>
          <Icon size={18} className={iconColor} />
        </div>
        {trend && (
          <span className="text-xs text-zinc-500 flex items-center gap-1">
            <TrendingUp size={11} />
            {trend}
          </span>
        )}
      </div>
      <p className="text-3xl font-bold text-zinc-100 mb-1 tracking-tight">{value.toLocaleString()}</p>
      <p className="text-sm text-zinc-500">{label}</p>
    </>
  )
  const cls = `bg-zinc-900 border border-zinc-800 rounded-2xl p-5 hover:border-zinc-700 transition-all duration-200 relative overflow-hidden border-t-2 ${borderColor} ${href ? 'cursor-pointer hover:bg-zinc-800/60' : ''}`
  if (href) {
    return <Link href={href} className={cls}>{inner}</Link>
  }
  return <div className={cls}>{inner}</div>
}

export default async function DashboardPage() {
  const [data, language] = await Promise.all([getDashboardData(), getServerUiLanguage()])

  if (data.totalBookmarks === 0) {
    return <EmptyState language={language} />
  }

  const categorizedCount = data.totalBookmarks - data.uncategorizedCount

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8">

      {/* Hero Section */}
      <div>
        <p className="text-sm text-zinc-500 mb-1 uppercase tracking-widest font-medium">{formatDate(language)}</p>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-zinc-100">
              {getGreeting(language)} <span className="text-indigo-400">&#128075;</span>
            </h1>
            <p className="text-zinc-400 mt-1.5">
              {uiText(language, '現在', 'You have')}{' '}
              <span className="text-zinc-100 font-semibold">{data.totalBookmarks.toLocaleString()}</span>{' '}
              {uiText(language, '件の投稿を保存しています。', 'saved posts.')}
              {data.likeSourceCount > 0 && (
                <span className="text-zinc-500">
                  {' '}{uiText(language,
                    `（ブックマーク ${data.bookmarkSourceCount.toLocaleString()}件、いいね ${data.likeSourceCount.toLocaleString()}件）`,
                    `(${data.bookmarkSourceCount.toLocaleString()} bookmarks, ${data.likeSourceCount.toLocaleString()} likes)`)}
                </span>
              )}
            </p>
          </div>
          {/* Quick Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href="/import"
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-colors"
            >
              <Upload size={15} />
              {uiText(language, '追加インポート', 'Import more')}
            </Link>
            <Link
              href="/categorize"
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl transition-colors border border-zinc-700"
            >
              <Sparkles size={15} />
              {uiText(language, 'AI分類', 'AI Categorization')}
            </Link>
            <Link
              href="/ai-search"
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-xl transition-colors"
            >
              <Search size={15} />
              {uiText(language, 'AI検索', 'AI Search')}
            </Link>
          </div>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label={data.likeSourceCount > 0
            ? uiText(language, `${data.bookmarkSourceCount.toLocaleString()}件のブックマーク・${data.likeSourceCount.toLocaleString()}件のいいね`, `${data.bookmarkSourceCount.toLocaleString()} bookmarks · ${data.likeSourceCount.toLocaleString()} likes`)
            : uiText(language, '総ブックマーク数', 'Total bookmarks')}
          value={data.totalBookmarks}
          icon={BookmarkIcon}
          iconColor="text-indigo-400"
          iconBg="bg-indigo-500/10"
          borderColor="border-t-indigo-500"
        />
        <StatCard
          label={uiText(language, '分類済み', 'Categorized')}
          value={categorizedCount}
          icon={Tag}
          iconColor="text-emerald-400"
          iconBg="bg-emerald-500/10"
          borderColor="border-t-emerald-500"
        />
        <StatCard
          label={uiText(language, 'メディア', 'Media')}
          value={data.totalMedia}
          icon={Image}
          iconColor="text-violet-400"
          iconBg="bg-violet-500/10"
          borderColor="border-t-violet-500"
        />
        <StatCard
          label={uiText(language, '未分類', 'Uncategorized')}
          value={data.uncategorizedCount}
          icon={Layers}
          iconColor="text-amber-400"
          iconBg="bg-amber-500/10"
          borderColor="border-t-amber-500"
          href="/bookmarks?uncategorized=true"
        />
      </div>

      {/* Recently Added */}
      {data.recentBookmarks.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-widest font-medium mb-0.5">{uiText(language, '最新', 'Latest')}</p>
              <h2 className="text-xl font-semibold text-zinc-100">{uiText(language, '最近追加したブックマーク', 'Recently added bookmarks')}</h2>
            </div>
            <Link
              href="/bookmarks"
              className="flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300 transition-colors font-medium"
            >
              {uiText(language, 'すべて見る', 'View all')}
              <ArrowRight size={14} />
            </Link>
          </div>
          <div className="masonry-grid">
            {data.recentBookmarks.map((bookmark) => (
              <div key={bookmark.id} className="masonry-item">
                <BookmarkCard bookmark={bookmark} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Top Categories */}
      {data.topCategories.length > 0 && (
        <section className="pb-8">
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-widest font-medium mb-0.5">{uiText(language, 'トピックから探す', 'Browse by topic')}</p>
              <h2 className="text-xl font-semibold text-zinc-100">{uiText(language, '人気のカテゴリ', 'Popular categories')}</h2>
            </div>
            <Link
              href="/categories"
              className="flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300 transition-colors font-medium"
            >
              {uiText(language, '管理', 'Manage')}
              <ArrowRight size={14} />
            </Link>
          </div>
          <div className="flex gap-2 flex-wrap">
            {data.topCategories.map((cat) => (
              <Link
                key={cat.slug}
                href={`/categories/${cat.slug}`}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/80 transition-all duration-200 text-sm group"
              >
                <Bookmark
                  size={13}
                  className="shrink-0 transition-colors"
                  style={{ color: cat.color, fill: cat.color }}
                />
                <span className="text-zinc-300 group-hover:text-zinc-100 transition-colors font-medium">{cat.name}</span>
                <span className="text-zinc-500 text-xs tabular-nums">
                  {cat.count}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function EmptyState({ language }: { language: UiLanguage }) {
  return (
    <div className="p-6 md:p-8 min-h-screen flex items-center justify-center">
      <div className="text-center max-w-md mx-auto">
        <div className="flex items-center justify-center w-20 h-20 rounded-3xl bg-indigo-500/10 mx-auto mb-6">
          <BookmarkIcon size={36} className="text-indigo-400 opacity-80" />
        </div>
        <h2 className="text-2xl font-bold text-zinc-100 mb-3">{uiText(language, 'ブックマークがありません', 'No bookmarks yet')}</h2>
        <p className="text-zinc-400 mb-8 leading-relaxed">
          {uiText(language, 'Xのブックマークをインポートして始めましょう。インポート後はAIで自動分類・整理できます。', 'Import your X bookmarks to get started, then organize them automatically with AI.')}
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/import"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition-colors"
          >
            <Upload size={16} />
            {uiText(language, 'ブックマークをインポート', 'Import bookmarks')}
          </Link>
          <Link
            href="/settings"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium text-sm transition-colors border border-zinc-700"
          >
            {uiText(language, '設定を開く', 'Open settings')}
          </Link>
        </div>
      </div>
    </div>
  )
}
