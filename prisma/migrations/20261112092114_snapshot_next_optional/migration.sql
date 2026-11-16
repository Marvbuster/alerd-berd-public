-- AlterTable
ALTER TABLE "RepositorySnapshot" ALTER COLUMN "declaredVersion" DROP NOT NULL,
ALTER COLUMN "lockedVersion" DROP NOT NULL;
