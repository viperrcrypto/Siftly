import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getKeyboardPageChange } from '@/lib/keyboard-page-navigation'

describe('キーボードによるページ移動', () => {
  it('左右キーだけをページ境界内で移動に変換する', () => {
    expect(getKeyboardPageChange('ArrowLeft', 2, 3)).toBe(1)
    expect(getKeyboardPageChange('ArrowRight', 2, 3)).toBe(3)
    expect(getKeyboardPageChange('ArrowRight', 2, 3, true)).toBeNull()
    expect(getKeyboardPageChange('ArrowLeft', 1, 3)).toBeNull()
    expect(getKeyboardPageChange('ArrowRight', 3, 3)).toBeNull()
    expect(getKeyboardPageChange('Enter', 2, 3)).toBeNull()
  })

  it('両一覧画面で操作中の要素を除外する', () => {
    const navigation = readFileSync('lib/keyboard-page-navigation.ts', 'utf8')
    const bookmarks = readFileSync('app/bookmarks/page.tsx', 'utf8')
    const category = readFileSync('app/categories/[slug]/page.tsx', 'utf8')

    expect(navigation).toContain('a, input, textarea, select, button, dialog, [role="button"], [role="dialog"], [role="option"], [role="menuitem"], [data-page-navigation-lock]')
    expect(navigation).toContain('target instanceof HTMLElement && target.isContentEditable')
    expect(bookmarks).toContain('isKeyboardPageNavigationTarget(event.target)')
    expect(category).toContain('isKeyboardPageNavigationTarget(event.target)')
    expect(bookmarks).toContain('getKeyboardPageChange(event.key, filters.page, totalPages, event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)')
    expect(category).toContain('getKeyboardPageChange(event.key, page, totalPages, event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)')
  })
})
