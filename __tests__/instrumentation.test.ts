import { afterEach, describe, expect, it, vi } from 'vitest'

const initialize = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/lib/archive/pipeline', () => ({ initializeArchiveQueue: initialize }))

import { register } from '@/instrumentation'

describe('archive instrumentation', () => {
  const runtime = process.env.NEXT_RUNTIME
  const phase = process.env.NEXT_PHASE
  afterEach(() => { process.env.NEXT_RUNTIME = runtime; process.env.NEXT_PHASE = phase; initialize.mockClear() })

  it('production buildではDB初期化を行わない', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'; process.env.NEXT_PHASE = 'phase-production-build'
    await register()
    expect(initialize).not.toHaveBeenCalled()
  })

  it('Node runtime起動時だけ初期化する', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'; delete process.env.NEXT_PHASE
    await register()
    expect(initialize).toHaveBeenCalledOnce()
  })
})
