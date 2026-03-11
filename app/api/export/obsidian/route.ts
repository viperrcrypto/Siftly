import { NextRequest, NextResponse } from 'next/server'
import { exportToObsidian } from '@/lib/obsidian-exporter'
import prisma from '@/lib/db'

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { category?: string; overwrite?: boolean } = {}
  try {
    body = await request.json()
  } catch {
    // body stays as defaults
  }

  const { category, overwrite = false } = body

  const setting = await prisma.setting.findUnique({ where: { key: 'obsidianVaultPath' } })
  if (!setting?.value) {
    return NextResponse.json(
      { error: 'Obsidian vault path not configured. Add it in Settings.' },
      { status: 400 }
    )
  }

  try {
    const result = await exportToObsidian({
      vaultPath: setting.value,
      subfolder: 'Twitter Bookmarks',
      overwrite,
      categoryFilter: category,
    })
    return NextResponse.json(result)
  } catch (err: unknown) {
    console.error('Obsidian export error:', err)
    return NextResponse.json(
      { error: `Export failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}
