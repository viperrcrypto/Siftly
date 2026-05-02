import type { NextRequest } from 'next/server'

/**
 * Resolve the externally-visible origin for the current request.
 *
 * When Siftly is deployed behind a reverse proxy (Cloudflare Tunnel, nginx, Caddy, Traefik),
 * `req.nextUrl.protocol`/`host` reflect the internal listener (e.g. `http://siftly:3000`),
 * which produces wrong OAuth `redirect_uri` values. This helper prefers, in order:
 *   1. `PUBLIC_BASE_URL` env var (explicit override)
 *   2. `Forwarded` header (RFC 7239)
 *   3. `X-Forwarded-Proto` + `X-Forwarded-Host`
 *   4. `req.nextUrl` (direct hit, no proxy)
 */
export function getPublicOrigin(req: NextRequest): string {
  const override = process.env.PUBLIC_BASE_URL?.trim()
  if (override) return override.replace(/\/+$/, '')

  const forwarded = req.headers.get('forwarded')
  if (forwarded) {
    const protoMatch = forwarded.match(/proto=([^;,\s]+)/i)
    const hostMatch = forwarded.match(/host=([^;,\s]+)/i)
    const proto = protoMatch?.[1]?.replace(/"/g, '')
    const host = hostMatch?.[1]?.replace(/"/g, '')
    if (proto && host) return `${proto}://${host}`
  }

  const xfProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const xfHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    ?? req.headers.get('host')
  if (xfProto && xfHost) return `${xfProto}://${xfHost}`

  const protocol = req.nextUrl.protocol.replace(/:$/, '')
  return `${protocol}://${req.nextUrl.host}`
}
