-- CreateTable
CREATE TABLE "GitHubCredential" (
    "ownerId" TEXT NOT NULL,
    "tokenEncrypted" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubCredential_pkey" PRIMARY KEY ("ownerId")
);

-- CreateTable
CREATE TABLE "RepositoryWatch" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "repository" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "manifestPath" TEXT NOT NULL,
    "lockfilePath" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "syncLockedUntil" TIMESTAMP(3),

    CONSTRAINT "RepositoryWatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepositorySnapshot" (
    "watchId" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "declaredVersion" TEXT NOT NULL,
    "lockedVersion" TEXT NOT NULL,
    "manifestHash" TEXT NOT NULL,
    "lockfileHash" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepositorySnapshot_pkey" PRIMARY KEY ("watchId")
);

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryWatch_applicationId_key" ON "RepositoryWatch"("applicationId");

-- AddForeignKey
ALTER TABLE "GitHubCredential" ADD CONSTRAINT "GitHubCredential_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryWatch" ADD CONSTRAINT "RepositoryWatch_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "CoolifyApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositorySnapshot" ADD CONSTRAINT "RepositorySnapshot_watchId_fkey" FOREIGN KEY ("watchId") REFERENCES "RepositoryWatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
