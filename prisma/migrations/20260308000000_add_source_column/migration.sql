-- AlterTable: add source column missing from init migration
ALTER TABLE "Bookmark" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'bookmark';

-- CreateIndex
CREATE INDEX "Bookmark_source_idx" ON "Bookmark"("source");
