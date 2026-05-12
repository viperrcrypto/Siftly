import { NextResponse } from 'next/server'
import prisma from '@/lib/db'

/** Latest completed file import per capture type (matches live import filenames on /import). */
function jobWhereForPrefix(prefix: 'bookmarks-' | 'likes-') {
  return {
    status: 'done' as const,
    filename: { startsWith: prefix, endsWith: '.json' },
  }
}

async function firstTweetInJobWindow(
  job: { createdAt: Date; updatedAt: Date },
  source: 'bookmark' | 'like'
): Promise<string | null> {
  const row = await prisma.bookmark.findFirst({
    where: {
      source,
      importedAt: { gte: job.createdAt, lte: job.updatedAt },
    },
    orderBy: { importedAt: 'asc' },
    select: { tweetId: true },
  })
  return row?.tweetId ?? null
}

/**
 * For each of the latest `done` jobs named `bookmarks-*.json` / `likes-*.json`,
 * finds bookmarks whose `importedAt` falls in that job's `[createdAt, updatedAt]`,
 * ordered by `importedAt` ascending — returns the first row's `tweetId` per job.
 */
export async function GET(): Promise<NextResponse> {
  const [bookmarkJob, likeJob] = await Promise.all([
    prisma.importJob.findFirst({
      where: jobWhereForPrefix('bookmarks-'),
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.importJob.findFirst({
      where: jobWhereForPrefix('likes-'),
      orderBy: { updatedAt: 'desc' },
    }),
  ])

  const [bookmarkTweetId, likeTweetId] = await Promise.all([
    bookmarkJob ? firstTweetInJobWindow(bookmarkJob, 'bookmark') : Promise.resolve(null),
    likeJob ? firstTweetInJobWindow(likeJob, 'like') : Promise.resolve(null),
  ])

  return NextResponse.json({ bookmarkTweetId, likeTweetId })
}
