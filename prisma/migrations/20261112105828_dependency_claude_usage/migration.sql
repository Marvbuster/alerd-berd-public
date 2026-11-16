-- CreateEnum
CREATE TYPE "DependencyClaudeUsagePhase" AS ENUM ('ANALYSIS', 'FOLLOW_UP', 'LIVE_REVIEW');

-- CreateTable
CREATE TABLE "DependencyClaudeUsage" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "phase" "DependencyClaudeUsagePhase" NOT NULL,
    "model" TEXT NOT NULL,
    "sessionId" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cacheReadTokens" INTEGER,
    "cacheCreationTokens" INTEGER,
    "totalTokens" INTEGER,
    "turns" INTEGER,
    "durationMs" INTEGER,
    "reported" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DependencyClaudeUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DependencyClaudeUsage_jobId_createdAt_idx" ON "DependencyClaudeUsage"("jobId", "createdAt");

-- AddForeignKey
ALTER TABLE "DependencyClaudeUsage" ADD CONSTRAINT "DependencyClaudeUsage_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DependencyJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
