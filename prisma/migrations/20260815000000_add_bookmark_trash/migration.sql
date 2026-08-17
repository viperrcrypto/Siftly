ALTER TABLE "Bookmark" ADD COLUMN "deletedAt" DATETIME;
CREATE INDEX "Bookmark_deletedAt_idx" ON "Bookmark"("deletedAt");
