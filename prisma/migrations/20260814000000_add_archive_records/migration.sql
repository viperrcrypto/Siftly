-- CreateTable
CREATE TABLE "ArchiveRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookmarkId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "lastError" TEXT,
    "pipelineVersion" TEXT NOT NULL DEFAULT '1',
    "resultJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ArchiveRecord_bookmarkId_fkey" FOREIGN KEY ("bookmarkId") REFERENCES "Bookmark" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveRecord_bookmarkId_key" ON "ArchiveRecord"("bookmarkId");
CREATE INDEX "ArchiveRecord_status_idx" ON "ArchiveRecord"("status");

-- Backfill one pending archive record for every existing bookmark.
INSERT INTO "ArchiveRecord" ("id", "bookmarkId", "updatedAt")
SELECT lower(hex(randomblob(16))), "id", CURRENT_TIMESTAMP FROM "Bookmark";

ALTER TABLE "MediaItem" ADD COLUMN "mediaKey" TEXT;
ALTER TABLE "MediaItem" ADD COLUMN "sourceTweetId" TEXT;
ALTER TABLE "MediaItem" ADD COLUMN "sourceTweetUrl" TEXT;
ALTER TABLE "MediaItem" ADD COLUMN "sourceMediaIndex" INTEGER;
ALTER TABLE "MediaItem" ADD COLUMN "sourceAuthorId" TEXT;
ALTER TABLE "MediaItem" ADD COLUMN "sourceAuthorHandle" TEXT;
ALTER TABLE "MediaItem" ADD COLUMN "downloadStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "MediaItem" ADD COLUMN "downloadError" TEXT;
ALTER TABLE "MediaItem" ADD COLUMN "downloadedAt" DATETIME;
ALTER TABLE "MediaItem" ADD COLUMN "fileSize" INTEGER;
ALTER TABLE "MediaItem" ADD COLUMN "contentHash" TEXT;
-- Merge useful fields into the deterministic keeper before dropping duplicates.
UPDATE "MediaItem" AS keep
SET
  "thumbnailUrl" = COALESCE("thumbnailUrl", (SELECT d."thumbnailUrl" FROM "MediaItem" d WHERE d."bookmarkId" = keep."bookmarkId" AND d."url" = keep."url" AND d."thumbnailUrl" IS NOT NULL ORDER BY d."id" LIMIT 1)),
  "localPath" = COALESCE("localPath", (SELECT d."localPath" FROM "MediaItem" d WHERE d."bookmarkId" = keep."bookmarkId" AND d."url" = keep."url" AND d."localPath" IS NOT NULL ORDER BY d."id" LIMIT 1)),
  "imageTags" = COALESCE("imageTags", (SELECT d."imageTags" FROM "MediaItem" d WHERE d."bookmarkId" = keep."bookmarkId" AND d."url" = keep."url" AND d."imageTags" IS NOT NULL ORDER BY d."id" LIMIT 1)),
  "mediaKey" = COALESCE("mediaKey", (SELECT d."mediaKey" FROM "MediaItem" d WHERE d."bookmarkId" = keep."bookmarkId" AND d."url" = keep."url" AND d."mediaKey" IS NOT NULL ORDER BY d."id" LIMIT 1)),
  "sourceTweetId" = COALESCE("sourceTweetId", (SELECT d."sourceTweetId" FROM "MediaItem" d WHERE d."bookmarkId" = keep."bookmarkId" AND d."url" = keep."url" AND d."sourceTweetId" IS NOT NULL ORDER BY d."id" LIMIT 1)),
  "sourceTweetUrl" = COALESCE("sourceTweetUrl", (SELECT d."sourceTweetUrl" FROM "MediaItem" d WHERE d."bookmarkId" = keep."bookmarkId" AND d."url" = keep."url" AND d."sourceTweetUrl" IS NOT NULL ORDER BY d."id" LIMIT 1)),
  "sourceMediaIndex" = COALESCE("sourceMediaIndex", (SELECT d."sourceMediaIndex" FROM "MediaItem" d WHERE d."bookmarkId" = keep."bookmarkId" AND d."url" = keep."url" AND d."sourceMediaIndex" IS NOT NULL ORDER BY d."id" LIMIT 1)),
  "sourceAuthorId" = COALESCE("sourceAuthorId", (SELECT d."sourceAuthorId" FROM "MediaItem" d WHERE d."bookmarkId" = keep."bookmarkId" AND d."url" = keep."url" AND d."sourceAuthorId" IS NOT NULL ORDER BY d."id" LIMIT 1)),
  "sourceAuthorHandle" = COALESCE("sourceAuthorHandle", (SELECT d."sourceAuthorHandle" FROM "MediaItem" d WHERE d."bookmarkId" = keep."bookmarkId" AND d."url" = keep."url" AND d."sourceAuthorHandle" IS NOT NULL ORDER BY d."id" LIMIT 1)),
  "downloadStatus" = CASE WHEN "downloadStatus" = 'pending' THEN COALESCE((SELECT d."downloadStatus" FROM "MediaItem" d WHERE d."bookmarkId" = keep."bookmarkId" AND d."url" = keep."url" AND d."downloadStatus" <> 'pending' ORDER BY d."id" LIMIT 1), "downloadStatus") ELSE "downloadStatus" END,
  "downloadError" = COALESCE("downloadError", (SELECT d."downloadError" FROM "MediaItem" d WHERE d."bookmarkId" = keep."bookmarkId" AND d."url" = keep."url" AND d."downloadError" IS NOT NULL ORDER BY d."id" LIMIT 1)),
  "downloadedAt" = COALESCE("downloadedAt", (SELECT d."downloadedAt" FROM "MediaItem" d WHERE d."bookmarkId" = keep."bookmarkId" AND d."url" = keep."url" AND d."downloadedAt" IS NOT NULL ORDER BY d."id" LIMIT 1)),
  "fileSize" = COALESCE("fileSize", (SELECT d."fileSize" FROM "MediaItem" d WHERE d."bookmarkId" = keep."bookmarkId" AND d."url" = keep."url" AND d."fileSize" IS NOT NULL ORDER BY d."id" LIMIT 1)),
  "contentHash" = COALESCE("contentHash", (SELECT d."contentHash" FROM "MediaItem" d WHERE d."bookmarkId" = keep."bookmarkId" AND d."url" = keep."url" AND d."contentHash" IS NOT NULL ORDER BY d."id" LIMIT 1))
