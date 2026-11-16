-- AlterTable
ALTER TABLE "ClaudeCredential" ADD COLUMN     "expiryWarnedDays" INTEGER;

-- AlterTable
ALTER TABLE "GitHubCredential" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "expiryCheckedAt" TIMESTAMP(3),
ADD COLUMN     "expiryWarnedDays" INTEGER;

-- AlterTable
ALTER TABLE "GitHubPublishCredential" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "expiryCheckedAt" TIMESTAMP(3),
ADD COLUMN     "expiryWarnedDays" INTEGER;
