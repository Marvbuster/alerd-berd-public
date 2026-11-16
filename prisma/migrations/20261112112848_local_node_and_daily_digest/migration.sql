-- CreateEnum
CREATE TYPE "DependencyEngine" AS ENUM ('CLAUDE', 'LOCAL_NODE');

-- CreateEnum
CREATE TYPE "LocalAnalysisTaskPhase" AS ENUM ('ANALYSIS', 'LIVE_REVIEW');

-- CreateEnum
CREATE TYPE "LocalAnalysisTaskStatus" AS ENUM ('PENDING', 'CLAIMED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "DependencyJobStatus" ADD VALUE 'AWAITING_NODE';

-- AlterTable
ALTER TABLE "DependencyJob" ADD COLUMN     "engine" "DependencyEngine" NOT NULL DEFAULT 'CLAUDE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dailyUpdateDigest" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "DailyUpdateDigest" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "detail" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyUpdateDigest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalAnalysisNode" (
    "ownerId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "nodeName" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocalAnalysisNode_pkey" PRIMARY KEY ("ownerId")
);

-- CreateTable
CREATE TABLE "LocalAnalysisTask" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "phase" "LocalAnalysisTaskPhase" NOT NULL,
    "status" "LocalAnalysisTaskStatus" NOT NULL DEFAULT 'PENDING',
    "prompt" TEXT NOT NULL,
    "result" TEXT,
    "nodeName" TEXT,
    "model" TEXT,
    "claimedAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocalAnalysisTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyUpdateDigest_day_idx" ON "DailyUpdateDigest"("day");

-- CreateIndex
CREATE UNIQUE INDEX "DailyUpdateDigest_ownerId_channelId_day_key" ON "DailyUpdateDigest"("ownerId", "channelId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "LocalAnalysisNode_apiKeyId_key" ON "LocalAnalysisNode"("apiKeyId");

-- CreateIndex
CREATE INDEX "LocalAnalysisTask_ownerId_status_createdAt_idx" ON "LocalAnalysisTask"("ownerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "LocalAnalysisTask_jobId_phase_idx" ON "LocalAnalysisTask"("jobId", "phase");

-- AddForeignKey
ALTER TABLE "LocalAnalysisNode" ADD CONSTRAINT "LocalAnalysisNode_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalAnalysisNode" ADD CONSTRAINT "LocalAnalysisNode_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalAnalysisTask" ADD CONSTRAINT "LocalAnalysisTask_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalAnalysisTask" ADD CONSTRAINT "LocalAnalysisTask_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DependencyJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
