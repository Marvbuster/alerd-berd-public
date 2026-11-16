-- AlterTable
ALTER TABLE "DependencyJob" ADD COLUMN "workerLockedUntil" TIMESTAMP(3);
ALTER TABLE "DependencyJob" ADD COLUMN "workerAttemptAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "DependencyJob_workerLockedUntil_idx" ON "DependencyJob"("workerLockedUntil");
