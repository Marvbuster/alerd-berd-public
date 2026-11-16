-- CreateEnum
CREATE TYPE "DependencyJobStatus" AS ENUM ('DRAFT', 'AWAITING_CLAUDE', 'ANALYZING', 'READY_FOR_REVIEW', 'APPROVED', 'RUNNING', 'VERIFYING', 'READY_TO_PUSH', 'PUSHED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DependencyMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateTable
CREATE TABLE "ClaudeCredential" (
    "ownerId" TEXT NOT NULL,
    "tokenEncrypted" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "ClaudeCredential_pkey" PRIMARY KEY ("ownerId")
);

-- CreateTable
CREATE TABLE "DependencyJob" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "targetVersion" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'claude-opus-4-8',
    "baseCommitSha" TEXT,
    "claudeSessionId" TEXT,
    "status" "DependencyJobStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DependencyJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DependencyMessage" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "role" "DependencyMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DependencyMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DependencyJob_ownerId_updatedAt_idx" ON "DependencyJob"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "DependencyJob_applicationId_updatedAt_idx" ON "DependencyJob"("applicationId", "updatedAt");

-- CreateIndex
CREATE INDEX "DependencyMessage_jobId_createdAt_idx" ON "DependencyMessage"("jobId", "createdAt");

-- AddForeignKey
ALTER TABLE "ClaudeCredential" ADD CONSTRAINT "ClaudeCredential_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DependencyJob" ADD CONSTRAINT "DependencyJob_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DependencyJob" ADD CONSTRAINT "DependencyJob_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "CoolifyApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DependencyMessage" ADD CONSTRAINT "DependencyMessage_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DependencyJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
