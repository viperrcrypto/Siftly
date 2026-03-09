# Siftly — Claude Code Guide

Self-hosted Twitter/X bookmark manager with AI-powered categorization, search, and visualization.

## Quick Setup

```bash
# Install dependencies
npm install

# Generate Prisma client + create local SQLite database
npx prisma generate
npx prisma db push

# Start the dev server
npx next dev
```

App runs at **http://localhost:3000**

For a single command that does all of the above and opens the browser automatically:
```bash
./start.sh
```

## AI Authentication — No API Key Needed

If the user is signed into Claude Code CLI, **Siftly uses their Claude subscription automatically**. No API key configuration required.

How it works:
- `lib/claude-cli-auth.ts` reads the OAuth token from the macOS keychain (`Claude Code-credentials`)
- Uses `authToken` + `anthropic-beta: oauth-2025-04-20` header in the Anthropic SDK
- Falls back to: DB-saved API key → `ANTHROPIC_API_KEY` env var → local proxy

To verify it's working, hit: `GET /api/settings/cli-status`

## Key Commands

```bash
npx next dev          # Start dev server (port 3000)
npx tsc --noEmit      # Type check
npx prisma studio     # Database GUI
npx prisma db push    # Apply schema changes to DB
npm run build         # Production build
```

## Project Structure

```
app/
  api/
    categorize/       # 4-stage AI pipeline (start/stop/status via SSE)
    import/           # Bookmark JSON import + dedup
    search/ai/        # FTS5 + Claude semantic search
    settings/
      cli-status/     # GET — returns Claude CLI auth status
      test/           # POST — validates API key or CLI auth
    analyze/images/   # Vision analysis progress + trigger
    bookmarks/        # CRUD + filtering
    categories/       # Category management
    mindmap/          # Graph data
    stats/            # Dashboard counts
  import/             # 3-step import UI
  mindmap/            # Interactive force graph
  settings/           # API keys, model selection
  ai-search/          # Natural language search UI
  bookmarks/          # Browse + filter UI
  categorize/         # Pipeline monitor

lib/
  claude-cli-auth.ts  # Claude CLI OAuth session (macOS keychain)
  categorizer.ts      # AI categorization + default categories
  vision-analyzer.ts  # Image vision + semantic tagging
  fts.ts              # SQLite FTS5 full-text search
  rawjson-extractor.ts # Entity extraction from tweet JSON
  parser.ts           # Multi-format bookmark JSON parser
  exporter.ts         # CSV / JSON / ZIP export

prisma/schema.prisma  # SQLite schema (Bookmark, Category, MediaItem, Setting, ImportJob)
```

## Tech Stack

- **Next.js 16** (App Router, TypeScript)
- **Prisma 7** + **SQLite** (local, zero setup, FTS5 built in)
- **Anthropic SDK** — vision, tagging, categorization, search
- **@xyflow/react** — mindmap graph
- **Tailwind CSS v4**

## Environment Variables

Only `DATABASE_URL` is required. Everything else is optional:

```env
DATABASE_URL="file:./prisma/dev.db"       # required — set by default in .env
ANTHROPIC_API_KEY=sk-ant-...              # optional if Claude CLI is signed in
ANTHROPIC_BASE_URL=http://localhost:8080  # optional — for local proxies
```

## CLI for AI Agents

`cli/siftly.ts` provides direct database access without the Next.js server. Outputs JSON (pretty-printed on TTY, compact when piped). Must run from project root.

```bash
npx tsx cli/siftly.ts stats                          # Library statistics
npx tsx cli/siftly.ts categories                     # Categories with counts
npx tsx cli/siftly.ts search "AI agents"             # FTS5 keyword search
npx tsx cli/siftly.ts list --limit 5                 # Recent bookmarks
npx tsx cli/siftly.ts list --source like --category ai-resources --sort oldest
npx tsx cli/siftly.ts show <id|tweetId>              # Full bookmark detail
npm run siftly -- stats                              # Alternative via npm script
```

## Common Tasks

### Run the AI pipeline manually
POST to `/api/categorize` with `{}` body. Monitor progress via GET `/api/categorize` (returns SSE stream).

### Add a new bookmark category
Edit `DEFAULT_CATEGORIES` array in `lib/categorizer.ts`. Add name, slug, hex color, and description. The description text is passed verbatim to Claude — be specific.

### Add a known tool for entity extraction
Append a domain string to `KNOWN_TOOL_DOMAINS` in `lib/rawjson-extractor.ts`.

### Test API auth
```bash
curl -X POST http://localhost:3000/api/settings/test \
  -H "Content-Type: application/json" \
  -d '{"provider":"anthropic"}'
# Returns: {"working": true}
```

### Check Claude CLI auth status
```bash
curl http://localhost:3000/api/settings/cli-status
# Returns: {"available": true, "subscriptionType": "max", "expired": false}
```

## Database

SQLite file at `prisma/dev.db`. Schema models:

- `Bookmark` — tweet text, author, raw JSON, semantic tags, enrichment metadata
- `MediaItem` — images/videos/GIFs with AI visual tags
- `BookmarkCategory` — bookmark↔category with confidence score (0–1)
- `Category` — name, slug, color, AI description
- `Setting` — key/value store (API keys, model choice)
- `ImportJob` — import file tracking

After schema changes: `npx prisma db push`

## Author Identity

- Always use **"Viperr"** or **"viperrcrypto"** as the author/maintainer identity.
- Always use `viperrcrypto@users.noreply.github.com` as the commit email.
- X/Twitter handle is **@viperr** (not @viperrcrypto).
- Do not use any other name or identity in commits, code, comments, or documentation.
