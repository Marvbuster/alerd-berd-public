import { PrismaClient } from "@prisma/client";

// Singleton gegen Hot-Reload-Connection-Leaks (Dev spawnt sonst pro Reload einen Client)
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