WHERE keep."id" = (SELECT MIN(d."id") FROM "MediaItem" d WHERE d."bookmarkId" = keep."bookmarkId" AND d."url" = keep."url");
DELETE FROM "MediaItem"
WHERE EXISTS (SELECT 1 FROM "MediaItem" keep WHERE keep."bookmarkId" = "MediaItem"."bookmarkId" AND keep."url" = "MediaItem"."url" AND keep."id" < "MediaItem"."id");
CREATE UNIQUE INDEX "MediaItem_bookmarkId_url_key" ON "MediaItem"("bookmarkId", "url");

-- Legacy imports are root-tweet media.  Stable row-id ordering supplies a deterministic source index.
UPDATE "MediaItem" AS media
SET
  "sourceTweetId" = (SELECT bookmark."tweetId" FROM "Bookmark" bookmark WHERE bookmark."id" = media."bookmarkId"),
  "sourceTweetUrl" = (SELECT 'https://x.com/' || bookmark."authorHandle" || '/status/' || bookmark."tweetId" FROM "Bookmark" bookmark WHERE bookmark."id" = media."bookmarkId"),
  "sourceMediaIndex" = (SELECT COUNT(*) FROM "MediaItem" earlier WHERE earlier."bookmarkId" = media."bookmarkId" AND earlier."id" < media."id"),
  "sourceAuthorHandle" = (SELECT bookmark."authorHandle" FROM "Bookmark" bookmark WHERE bookmark."id" = media."bookmarkId")
WHERE EXISTS (SELECT 1 FROM "Bookmark" bookmark WHERE bookmark."id" = media."bookmarkId");
CREATE UNIQUE INDEX "MediaItem_bookmarkId_sourceTweetId_sourceMediaIndex_key" ON "MediaItem"("bookmarkId", "sourceTweetId", "sourceMediaIndex");
