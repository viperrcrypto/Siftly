-- Drop the legacy `hidden` flag, superseded by the triageState inbox workflow.
DROP INDEX IF EXISTS "Bookmark_hidden_idx";
ALTER TABLE "Bookmark" DROP COLUMN "hidden";
