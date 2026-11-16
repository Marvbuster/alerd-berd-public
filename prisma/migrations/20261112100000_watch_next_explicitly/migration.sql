-- next ist kein Sonderfall mehr, sondern ein beobachtetes Paket wie jedes andere.
-- Bestehende Versionsüberwachungen beobachten es weiter, bis man es abwählt.
INSERT INTO "WatchedPackage" ("id", "watchId", "name", "createdAt")
SELECT 'wpnext' || substr(md5(random()::text || "id"), 1, 19), "id", 'next', CURRENT_TIMESTAMP
FROM "RepositoryWatch"
ON CONFLICT ("watchId", "name") DO NOTHING;
