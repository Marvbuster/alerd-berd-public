-- AlterEnum
ALTER TYPE "DependencyJobStatus" ADD VALUE 'PUBLISHING';

-- AlterTable
ALTER TABLE "DependencyJob" ADD COLUMN "preparedPath" TEXT;
ALTER TABLE "DependencyJob" ADD COLUMN "diffHash" TEXT;
ALTER TABLE "DependencyJob" ADD COLUMN "validationLog" TEXT;
ALTER TABLE "DependencyJob" ADD COLUMN "approvalAt" TIMESTAMP(3);
ALTER TABLE "DependencyJob" ADD COLUMN "publishApprovalAt" TIMESTAMP(3);
ALTER TABLE "DependencyJob" ADD COLUMN "publishedAt" TIMESTAMP(3);
ALTER TABLE "DependencyJob" ADD COLUMN "lastError" TEXT;
ALTER TABLE "ClaudeCredential" ADD COLUMN "usageCheckRequestedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "GitHubPublishCredential" (
    "ownerId" TEXT NOT NULL,
    "tokenEncrypted" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubPublishCredential_pkey" PRIMARY KEY ("ownerId")
);

-- AddForeignKey
ALTER TABLE "GitHubPublishCredential" ADD CONSTRAINT "GitHubPublishCredential_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
