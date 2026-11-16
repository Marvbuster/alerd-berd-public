-- Modell-Alias statt fester ID: folgt dem aktuellen Opus des Abos.
ALTER TABLE "DependencyJob" ALTER COLUMN "model" SET DEFAULT 'opus';
UPDATE "DependencyJob" SET "model" = 'opus' WHERE "model" = 'claude-opus-4-8';
