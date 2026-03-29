import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getActiveBookmarkCountMap } from '@/lib/category-counts'

interface MindMapNode {
  id: string
  type: string
  data: Record<string, unknown>
  position: { x: number; y: number }
}

interface MindMapEdge {
  id: string
  source: string
  target: string
  type?: string
  style?: Record<string, unknown>
}

interface MindMapResponse {
  nodes: MindMapNode[]
  edges: MindMapEdge[]
}

const ROOT_POSITION = { x: 0, y: 0 }
const TWEET_RADIUS = 200

// Keep category nodes equidistant: radius scales with count so the gap between
// node edges stays constant (~36px) regardless of how many categories exist.
const CAT_NODE_DIAMETER = 112
const CAT_NODE_GAP = 36
const CAT_MIN_RADIUS = 200

function categoryRadius(count: number): number {
  const circumference = count * (CAT_NODE_DIAMETER + CAT_NODE_GAP)
  return Math.max(CAT_MIN_RADIUS, Math.round(circumference / (2 * Math.PI)))
}

function categoryPosition(index: number, total: number, radius: number): { x: number; y: number } {
  const angle = (2 * Math.PI * index) / total - Math.PI / 2
  return {
    x: Math.round(ROOT_POSITION.x + radius * Math.cos(angle)),
    y: Math.round(ROOT_POSITION.y + radius * Math.sin(angle)),
  }
}

function tweetPosition(
  categoryPosition: { x: number; y: number },
  index: number,
  total: number
): { x: number; y: number } {
  const angle = (2 * Math.PI * index) / Math.max(total, 1) - Math.PI / 2
  return {
    x: Math.round(categoryPosition.x + TWEET_RADIUS * Math.cos(angle)),
    y: Math.round(categoryPosition.y + TWEET_RADIUS * Math.sin(angle)),
  }
}

async function getBaseGraph(): Promise<MindMapResponse> {
  const [totalBookmarks, categories, countMap] = await Promise.all([
    prisma.bookmark.count({ where: { deletedAt: null } }),
    prisma.category.findMany({ orderBy: { name: 'asc' } }),
    getActiveBookmarkCountMap(),
  ])

  const rootNode: MindMapNode = {
    id: 'root',
    type: 'root',
    data: { label: 'My Bookmarks', count: totalBookmarks },
    position: ROOT_POSITION,
  }

  const visibleCategories = categories
    .map((cat) => ({
      ...cat,
      bookmarkCount: countMap.get(cat.id) ?? 0,
    }))
    .filter((cat) => cat.bookmarkCount > 0)
    .sort((a, b) => b.bookmarkCount - a.bookmarkCount || a.name.localeCompare(b.name))

  const radius = categoryRadius(visibleCategories.length)
  const categoryNodes: MindMapNode[] = visibleCategories.map((cat, index) => ({
    id: `cat-${cat.slug}`,
    type: 'category',
    data: {
      name: cat.name,
      slug: cat.slug,
      color: cat.color,
      count: cat.bookmarkCount,
      description: cat.description,
    },
    position: categoryPosition(index, visibleCategories.length, radius),
  }))

  const categoryEdges: MindMapEdge[] = visibleCategories.map((cat) => ({
    id: `edge-root-cat-${cat.slug}`,
    source: 'root',
    target: `cat-${cat.slug}`,
    type: 'chain',
    style: { stroke: cat.color, strokeWidth: 1.5, opacity: 1 },
  }))

  return {
    nodes: [rootNode, ...categoryNodes],
    edges: categoryEdges,
  }
}

async function getCategoryTweetNodes(categorySlug: string): Promise<MindMapResponse> {
  const category = await prisma.category.findUnique({
    where: { slug: categorySlug },
  })

  if (!category) {
    return { nodes: [], edges: [] }
  }

  const bookmarkCategories = await prisma.bookmarkCategory.findMany({
    where: {
      category: { slug: categorySlug },
      bookmark: { deletedAt: null },
    },
    select: {
      confidence: true,
      bookmark: {
        select: {
          id: true,
          tweetId: true,
          text: true,
          authorHandle: true,
          authorName: true,
          tweetCreatedAt: true,
          semanticTags: true,
          mediaItems: {
            select: { url: true, thumbnailUrl: true, type: true, imageTags: true },
            take: 1,
          },
        },
      },
    },
    orderBy: [{ confidence: 'desc' }],
    take: 66, // Max nodes across 4 rings (8+14+20+24)
  })

  const bookmarks = bookmarkCategories.map((bc) => ({ ...bc.bookmark, confidence: bc.confidence }))

  const catNodeId = `cat-${categorySlug}`
  const catPos = { x: 0, y: 0 } // Position relative to the category

  const tweetNodes: MindMapNode[] = bookmarks.map((bookmark, index) => {
    const truncatedText =
      bookmark.text.length > 80
        ? bookmark.text.slice(0, 77) + '...'
        : bookmark.text

    const firstMedia = bookmark.mediaItems[0] ?? null
    const thumbnailUrl = firstMedia?.thumbnailUrl ?? (firstMedia?.type === 'photo' ? firstMedia.url : null) ?? null

    // Extract a brief visual summary from structured imageTags for tooltip
    let visualSummary: string | null = null
    if (firstMedia?.imageTags) {
      try {
        const parsed = JSON.parse(firstMedia.imageTags) as Record<string, unknown>
        visualSummary = [parsed.scene, parsed.action].filter(Boolean).join(' — ') || null
      } catch {
        visualSummary = null
      }
    }

    return {
      id: `tweet-${bookmark.tweetId}`,
      type: 'tweet',
      data: {
        tweetId: bookmark.tweetId,
        text: truncatedText,
        authorHandle: bookmark.authorHandle,
        authorName: bookmark.authorName,
        tweetUrl: `https://twitter.com/${bookmark.authorHandle}/status/${bookmark.tweetId}`,
        thumbnailUrl,
        hasMedia: firstMedia !== null,
        mediaType: firstMedia?.type ?? null,
        tweetCreatedAt: bookmark.tweetCreatedAt?.toISOString() ?? null,
        categoryColor: category.color,
        confidence: bookmark.confidence,
        visualSummary,
      },
      position: tweetPosition(catPos, index, bookmarks.length),
    }
  })

  const tweetEdges: MindMapEdge[] = bookmarks.map((bookmark) => ({
    id: `edge-${catNodeId}-tweet-${bookmark.tweetId}`,
    source: catNodeId,
    target: `tweet-${bookmark.tweetId}`,
  }))

  return {
    nodes: tweetNodes,
    edges: tweetEdges,
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const categorySlug = searchParams.get('category')

  try {
    if (categorySlug) {
      const data = await getCategoryTweetNodes(categorySlug)
      return NextResponse.json(data)
    }

    const data = await getBaseGraph()
    return NextResponse.json(data)
  } catch (err) {
    console.error('Mindmap fetch error:', err)
    return NextResponse.json(
      { error: `Failed to build mindmap: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}
