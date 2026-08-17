const INTERACTIVE_SELECTOR = 'a, input, textarea, select, button, dialog, [role="button"], [role="dialog"], [role="option"], [role="menuitem"], [data-page-navigation-lock]'

export function isKeyboardPageNavigationTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return (target instanceof HTMLElement && target.isContentEditable) || Boolean(target.closest(INTERACTIVE_SELECTOR))
}

export function getKeyboardPageChange(key: string, page: number, totalPages: number, hasModifier = false): number | null {
  if (hasModifier) return null
  if (key === 'ArrowLeft' && page > 1) return page - 1
  if (key === 'ArrowRight' && page < totalPages) return page + 1
  return null
}
