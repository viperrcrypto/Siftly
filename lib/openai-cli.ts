import { copilotPrompt, getCopilotCliAuthStatus, getCopilotCliAvailability } from '@/lib/copilot-cli'
import { codexPrompt, getCodexCliAvailability } from '@/lib/codex-cli'
import { getCodexCliAuthStatus } from '@/lib/openai-auth'
import { getOpenAICliPreference } from '@/lib/settings'

export type OpenAICliKind = 'codex' | 'copilot'
export type OpenAICliPreference = 'auto' | 'codex' | 'copilot'

export interface OpenAICliPromptOptions {
  model?: string
  timeoutMs?: number
  preference?: OpenAICliPreference
}

export interface OpenAICliPromptResult {
  provider?: OpenAICliKind
  success: boolean
  data?: string
  error?: string
}

function getCliOrder(preference: OpenAICliPreference): OpenAICliKind[] {
  if (preference === 'codex') return ['codex', 'copilot']
  if (preference === 'copilot') return ['copilot', 'codex']
  return ['codex', 'copilot']
}

async function isCliInstalled(kind: OpenAICliKind): Promise<boolean> {
  return kind === 'codex' ? getCodexCliAvailability() : getCopilotCliAvailability()
}

function isCliAuthenticated(kind: OpenAICliKind): boolean {
  if (kind === 'codex') {
    const status = getCodexCliAuthStatus()
    return status.available && !status.expired
  }
  return getCopilotCliAuthStatus().available
}

export async function getPreferredOpenAICli(
  preference?: OpenAICliPreference,
): Promise<OpenAICliKind | null> {
  const resolvedPreference = preference ?? (await getOpenAICliPreference())
  const orderedKinds = getCliOrder(resolvedPreference)

  for (const kind of orderedKinds) {
    if (isCliAuthenticated(kind) && await isCliInstalled(kind)) return kind
  }
  for (const kind of orderedKinds) {
    if (await isCliInstalled(kind)) return kind
  }
  return null
}

export async function openaiCliPrompt(
  prompt: string,
  options: OpenAICliPromptOptions = {},
): Promise<OpenAICliPromptResult> {
  const preference = options.preference ?? (await getOpenAICliPreference())
  const provider = await getPreferredOpenAICli(preference)

  if (!provider) {
    return { success: false, error: 'No OpenAI CLI is available' }
  }

  if (provider === 'codex') {
    const result = await codexPrompt(prompt, { model: options.model, timeoutMs: options.timeoutMs })
    return { ...result, provider }
  }

  const result = await copilotPrompt(prompt, { timeoutMs: options.timeoutMs })
  return { ...result, provider }
}
