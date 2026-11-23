-- AlterTable
ALTER TABLE "DependencyBatch" ADD COLUMN     "notifiedStage" TEXT,
ADD COLUMN     "seenAt" TIMESTAMP(3);
