-- AlterTable
ALTER TABLE "CoolifyApplication" ADD COLUMN     "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "serviceAt" TIMESTAMP(3);

-- Bestehende Apps gelten nicht als neu.
UPDATE "CoolifyApplication" SET "firstSeenAt" = TIMESTAMP '2026-01-01 00:00:00';

-- Migration ins Dienste-Modell: Jede nicht ausgeblendete App mit verknüpftem
-- Monitor wird ein Dienst. Alle anderen liegen im Vorrat und lassen sich über
-- „Dienst anlegen“ holen. Monitore und Verknüpfungen bleiben unverändert.
UPDATE "CoolifyApplication" a SET "serviceAt" = NOW()
WHERE a."hiddenAt" IS NULL
  AND EXISTS (SELECT 1 FROM "MonitorCoolifyApplication" l WHERE l."applicationId" = a."id");
