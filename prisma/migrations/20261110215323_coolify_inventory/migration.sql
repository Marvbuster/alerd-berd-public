-- CreateTable
CREATE TABLE "CoolifyConnection" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "tokenEncrypted" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "syncLockedUntil" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "CoolifyConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoolifyApplication" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domains" TEXT,
    "repository" TEXT,
    "branch" TEXT,
    "baseDirectory" TEXT NOT NULL DEFAULT '/',
    "reportedCommit" TEXT,
    "buildPack" TEXT,
    "status" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "missingSince" TIMESTAMP(3),

    CONSTRAINT "CoolifyApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitorCoolifyApplication" (
    "monitorId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitorCoolifyApplication_pkey" PRIMARY KEY ("monitorId","applicationId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoolifyConnection_ownerId_baseUrl_key" ON "CoolifyConnection"("ownerId", "baseUrl");

-- CreateIndex
CREATE UNIQUE INDEX "CoolifyApplication_connectionId_uuid_key" ON "CoolifyApplication"("connectionId", "uuid");

-- CreateIndex
CREATE INDEX "MonitorCoolifyApplication_applicationId_idx" ON "MonitorCoolifyApplication"("applicationId");

-- AddForeignKey
ALTER TABLE "CoolifyConnection" ADD CONSTRAINT "CoolifyConnection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoolifyApplication" ADD CONSTRAINT "CoolifyApplication_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CoolifyConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorCoolifyApplication" ADD CONSTRAINT "MonitorCoolifyApplication_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorCoolifyApplication" ADD CONSTRAINT "MonitorCoolifyApplication_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "CoolifyApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
