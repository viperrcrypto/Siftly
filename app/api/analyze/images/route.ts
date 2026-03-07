import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import prisma from '@/lib/db'
import { analyzeBatch } from '@/lib/vision-analyzer'
import { createCliAnthropicClient, createEnvCliAnthropicClient } from '@/lib/claude-cli-auth'

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

  const baseURL = process.env.ANTHROPIC_BASE_URL
  // CLI auth is tried before env var so .env placeholders don't block CLI users
  const cliClient = createCliAnthropicClient(baseURL)
  const envKey = process.env.ANTHROPIC_API_KEY || ''
  const client: Anthropic = cliClient
    ?? createEnvCliAnthropicClient(baseURL)
    ?? (envKey ? new Anthropic({ apiKey: envKey, ...(baseURL ? { baseURL } : {}) }) : new Anthropic({ apiKey: '', ...(baseURL ? { baseURL } : {}) }))

  const untagged = await prisma.mediaItem.findMany({
    where: { imageTags: null, type: { in: ['photo', 'gif'] } },
    take: batchSize,
    select: { id: true, url: true, thumbnailUrl: true, type: true },
  })

  if (untagged.length === 0) {
    return NextResponse.json({ analyzed: 0, remaining: 0, message: 'All images already analyzed.' })
  }

  const analyzed = await analyzeBatch(untagged, client)

  const remaining = await prisma.mediaItem.count({
    where: { imageTags: null, type: { in: ['photo', 'gif'] } },
  })

  return NextResponse.json({ analyzed, remaining })
}
