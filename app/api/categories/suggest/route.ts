import { NextRequest, NextResponse } from 'next/server'
import {
  generateCategorySuggestions,
  createCategoryFromSuggestion,
  CategorySuggestion,
} from '@/lib/category-suggester'

export async function GET(): Promise<NextResponse> {
  try {
    const suggestions = await generateCategorySuggestions()
    return NextResponse.json({ suggestions })
  } catch (err) {
    console.error('Category suggestion error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate suggestions' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { suggestions?: CategorySuggestion[] } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { suggestions } = body
  if (!suggestions || !Array.isArray(suggestions) || suggestions.length === 0) {
    return NextResponse.json(
      { error: 'Missing required field: suggestions' },
      { status: 400 }
    )
  }

  const results = { created: 0, failed: 0, errors: [] as string[] }

  for (const suggestion of suggestions) {
    try {
      await createCategoryFromSuggestion(suggestion)
      results.created++
    } catch (err) {
      results.failed++
      results.errors.push(
        `${suggestion.name}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  return NextResponse.json({
    success: results.failed === 0,
    created: results.created,
    failed: results.failed,
    errors: results.errors,
  })
}
