DELETE FROM "BookmarkCategory"
WHERE "bookmarkId" IN (
  SELECT "id"
  FROM "Bookmark"
  WHERE "deletedAt" IS NOT NULL
);
