import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

const BLOCKED_DIRS = ['/etc', '/usr', '/bin', '/sbin', '/var', '/dev', '/proc', '/sys', '/boot']

export async function GET(request: NextRequest): Promise<NextResponse> {
  const rawPath = request.nextUrl.searchParams.get('path') || os.homedir()
  const resolved = path.resolve(rawPath)

  if (BLOCKED_DIRS.some(p => resolved === p || resolved.startsWith(p + '/'))) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  try {
    const stat = await fs.stat(resolved)
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: 'Not a directory' }, { status: 400 })
    }

    const entries = await fs.readdir(resolved, { withFileTypes: true })
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(e => ({
        name: e.name,
        path: path.join(resolved, e.name),
      }))

    return NextResponse.json({
      current: resolved,
      parent: path.dirname(resolved) !== resolved ? path.dirname(resolved) : null,
      directories: dirs,
    })
  } catch {
    return NextResponse.json({ error: 'Cannot read directory' }, { status: 400 })
  }
}
