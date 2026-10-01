import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execCli: vi.fn() }))

vi.mock('@/lib/cli-exec', () => ({ execCli: mocks.execCli }))

import { codexPrompt } from '@/lib/codex-cli'

describe('Codex CLI error handling', () => {
  beforeEach(() => vi.clearAllMocks())

  it('application prompts use a read-only ephemeral CLI session', async () => {
    mocks.execCli.mockRejectedValue(new Error('CLI unavailable'))

    await codexPrompt('Return JSON only', { model: 'gpt-5.6-luna', reasoningEffort: 'xhigh' })

    expect(mocks.execCli).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([
      '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral',
      '--model', 'gpt-5.6-luna', '--config', 'model_reasoning_effort="xhigh"',
    ]), expect.any(Object))
    const args = mocks.execCli.mock.calls[0][1] as string[]
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only')
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox')
  })

  it('failed command arguments never escape through the error result', async () => {
    mocks.execCli.mockRejectedValue(new Error('Command failed with PRIVATE_BOOKMARK_TEXT'))

    const result = await codexPrompt('PRIVATE_BOOKMARK_TEXT', { model: 'gpt-6-luna' })

    expect(result).toEqual({ success: false, error: 'Codex CLI request failed' })
    expect(JSON.stringify(result)).not.toContain('PRIVATE_BOOKMARK_TEXT')
  })
})
