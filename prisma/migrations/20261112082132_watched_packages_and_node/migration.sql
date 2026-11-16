-- AlterTable
ALTER TABLE "PackageRegistry" ADD COLUMN     "meta" JSONB;

-- AlterTable
ALTER TABLE "RepositorySnapshot" ADD COLUMN     "dependencies" JSONB;

-- CreateTable
CREATE TABLE "WatchedPackage" (
    "id" TEXT NOT NULL,
    "watchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchedPackage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WatchedPackage_name_idx" ON "WatchedPackage"("name");

-- CreateIndex
CREATE UNIQUE INDEX "WatchedPackage_watchId_name_key" ON "WatchedPackage"("watchId", "name");

-- AddForeignKey
ALTER TABLE "WatchedPackage" ADD CONSTRAINT "WatchedPackage_watchId_fkey" FOREIGN KEY ("watchId") REFERENCES "RepositoryWatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
