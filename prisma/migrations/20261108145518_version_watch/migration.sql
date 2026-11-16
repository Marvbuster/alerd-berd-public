-- CreateTable
CREATE TABLE "MonitorPackage" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitorPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageRegistry" (
    "name" TEXT NOT NULL,
    "distTags" JSONB,
    "versions" JSONB,
    "npmFetchedAt" TIMESTAMP(3),
    "advisoriesFetchedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackageRegistry_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "Advisory" (
    "id" TEXT NOT NULL,
    "ghsaId" TEXT NOT NULL,
    "cveId" TEXT,
    "packageName" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "ranges" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "withdrawnAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Advisory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageAlertLog" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "ghsaId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "detail" TEXT,

    CONSTRAINT "PackageAlertLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonitorPackage_name_idx" ON "MonitorPackage"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MonitorPackage_monitorId_name_key" ON "MonitorPackage"("monitorId", "name");

-- CreateIndex
CREATE INDEX "Advisory_packageName_idx" ON "Advisory"("packageName");

-- CreateIndex
CREATE UNIQUE INDEX "Advisory_ghsaId_packageName_key" ON "Advisory"("ghsaId", "packageName");

-- CreateIndex
CREATE INDEX "PackageAlertLog_sentAt_idx" ON "PackageAlertLog"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "PackageAlertLog_monitorId_ghsaId_channelId_key" ON "PackageAlertLog"("monitorId", "ghsaId", "channelId");

-- AddForeignKey
ALTER TABLE "MonitorPackage" ADD CONSTRAINT "MonitorPackage_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageAlertLog" ADD CONSTRAINT "PackageAlertLog_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageAlertLog" ADD CONSTRAINT "PackageAlertLog_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "AlertChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
