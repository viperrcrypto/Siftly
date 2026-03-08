export interface MediaItem {
  id: string
  type: string
  url: string
  thumbnailUrl: string | null
  imageTags?: string | null
}

export interface BookmarkCategory {
  id: string
  name: string
  slug: string
  color: string
  confidence: number | null
}

export interface BookmarkWithMedia {
  id: string
  tweetId: string
  text: string
  authorHandle: string
  authorName: string
  tweetCreatedAt: string | null
  importedAt?: string
  source?: string
  cleanedFromX?: string | null
  mediaItems: MediaItem[]
  categories: BookmarkCategory[]
}

export type CleanupSource = 'bookmark' | 'like' | 'all'

export interface CleanupStatus {
  running: boolean
  done: number
  total: number
  failed: number
  lastError: string | null
}

export interface Category {
  id: string
  name: string
  slug: string
  color: string
  description: string | null
  isAiGenerated: boolean
  createdAt: string
  bookmarkCount: number
}

export interface StatsResponse {
  totalBookmarks: number
  totalCategories: number
  totalMedia: number
  recentBookmarks: BookmarkWithMedia[]
  topCategories: { name: string; slug: string; color: string; count: number }[]
}

export interface BookmarksResponse {
  bookmarks: BookmarkWithMedia[]
  total: number
  page: number
  limit: number
}
