import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import Anthropic from '@anthropic-ai/sdk'

interface ClaudeOAuthCredentials {
  accessToken: string
  refreshToken: string
  expiresAt: number
  subscriptionType: string
  rateLimitTier: string
}

/**
 * Reads Claude Code CLI credentials.
 * - macOS: reads from the system keychain
 * - Linux: reads from ~/.claude/.credentials.json
 * Returns null if CLI not installed or not logged in.
 */
function readCliCredentials(): ClaudeOAuthCredentials | null {
  try {
    let raw: string | null = null

    if (process.platform === 'darwin') {
      raw = execSync('security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null', {
        encoding: 'utf8',
        timeout: 3000,
      }).trim()
    } else if (process.platform === 'linux') {
      const credPath = join(homedir(), '.claude', '.credentials.json')
      raw = readFileSync(credPath, 'utf8').trim()
    } else {
      return null
    }

    if (!raw) return null

    const parsed = JSON.parse(raw)
    const oauth = parsed?.claudeAiOauth
    if (!oauth?.accessToken) return null

    return oauth as ClaudeOAuthCredentials
  } catch (err) {
    console.warn('[claude-cli-auth] Failed to read credentials:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Returns a valid OAuth access token from the logged-in Claude CLI session.
 * Returns null if not available or expired.
 *
 * The token must be used with:
 *   Authorization: Bearer <token>
 *   anthropic-beta: oauth-2025-04-20
 */
export function getCliOAuthToken(): string | null {
  const creds = readCliCredentials()
  if (!creds) return null

  // Token expired — user needs to run `claude` to refresh
  if (Date.now() > creds.expiresAt) return null

  return creds.accessToken
}

/**
 * Creates an Anthropic client using the logged-in Claude CLI session.
 * Uses the OAuth Bearer token flow with the required anthropic-beta header.
 * Returns null if CLI auth is not available.
 */
export function createCliAnthropicClient(baseURL?: string): Anthropic | null {
  const token = getCliOAuthToken()
  if (!token) return null

  return new Anthropic({
    authToken: token,
    defaultHeaders: {
      // Required header to enable OAuth token auth with the Anthropic API
      'anthropic-beta': 'oauth-2025-04-20',
    },
    ...(baseURL ? { baseURL } : {}),
  })
}

/**
 * Returns auth status for the settings UI.
 */
export function getCliAuthStatus(): {
  available: boolean
  subscriptionType?: string
  expired?: boolean
} {
  const creds = readCliCredentials()
  if (!creds) return { available: false }

  const expired = Date.now() > creds.expiresAt
  return {
    available: true,
    subscriptionType: creds.subscriptionType,
    expired,
  }
}
