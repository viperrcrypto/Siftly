export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return
  const { initializeArchiveQueue } = await import('@/lib/archive/pipeline')
  void initializeArchiveQueue().catch(() => {})
}
