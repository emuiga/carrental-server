/**
 * Prisma client singleton.
 *
 * In Prisma 7, the database URL is passed via a driver adapter rather than
 * schema.prisma. We use @prisma/adapter-pg backed by the `pg` Pool.
 *
 * The singleton pattern prevents creating multiple Pool/PrismaClient instances
 * during Next.js hot-reload in development.
 */

import dns from "dns";
// Force IPv4 — prevents stall on unreachable NAT64 IPv6 returned by some resolvers
dns.setDefaultResultOrder("ipv4first");

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  // family:4 forces IPv4 — avoids Node.js stalling on an unreachable NAT64
  // IPv6 address that some DNS resolvers return alongside the IPv4 address.
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL!,
    max: 10,
  });

  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
