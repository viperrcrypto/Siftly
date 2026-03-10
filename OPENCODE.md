# Siftly — OpenCode Edition

Self-hosted Twitter/X bookmark manager with AI-powered categorization, search, and visualization.

**This version is configured for OpenCode integration.**

## Quick Setup

```bash
./start.sh            # installs deps, sets up DB, opens browser
```

Or manually:

```bash
npm install
npx prisma generate && npx prisma db push
npx next dev
```

App runs at **http://localhost:3000**

## AI Authentication — OpenCode Integration

This Siftly installation is configured to work with **OpenCode**, the AI coding assistant.

### Automatic Detection

Siftly automatically detects OpenCode authentication from `~/.config/opencode/auth.json`:

- **OpenCode API Key** — reads `opencode.key` from your OpenCode config
- **OpenAI Token** — reads `openai.access` or `openai.key` from OpenCode config
- **GitHub Copilot** — (if available)

### Configuration Options

1. **OpenCode Provider** (Recommended)
   - Go to **Settings** in Siftly
   - Select **OpenCode** as the AI provider
   - No API key needed if OpenCode is installed — Siftly reads auth automatically

2. **Manual OpenCode Key**
   - If auto-detection doesn't work, get your OpenCode API key from `~/.config/opencode/auth.json`
   - Add it to Settings → OpenCode API Key

3. **Fallback: Anthropic/OpenAI**
   - If you prefer, you can still use Anthropic or OpenAI directly
   - Select the provider in Settings and add your API key

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
    search/ai/        # FTS5 + semantic search
    settings/
      cli-status/     # GET — returns AI auth status (includes OpenCode)
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
  opencode-auth.ts   # OpenCode auth detection (~/.config/opencode/auth.json)
  claude-cli-auth.ts # Claude CLI OAuth session
  openai-auth.ts     # OpenAI/Codex CLI auth
  ai-client.ts       # Unified AI client (Anthropic/OpenAI/OpenCode)
  categorizer.ts     # AI categorization + default categories
  vision-analyzer.ts # Image vision + semantic tagging
  fts.ts             # SQLite FTS5 full-text search
  rawjson-extractor.ts # Entity extraction from tweet JSON
  parser.ts          # Multi-format bookmark JSON parser
  exporter.ts        # CSV / JSON / ZIP export
  settings.ts        # Settings cache + provider selection

prisma/schema.prisma  # SQLite schema (Bookmark, Category, MediaItem, Setting, ImportJob)
```

## AI Providers

Siftly now supports three AI providers:

| Provider | Auth Method | Auto-Detection |
|----------|-------------|----------------|
| **OpenCode** | `~/.config/opencode/auth.json` | Yes |
| **Anthropic** | Claude CLI or API key | Yes (Claude CLI) |
| **OpenAI** | Codex CLI or API key | Yes (Codex CLI) |

Switch providers in **Settings** without losing data.

## Environment Variables

```bash
# Database (optional, has default)
DATABASE_URL="file:./prisma/dev.db"

# OpenCode base URL (optional, has default)
OPENCODE_BASE_URL="https://api.opencode.ai/v1"
```

## CLI Tool

`cli/siftly.ts` provides direct database access without the Next.js server:

```bash
npx tsx cli/siftly.ts stats                          # Library statistics
npx tsx cli/siftly.ts categories                     # Categories with counts
npx tsx cli/siftly.ts search "AI agents"             # FTS5 keyword search
npx tsx cli/siftly.ts list --limit 5                 # Recent bookmarks
npx tsx cli/siftly.ts show <id|tweetId>              # Full bookmark detail
npm run siftly -- stats                              # Alternative via npm script
```

## Common Tasks

| Task | How |
|------|-----|
| Run AI pipeline | `POST /api/categorize` with `{}` body; `GET /api/categorize` for SSE progress |
| Add category | Edit `DEFAULT_CATEGORIES` in `lib/categorizer.ts` |
| Add known tool | Append domain to `KNOWN_TOOL_DOMAINS` in `lib/rawjson-extractor.ts` |
| Test OpenCode auth | `POST /api/settings/test` with `{"provider":"opencode"}` |
| Check CLI auth | `GET /api/settings/cli-status` |
| Switch AI provider | Go to Settings → Provider → Select OpenCode/Anthropic/OpenAI |

## Database

SQLite at `prisma/dev.db`. After schema changes: `npx prisma db push`

Models: `Bookmark`, `MediaItem`, `BookmarkCategory`, `Category`, `Setting`, `ImportJob`

## OpenCode-Specific Changes

1. **New Files:**
   - `lib/opencode-auth.ts` — Reads OpenCode auth from `~/.config/opencode/auth.json`

2. **Modified Files:**
   - `lib/ai-client.ts` — Added OpenCode provider support
   - `lib/settings.ts` — Added 'opencode' provider type
   - `app/api/settings/route.ts` — Added OpenCode model/key endpoints
   - `app/api/settings/test/route.ts` — Added OpenCode test
   - `app/api/settings/cli-status/route.ts` — Added OpenCode status

3. **Models Supported:**
   - `gpt-4.1-mini` (default)
   - `gpt-4.1`
   - `claude-haiku-4-5-20251001`
   - `claude-sonnet-4-6`

## Troubleshooting

**OpenCode not detected?**
- Check `~/.config/opencode/auth.json` exists
- Verify the file has `opencode.key` or `openai.access` fields
- Try restarting Siftly after OpenCode login

**API errors?**
- Check Settings → Test API Key
- Verify your OpenCode subscription/plan has API access
- Check browser console for detailed error messages

---

*Built by @viperr • OpenCode Integration by OpenCode*
