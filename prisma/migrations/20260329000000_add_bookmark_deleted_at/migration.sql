-- AlterTable
ALTER TABLE "Bookmark" ADD COLUMN "deletedAt" DATETIME;

-- CreateIndex
CREATE INDEX "Bookmark_deletedAt_idx" ON "Bookmark"("deletedAt");
