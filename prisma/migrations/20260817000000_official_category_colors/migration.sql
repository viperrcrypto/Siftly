-- 公式カテゴリの色だけを旧デフォルトから更新する。ユーザーが変更した色は保持する。
UPDATE "Category" SET "color" = '#10b981' WHERE "slug" = 'finance-crypto' AND "color" = '#f59e0b';
UPDATE "Category" SET "color" = '#f97316' WHERE "slug" = 'productivity' AND "color" = '#a855f7';
UPDATE "Category" SET "color" = '#f59e0b' WHERE "slug" = 'funny-memes' AND "color" = '#eab308';
