/*
  Warnings:

  - A unique constraint covering the columns `[user_id,name]` on the table `lists` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[user,device]` on the table `sessions` will be added. If there are existing duplicate values, this will fail.

*/

-- Deduplicate sessions: keep the most recently accessed session per (user, device) pair
DELETE FROM "sessions" a
USING "sessions" b
WHERE a."user" = b."user"
  AND a."device" = b."device"
  AND a."accessed_at" < b."accessed_at";

-- Deduplicate lists: keep the most recently created list per (user_id, name) pair
DELETE FROM "lists" a
USING "lists" b
WHERE a."user_id" = b."user_id"
  AND a."name" = b."name"
  AND a."id" < b."id";

-- CreateIndex
CREATE INDEX "bookmarks_user_id_idx" ON "bookmarks" USING HASH ("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "lists_user_id_name_unique" ON "lists"("user_id", "name");

-- CreateIndex
CREATE INDEX "progress_items_user_id_idx" ON "progress_items" USING HASH ("user_id");

-- CreateIndex
CREATE INDEX "sessions_user_idx" ON "sessions" USING HASH ("user");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_user_device_unique" ON "sessions"("user", "device");

-- CreateIndex
CREATE INDEX "watch_history_user_id_watched_at_idx" ON "watch_history"("user_id", "watched_at" DESC);
