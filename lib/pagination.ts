export function getPageAfterDeletion(currentPage: number, totalItems: number, pageSize: number): number {
  const safePage = Math.max(currentPage, 1)
  const safePageSize = Math.max(pageSize, 1)
  const nextTotal = Math.max(totalItems - 1, 0)
  const totalPages = Math.max(1, Math.ceil(nextTotal / safePageSize))

  return Math.min(safePage, totalPages)
}
