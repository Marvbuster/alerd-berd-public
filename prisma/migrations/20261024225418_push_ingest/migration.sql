-- AlterEnum
ALTER TYPE "MonitorKind" ADD VALUE 'PUSH';

-- AlterTable
ALTER TABLE "Monitor" ADD COLUMN     "ingestToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Monitor_ingestToken_key" ON "Monitor"("ingestToken");
