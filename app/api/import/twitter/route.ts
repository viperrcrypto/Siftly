// Route Handler entry. The implementation (and the reusable
// normalizeTweetForImport helper used by tests) lives in route-logic.ts so
// this module exports ONLY the HTTP verb Next.js expects — a non-HTTP export
// from a route.ts invalidates the Route Handler at build time.
import type { NextRequest } from 'next/server'
import { POST as handlePost } from './route-logic'

export async function POST(request: NextRequest) {
  return handlePost(request)
}
