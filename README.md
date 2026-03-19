<div align="center">
  <img src="public/logo.svg" alt="Siftly" width="80" height="80" />

  <h1>Siftly</h1>

  <p><strong>Self-hosted Twitter/X bookmark manager with AI-powered organization</strong></p>

  <p>Import · Analyze · Categorize · Search · Explore</p>

  <p>
    <img src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js" alt="Next.js 16" />
    <img src="https://img.shields.io/badge/TypeScript-5-blue?style=flat-square&logo=typescript" alt="TypeScript" />
    <img src="https://img.shields.io/badge/SQLite-local-green?style=flat-square&logo=sqlite" alt="SQLite" />
    <img src="https://img.shields.io/badge/Tailwind-v4-38bdf8?style=flat-square&logo=tailwindcss" alt="Tailwind CSS" />
    <img src="https://img.shields.io/badge/license-MIT-yellow?style=flat-square" alt="MIT License" />
  </p>
</div>

---

## What is Siftly?

Siftly turns your Twitter/X bookmarks into a **searchable, categorized, visual knowledge base** — running entirely on your machine. No cloud, no subscriptions, no browser extensions required. Everything stays local except the AI API calls you configure.

It runs a **4-stage AI pipeline** on your bookmarks:

```
📥 Import (built-in bookmarklet or console script — no extensions needed)
    ↓
🏷️  Entity Extraction   — mines hashtags, URLs, mentions, and 100+ known tools from raw tweet data (free, zero API calls)
    ↓
👁️  Vision Analysis      — reads text, objects, and context from every image/GIF/video thumbnail (30–40 visual tags per image)
    ↓
🧠 Semantic Tagging     — generates 25–35 searchable tags per bookmark for AI-powered search
    ↓
📂 Categorization       — assigns each bookmark to 1–3 categories with confidence scores
```

After the pipeline runs, you get:
- **AI search** — find bookmarks by meaning, not just keywords (*"funny meme about crypto crashing"*)
- **Interactive mindmap** — explore your entire bookmark graph visually
- **Filtered browsing** — grid or list view, filter by category, media type, and date
- **Export tools** — download media, export as CSV / JSON / ZIP

---

## Quick Start

### Prerequisites

