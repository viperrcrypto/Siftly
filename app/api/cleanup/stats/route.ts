import { NextResponse } from 'next/server'
import prisma from '@/lib/db'

export async function GET(): Promise<NextResponse> {
  const [uncleanedBookmarks, uncleanedLikes] = await Promise.all([
    prisma.bookmark.count({ where: { cleanedFromX: null, source: 'bookmark' } }),
    prisma.bookmark.count({ where: { cleanedFromX: null, source: 'like' } }),
  ])

  return NextResponse.json({
    uncleaned: uncleanedBookmarks + uncleanedLikes,
    uncleanedBookmarks,
    uncleanedLikes,
  })
}
