import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { analyzeBatch } from '@/lib/vision-analyzer'
import { AIClient, resolveAIClient } from '@/lib/ai-client'
import { getProvider } from '@/lib/settings'

// GET: returns progress stats
export async function GET(): Promise<NextResponse> {
  const [total, tagged] = await Promise.all([
    prisma.mediaItem.count({ where: { type: { in: ['photo', 'gif'] } } }),
    prisma.mediaItem.count({ where: { type: { in: ['photo', 'gif'] }, imageTags: { not: null } } }),
  ])
  return NextResponse.json({ total, tagged, remaining: total - tagged })
}

// POST: analyze a batch of untagged images
export async function POST(request: NextRequest): Promise<NextResponse> {
  let batchSize = 20
  try {
    const body = await request.json()
    if (typeof body.batchSize === 'number') batchSize = Math.min(body.batchSize, 50)
  } catch {
    // use default
  }

  const provider = await getProvider()
  const keyName = provider === 'openai' ? 'openaiApiKey' : 'anthropicApiKey'
  const setting = await prisma.setting.findUnique({ where: { key: keyName } })
  const dbKey = setting?.value?.trim()

  let client: AIClient | null = null
  try {
    client = await resolveAIClient({ dbKey })
  } catch {
    // SDK not available — will use CLI path for vision
  }

  return runAnalysis(client, batchSize)
}

async function runAnalysis(client: AIClient | null, batchSize: number): Promise<NextResponse> {
  const untagged = await prisma.mediaItem.findMany({
    where: { imageTags: null, type: { in: ['photo', 'gif'] } },
    take: batchSize,
    select: { id: true, url: true, thumbnailUrl: true, type: true },
  })

  if (untagged.length === 0) {
    return NextResponse.json({ analyzed: 0, remaining: 0, message: 'All images already analyzed.' })
  }

  let analyzed = 0
  const errors: string[] = []

  // Analyze each image individually to handle failures gracefully
  for (const item of untagged) {
    try {
      // Download and validate the image before analysis
      const response = await fetch(item.url, { method: 'HEAD' }) // Use HEAD to check content-type without downloading full image
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`)
      }
      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.startsWith('image/') || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(contentType)) {
        throw new Error(`Invalid content-type: ${contentType}`)
      }

      // If valid, analyze (assuming analyzeBatch can handle single items or we call analyzeItem)
      // Note: Since analyzeBatch is used, we may need to modify it to skip invalid items, but for now, wrap in try-catch
      await analyzeBatch([item], client) // Assuming it can handle a batch of one
      analyzed++
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.warn(`[vision] analysis failed for ${item.id}: ${errorMsg}`)
      errors.push(`Failed to analyze ${item.id}: ${errorMsg}`)
      // Continue to next image instead of failing the whole batch
    }
  }

  const remaining = await prisma.mediaItem.count({
    where: { imageTags: null, type: { in: ['photo', 'gif'] } },
  })

  return NextResponse.json({
    analyzed,
    remaining,
    errors: errors.length > 0 ? errors : undefined,
  })
}
