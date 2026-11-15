-- AlterTable: add triageState for the inbox triage workflow (inbox | kept | deleted)
ALTER TABLE "Bookmark" ADD COLUMN "triageState" TEXT NOT NULL DEFAULT 'inbox';

-- CreateIndex
CREATE INDEX "Bookmark_triageState_idx" ON "Bookmark"("triageState");

-- Backfill: treat already-archived bookmarks (hidden) as decided -> kept.
UPDATE "Bookmark" SET "triageState" = 'kept' WHERE "hidden" = true;
