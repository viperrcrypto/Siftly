import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { seedDefaultCategories } from '@/lib/categorizer'
import { getActiveBookmarkCountMap } from '@/lib/category-counts'

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function GET(): Promise<NextResponse> {
  try {
    // Seed defaults on first load so the nav always has categories
    const count = await prisma.category.count()
    if (count === 0) await seedDefaultCategories()

    const [categories, countMap] = await Promise.all([
      prisma.category.findMany({
        orderBy: { name: 'asc' },
      }),
      getActiveBookmarkCountMap(),
    ])

    const formatted = categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      color: cat.color,
      description: cat.description,
      isAiGenerated: cat.isAiGenerated,
      createdAt: cat.createdAt.toISOString(),
      bookmarkCount: countMap.get(cat.id) ?? 0,
    }))

    return NextResponse.json({ categories: formatted })
  } catch (err) {
    console.error('Categories fetch error:', err)
    return NextResponse.json(
      { error: `Failed to fetch categories: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { name?: string; color?: string; description?: string } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { name, color, description } = body

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return NextResponse.json(
      { error: 'Missing required field: name' },
      { status: 400 }
    )
  }

  const trimmedName = name.trim()
  const slug = generateSlug(trimmedName)

  if (!slug) {
    return NextResponse.json(
      { error: 'Invalid category name: could not generate a valid slug' },
      { status: 400 }
    )
  }

  const validColor =
    color && typeof color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(color)
      ? color
      : '#6366f1'

  try {
    const existing = await prisma.category.findFirst({
      where: { OR: [{ name: trimmedName }, { slug }] },
      select: { id: true },
    })

    if (existing) {
      return NextResponse.json(
        { error: `Category with that name or slug already exists` },
        { status: 409 }
      )
    }

    const category = await prisma.category.create({
      data: {
        name: trimmedName,
        slug,
        color: validColor,
        description: description?.trim() ?? null,
        isAiGenerated: false,
      },
    })

    return NextResponse.json(
      {
        category: {
          id: category.id,
          name: category.name,
          slug: category.slug,
          color: category.color,
          description: category.description,
          isAiGenerated: category.isAiGenerated,
          createdAt: category.createdAt.toISOString(),
          bookmarkCount: 0,
        },
      },
      { status: 201 }
    )
  } catch (err) {
    console.error('Category create error:', err)
    return NextResponse.json(
      { error: `Failed to create category: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}
