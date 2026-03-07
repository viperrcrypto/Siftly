# Siftly — Docker

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (includes Docker Compose)

---

## Quick Start

```bash
# 1. Generate migration files (one-time, run from repo root)
npx prisma migrate dev --name init

# 2. Move into the docker directory
cd docker

# 3. Copy the env template and fill in your values
cp ../.env.example .env

# 4. Build and start
docker compose up --build
```

App is available at **http://localhost:3000**

On subsequent starts (no code changes):

```bash
docker compose up
```

---

## Environment Variables

The `docker/.env` file is loaded automatically by Compose and is gitignored — your secrets stay local.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | SQLite path inside the container. Keep as `file:/data/dev.db` |
| `ANTHROPIC_CLI_KEY` | No* | Claude CLI OAuth token — use if you have a Claude subscription (see below) |
| `ANTHROPIC_API_KEY` | No* | Regular Anthropic API key — get one at console.anthropic.com |
| `ANTHROPIC_BASE_URL` | No | Override to point at a local proxy |

*AI features won't work without at least one of `ANTHROPIC_CLI_KEY` or `ANTHROPIC_API_KEY`.

**Which key should I use?**

- If you have a Claude subscription (Max, Pro, etc.) and use the CLI locally, use `ANTHROPIC_CLI_KEY` — it's free under your subscription.
- If you have a pay-as-you-go Anthropic API key (`sk-ant-api03-...`), use `ANTHROPIC_API_KEY`.

> **Note on Claude CLI auth:** Locally, the app reads your OAuth token from the macOS keychain automatically. This doesn't work inside Docker (Linux container, no keychain access). `ANTHROPIC_CLI_KEY` bridges this gap — it's the same OAuth token, but passed via env var so Docker can use it.

**Getting your CLI OAuth token:**

```bash
security find-generic-password -s "Claude Code-credentials" -w \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['claudeAiOauth']['accessToken'])"
```

Paste the output as the value of `ANTHROPIC_CLI_KEY` in `docker/.env`.

> **Token expiry:** CLI OAuth tokens expire (typically after a few hours). When you see 401 errors, re-run the command above to get a fresh token and update `docker/.env`, then `docker compose up` (no rebuild needed).

---

## How Prisma Works in This Setup

Prisma has three separate steps that run at different times:

### One-time (local) — `prisma migrate dev`

Generates SQL migration files in `prisma/migrations/` from your schema. Run this locally whenever the schema changes, then commit the migration files. These files are the source of truth for the database structure.

```bash
npx prisma migrate dev --name <description-of-change>
```

### Build time — `prisma generate`

Reads `prisma/schema.prisma` and generates TypeScript client code into `app/generated/prisma/`. Happens inside the Dockerfile — produces code only, never touches a database file.

### Startup time — `prisma migrate deploy`

Applies any pending migration files to the SQLite database on the volume. Runs in `docker-entrypoint.sh` every time the container starts, before `next start`.

**Why `migrate deploy` and not `db push`?**

`db push` is a dev tool — it diffs the entire database state against the schema and will complain about (or drop) any tables it doesn't recognise, including the app's FTS5 virtual tables (`bookmark_fts_*`) which are created via raw SQL outside of Prisma.

`migrate deploy` only runs the SQL files in `prisma/migrations/` and ignores everything else — so the FTS tables are left completely untouched.

**Why at startup and not build time?**

The SQLite database lives on a Docker volume (`/data`), which is only mounted when the container actually starts — not during the image build. Running migrations at build time would operate on a temporary layer that gets discarded.

```
local dev                →  prisma migrate dev     (generates migration SQL files)
docker build             →  prisma generate        (generates TS client code)
docker compose up        →  prisma migrate deploy  (applies pending migrations)
                         →  next start             (starts the app)
```

---

## Data Persistence

The SQLite database is stored in a named Docker volume:

```
siftly_data  →  /data/dev.db  (inside the container)
```

The volume persists across `docker compose down` and restarts. Your bookmarks are safe.

**To back up the database:**

```bash
docker run --rm \
  -v siftly_docker_siftly_data:/data \
  -v $(pwd):/backup \
  alpine cp /data/dev.db /backup/siftly-backup.db
```

**To wipe everything and start fresh:**

```bash
docker compose down -v   # -v removes the volume
```

---

## Schema Changes

1. Modify `prisma/schema.prisma` locally
2. Generate a migration: `npx prisma migrate dev --name <description>`
3. Commit the new file in `prisma/migrations/`
4. Rebuild and restart: `docker compose up --build`

The container will automatically apply the new migration on next startup.

---

## Useful Commands

```bash
# View logs
docker compose logs -f

# Stop without removing data
docker compose down

# Rebuild after code changes
docker compose up --build

# Open a shell inside the running container
docker compose exec app sh

# Run prisma studio against the live DB (from inside the container)
docker compose exec app node_modules/.bin/prisma studio
```

---

## File Reference

```
docker/
  Dockerfile            # Multi-stage build: deps + build → lean runner image
  docker-compose.yml    # Service definition, volume, port mapping
  docker-entrypoint.sh  # Runs prisma migrate deploy then next start on boot
  .env                  # Your local secrets (gitignored — never committed)
  README.md             # This file

prisma/
  schema.prisma         # Database schema (source of truth)
  migrations/           # Generated SQL migration files — commit these
```
