# Contributing to Siftly

Thank you for your interest in contributing! Here's how to get started.

## Development Setup

1. Fork and clone the repo
2. Install dependencies: `npm install`
3. Set up the database:
   - `npx prisma generate`
   - `npx prisma migrate dev --name init`
4. Copy the env example: `cp .env.example .env.local`
5. Add your Anthropic API key to `.env.local`
6. Run the dev server: `npm run dev`

## Project Structure

- `app/` — Next.js pages and API routes
- `lib/` — Core logic (AI pipeline, database helpers)
- `components/` — Reusable UI components
- `prisma/` — Database schema

## Making Changes

- **AI prompts**: Edit in `lib/categorizer.ts` and `lib/vision-analyzer.ts`
- **Categories**: Add to `DEFAULT_CATEGORIES` in `lib/categorizer.ts`
- **Tool detection**: Add domains to `KNOWN_TOOL_DOMAINS` in `lib/rawjson-extractor.ts`
- **UI**: Components are in `components/`, pages in `app/`

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include a clear description of what changed and why
- Test that the AI pipeline still runs end-to-end
- Run `npx tsc --noEmit` before submitting to catch type errors

## Good First Contributions

- Add entries to `KNOWN_TOOL_DOMAINS` in `lib/rawjson-extractor.ts`
- Add new default categories with descriptions in `lib/categorizer.ts`
- Improve AI prompts for better accuracy
- Add new export formats
- Improve the mindmap visualization
- Add keyboard shortcuts

## Reporting Issues

Please open a GitHub issue with:
- Steps to reproduce
- Expected vs actual behavior
- Your OS and Node.js version
- Any relevant error messages from the browser console or terminal
