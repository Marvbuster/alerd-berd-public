-- AlterTable
ALTER TABLE "DependencyJob" ADD COLUMN     "batchId" TEXT;

-- CreateTable
CREATE TABLE "DependencyBatch" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "pausedAt" TIMESTAMP(3),
    "pauseReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DependencyBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DependencyBatch_ownerId_createdAt_idx" ON "DependencyBatch"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "DependencyJob_batchId_idx" ON "DependencyJob"("batchId");

-- AddForeignKey
ALTER TABLE "DependencyJob" ADD CONSTRAINT "DependencyJob_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "DependencyBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DependencyBatch" ADD CONSTRAINT "DependencyBatch_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