- [Node.js 18+](https://nodejs.org)
- npm (comes with Node.js)

**That's it.** If you have [Claude Code CLI](https://claude.ai/code) installed and signed in, AI features work automatically — no API key needed.

### Option A — One command (recommended)

```bash
git clone https://github.com/viperrcrypto/Siftly.git
cd Siftly
./start.sh
```

`start.sh` installs dependencies, sets up the database, checks for Claude CLI auth, and opens [http://localhost:3000](http://localhost:3000) automatically.

### Option B — Using Claude Code

If you're using [Claude Code](https://claude.ai/code) to set up the project, it will read `CLAUDE.md` and know exactly how to get started. Just open the project folder:

```bash
git clone https://github.com/viperrcrypto/Siftly.git
claude Siftly/
```

Claude Code will handle setup and start the app using your existing Claude subscription — no extra configuration needed.

### Option C — Manual setup

```bash
git clone https://github.com/viperrcrypto/Siftly.git
cd Siftly
npm install
npx prisma generate
npx prisma migrate dev --name init
npx next dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## AI Authentication

Siftly automatically detects the best available auth method — no configuration needed in the most common case.

### Priority order

| # | Method | How |
|---|--------|-----|
| 1 | **Claude Code CLI** *(zero config)* | Already signed in? Siftly reads your session from the macOS keychain automatically |
| 2 | **API key in Settings** | Open Settings in the app and paste your key |
| 3 | **`ANTHROPIC_API_KEY` env var** | Set in `.env.local` or your shell environment |
| 4 | **Local proxy** | Set `ANTHROPIC_BASE_URL` to any Anthropic-compatible endpoint |

### Claude Code CLI (no API key needed)

If you use [Claude Code](https://claude.ai/code), you're already signed in. Siftly detects your session from the macOS keychain and uses your Claude subscription (Free/Pro/Max) automatically.

The Settings page shows a green **"Claude CLI detected — no API key needed"** badge with your subscription tier when this is active.

> **Note:** This works on macOS. On Linux/Windows, add an API key in Settings instead.

### Getting an API key (if needed)

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create a new API key
3. Open Siftly → Settings → paste it in

New accounts include $5 free credit — enough for thousands of bookmarks at Haiku pricing (~$0.00025/bookmark).

---

## pi-ai (Multi-model provider)

Siftly supports a third AI provider option: **`pi-ai`**.

This uses [`@mariozechner/pi-ai`](https://github.com/badlogic/pi-mono/tree/main/packages/ai) to talk to many providers and models, including **OpenAI-compatible endpoints**.

### Configure in the UI (recommended)

1. Go to **Settings → AI Provider**
2. Select **pi-ai (Multi-model)**
3. Fill in:

| Field | Meaning |
|------:|---------|
| `pi-ai API Key` | The provider API key (if required) |
| `Provider ID` | Provider identifier supported by pi-ai (e.g. `openai`, `openrouter`, `groq`, `anthropic`, `google`, …) |
| `Model ID` | Model identifier for that provider |
| `Base URL` (optional) | For OpenAI-compatible servers (Ollama, vLLM, LM Studio, LiteLLM, custom gateways) |
| `Headers JSON` (optional) | Extra headers added to requests (JSON object) |
| `Compat JSON` (optional) | Compatibility tweaks (JSON object) |

Then click **Save pi-ai config** and use the **Test** button to verify connectivity.

### Sample configuration (LM Studio local server on M4 pro 48GB)

- Provider ID: `openai`
- Model ID: `zai-org/glm-4.6v-flash`
- Base URL: `http://127.0.0.1:1234/v1`

### Environment variable overrides

You can also override pi-ai settings via env vars (useful for Docker / deployments):

```bash
PI_AI_API_KEY=...
PI_AI_BASE_URL=...
PI_AI_HEADERS='{"Authorization":"Bearer ..."}'
PI_AI_COMPAT='{}'

# aliases also supported
PIAI_API_KEY=...
PIAI_BASE_URL=...
```

### Example presets

#### OpenAI

- Provider ID: `openai`
- Model ID: `gpt-4o-mini`
- Base URL: *(empty)*

#### OpenRouter

- Provider ID: `openrouter`
- Model ID: `openai/gpt-4o-mini` *(or any OpenRouter model slug)*
- Base URL: *(empty)*
- Headers JSON (optional):

```json
{ "HTTP-Referer": "http://localhost:3000", "X-Title": "Siftly" }
```

#### Groq

- Provider ID: `groq`
- Model ID: `llama-3.1-70b-versatile`
- Base URL: *(empty)*

#### Local OpenAI-compatible (Ollama)

This works with any server exposing an OpenAI-compatible API.

- Provider ID: `openai`
- Model ID: `llama3.1`
- Base URL: `http://localhost:11434/v1`

If your endpoint does not require a key, you can leave the API key blank.

### Smoke test

After configuring `pi-ai` in Settings:

1. Click **Test** next to your pi-ai key.
2. Run the pipeline on a small import to confirm:
   - Vision analysis
   - Semantic tags
   - Categorization

---

## Importing Your Bookmarks

Siftly has **built-in import tools** — no browser extensions required. Go to the **Import** page and choose either method:

### Method A — Bookmarklet *(Recommended)*

1. Go to **Import** in the Siftly sidebar
2. Drag the **"Export X Bookmarks"** link to your browser's bookmark bar
   *(or right-click the bookmark bar → Add Bookmark → paste the URL)*
3. Go to [x.com/i/bookmarks](https://x.com/i/bookmarks) while logged in to X
4. Click **"Export X Bookmarks"** in your bookmark bar — a purple button appears on the page
5. Click **"▶ Auto-scroll"** — the tool scrolls through and captures all your bookmarks automatically
6. When complete, click the purple **"Export N bookmarks"** button — `bookmarks.json` downloads
7. Back in Siftly → **Import** → drop or upload the file

### Method B — Browser Console Script

1. Go to [x.com/i/bookmarks](https://x.com/i/bookmarks) while logged in to X
2. Open DevTools: press `F12` (Windows/Linux) or `⌘⌥J` (Mac), then go to the **Console** tab
3. Copy the console script from the Siftly Import page, paste it into the console, and press Enter
4. Click **"▶ Auto-scroll"** and wait for all bookmarks to be captured
5. Click the export button — `bookmarks.json` downloads automatically
6. Back in Siftly → **Import** → upload the file

### Re-importing

Re-import anytime — Siftly automatically skips duplicates and only adds new bookmarks.

---

## AI Categorization

**Categorization starts automatically as soon as you import.** You can also trigger it manually from:

- The **Import** page (after upload)
- The **Mindmap** page (when bookmarks are uncategorized)
- The **Categorize** page in the sidebar

### The 4-Stage Pipeline

| Stage | What it does |
|-------|-------------|
| **Entity Extraction** | Mines hashtags, URLs, @mentions, and 100+ known tool/product names from stored tweet JSON — free, zero API calls |
| **Vision Analysis** | Analyzes every image, GIF, and video thumbnail — OCR text, objects, scene, mood, meme templates, 30–40 visual tags per image |
| **Semantic Tagging** | Generates 25–35 precise search tags per bookmark by combining tweet text + image context. Also extracts sentiment, people, and company names. |
| **Categorization** | Assigns 1–3 categories per bookmark with confidence scores using all enriched data |

The pipeline is **incremental** — if interrupted, it picks up where it left off. Use **"Re-run everything (force all)"** to re-analyze bookmarks that were already processed.

---

## Features

### 🔍 AI Search

Natural language queries across all bookmark data:

- *"funny meme about crypto crashing"*
- *"react hooks tutorial"*
- *"bitcoin price chart"*
- *"best AI coding tools"*

Searches tweet text, image OCR, visual tags, semantic tags, and categories simultaneously using a full-text search index (FTS5) + Claude semantic reranking. Results are ranked by relevance with AI-generated explanations for each match.

### 🗺️ Mindmap

Interactive force-directed graph showing all bookmarks organized by category:

- Expand/collapse any category to reveal its bookmarks
- Click a bookmark node to open the original tweet on X
- Color-coded legend by category
- If bookmarks aren't categorized yet, an inline **AI Categorize** button starts the pipeline without leaving the page

### 📚 Browse & Filter

- **Grid view** (masonry layout) or **List view**
- Filter by category, media type (photo / video), or search text
- Sort by newest or oldest
- Pagination with 24 items per page
- Active filter chips — removable individually or all at once
- Hover any card to download media or jump to the original tweet

### ⚙️ Categories

8 default categories pre-seeded with AI-readable descriptions:

| Category | Color |
|----------|-------|
| Funny Memes | Amber |
| AI Resources | Violet |
| Dev Tools | Cyan |
| Design | Pink |
| Finance & Crypto | Green |
| Productivity | Orange |
| News | Indigo |
| General | Slate |

Create custom categories with a name, color, and optional description. The description is passed directly to the AI during categorization — the more specific, the more accurate the results.

### 📤 Export

- **CSV** — spreadsheet-compatible with all fields
- **JSON** — full structured data export
- **ZIP** — exports a category's bookmarks + all media files with a `manifest.csv`

### ⌨️ Command Palette

Press `Cmd+K` (Mac) or `Ctrl+K` (Windows/Linux) to search across all bookmarks from anywhere in the app.

---

## Configuration

All settings are manageable in the **Settings** page at `/settings` or via environment variables:

| Setting | Env Var | Description |
|---------|---------|-------------|
| Anthropic API Key | `ANTHROPIC_API_KEY` | Optional if Claude CLI is signed in — otherwise required for AI features |
| API Base URL | `ANTHROPIC_BASE_URL` | Custom endpoint for proxies or local Anthropic-compatible models |
| AI Model | Settings page only | Haiku 4.5 (default, fastest/cheapest), Sonnet 4.6, Opus 4.6 |
| OpenAI Key | Settings page only | Alternative provider if no Anthropic key is set |
| Database | `DATABASE_URL` | SQLite file path (default: `file:./prisma/dev.db`) |

### Custom API Endpoint

Point Siftly at any Anthropic-compatible server:

```env
ANTHROPIC_BASE_URL=http://localhost:8080
```

---

## Architecture

```
siftly/
├── app/
│   ├── api/
│   │   ├── analyze/images/   # Batch image vision analysis (GET progress, POST run)
│   │   ├── bookmarks/        # List, filter, paginate, delete
│   │   │   └── [id]/categories/ # Per-bookmark category management
│   │   ├── categories/       # Category CRUD
│   │   │   └── [slug]/       # Individual category operations
│   │   ├── categorize/       # 4-stage AI pipeline (start, status, stop)
│   │   ├── export/           # CSV, JSON, ZIP export
│   │   ├── import/           # JSON file import with dedup + auto-pipeline trigger
│   │   │   ├── bookmarklet/  # Bookmarklet-specific import endpoint
│   │   │   └── twitter/      # Twitter-specific import endpoint
│   │   ├── link-preview/     # Server-side OG metadata scraper
│   │   ├── media/            # Media proxy/download endpoint
│   │   ├── mindmap/          # Graph nodes + edges for visualization
│   │   ├── search/ai/        # Natural language semantic search (FTS5 + Claude)
│   │   ├── settings/         # API key + model config
│   │   │   ├── cli-status/   # Claude CLI auth detection endpoint
│   │   │   └── test/         # API key validation endpoint
│   │   └── stats/            # Dashboard stats
│   ├── ai-search/            # AI search page
│   ├── bookmarks/            # Browse, filter, paginate
│   ├── categories/           # Category management
│   │   └── [slug]/           # Category detail page
│   ├── categorize/           # Pipeline monitor with live progress
│   ├── import/               # 3-step import flow (instructions → upload → categorize)
│   ├── mindmap/              # Interactive graph
│   ├── settings/             # Configuration
│   └── page.tsx              # Dashboard
│
├── components/
│   ├── mindmap/              # Mindmap canvas, nodes, edges
│   │   ├── mindmap-canvas.tsx
│   │   ├── category-node.tsx
│   │   ├── tweet-node.tsx
│   │   ├── root-node.tsx
│   │   ├── chain-edge.tsx
│   │   └── mindmap-context.ts
│   ├── command-palette.tsx   # Cmd+K global search
│   ├── nav.tsx               # Sidebar navigation
│   └── theme-toggle.tsx      # Light/dark mode
│
├── lib/
│   ├── categorizer.ts        # AI categorization logic + default categories
│   ├── claude-cli-auth.ts    # Claude CLI OAuth session detection (macOS keychain)
│   ├── vision-analyzer.ts    # Image analysis + batch semantic tagging
│   ├── image-context.ts      # Shared image context builder
│   ├── fts.ts                # SQLite FTS5 full-text search index
│   ├── rawjson-extractor.ts  # Entity extraction from raw tweet JSON
│   ├── parser.ts             # Multi-format JSON parser
│   ├── exporter.ts           # CSV, JSON, ZIP export
│   ├── types.ts              # Shared TypeScript types
│   └── db.ts                 # Prisma client singleton
│
├── prisma/
│   └── schema.prisma         # SQLite schema
│
├── start.sh                  # One-command launcher (install + DB setup + open browser)
└── CLAUDE.md                 # Instructions for Claude Code AI assistant
```

### Database Schema

```
Bookmark          — tweet text, author, date, raw JSON, semantic tags, enrichment metadata
  ├── MediaItem   — images / videos / GIFs with AI-generated image tags
  └── BookmarkCategory — category assignments with confidence scores (0–1)

Category          — name, slug, hex color, AI-readable description
Setting           — key-value store (API keys, model preferences)
ImportJob         — tracks import file status and progress
```

### Prisma + SQLite + FTS5

Siftly uses Prisma migrations for relational schema changes.
In development, run `npx prisma migrate dev --name <change-name>` when schema changes.
For runtime/prod-style startup, apply committed migrations with `npx prisma migrate deploy`.
FTS5 (`bookmark_fts`) is managed at runtime in [`lib/fts.ts`](./lib/fts.ts), not in `schema.prisma`.
This is intentional for now because Prisma does not model SQLite virtual table definitions directly.

For Prisma command and workflow details, see:
- https://www.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production
- https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/generating-prisma-client

---

## Tech Stack

| Technology | Version | Role |
|------------|---------|------|
| [Next.js](https://nextjs.org) | 16 | Full-stack framework (App Router) |
| [TypeScript](https://www.typescriptlang.org) | 5 | Type safety throughout |
| [Prisma](https://www.prisma.io) | 7 | ORM + migrations |
| [SQLite](https://sqlite.org) | — | Local database — zero setup, includes FTS5 |
| [Tailwind CSS](https://tailwindcss.com) | v4 | Styling |
| [Anthropic SDK](https://docs.anthropic.com) | — | Vision, semantic tagging, categorization, search |
| [@xyflow/react](https://xyflow.com) | 12 | Interactive mindmap graph |
| [Framer Motion](https://www.framer.com/motion/) | 12 | Animations |
| [Radix UI](https://www.radix-ui.com) | — | Accessible UI primitives |
| [JSZip](https://stuk.github.io/jszip/) | — | Category ZIP export |
| [Lucide React](https://lucide.dev) | — | Icons |

---

## Development

```bash
# One-command start (installs, sets up DB, opens browser)
./start.sh

# Or manually:
npm install
npx prisma generate
npx prisma migrate dev --name init
npx next dev

# Type check
npx tsc --noEmit

# Open database GUI
npx prisma studio

# Build for production
npm run build && npm start
```

### Customizing Categories

Edit `DEFAULT_CATEGORIES` in `lib/categorizer.ts`. Each entry needs:

```ts
{
  name: 'My Category',       // Display name
  slug: 'my-category',       // URL-safe identifier (must be unique)
  color: '#6366f1',          // Hex color shown in UI
  description: '...',        // Natural language description — used verbatim in AI prompts
}
```

The `description` field directly shapes how the AI classifies bookmarks. Be specific.

### Adding Known Tools

Add domain strings to `KNOWN_TOOL_DOMAINS` in `lib/rawjson-extractor.ts` to have the entity extractor automatically recognize links to those tools in tweet data.

---

## Privacy

- All data is stored **locally** in a SQLite file on your machine
- The only external calls are to the AI provider you configure (tweet text + image data)
- No telemetry, no tracking, no accounts required
- Your bookmarks never touch any third-party server except your configured AI endpoint

---

## Support Development

If Siftly saves you time, consider leaving a tip ☕

---

## License

MIT — see [LICENSE](LICENSE)

---

<div align="center">
  <p>Built by <a href="https://x.com/viperr">@viperr</a> · Self-hosted · No extensions · No cloud</p>
</div>
