-- Persist manual category corrections independently of AI confidence values.
CREATE TABLE "CategoryFeedback" (
    "bookmarkId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "action" TEXT NOT NULL CHECK ("action" IN ('include', 'exclude')),
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("bookmarkId", "categoryId"),
    CONSTRAINT "CategoryFeedback_bookmarkId_fkey" FOREIGN KEY ("bookmarkId") REFERENCES "Bookmark" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CategoryFeedback_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CategoryFeedback_updatedAt_idx" ON "CategoryFeedback"("updatedAt");
