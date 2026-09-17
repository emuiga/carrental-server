/**
 * Seed: creates the initial superadmin account.
 *
 * Run with:  npm run db:seed
 *
 * Override defaults with env vars:
 *   SEED_SUPERADMIN_EMAIL=... SEED_SUPERADMIN_PASSWORD=... npm run db:seed
 */

import "dotenv/config"; // load .env before anything else
import dns from "dns";
// Force IPv4 — prevents Node.js stalling on unreachable NAT64 IPv6 address
// returned by some DNS resolvers alongside the IPv4 address.
dns.setDefaultResultOrder("ipv4first");
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
});

const SUPERADMIN_EMAIL =
  process.env.SEED_SUPERADMIN_EMAIL ?? "superadmin@carrentalhq.com";
const SUPERADMIN_PASSWORD =
  process.env.SEED_SUPERADMIN_PASSWORD ?? "ChangeMe123!";
const SUPERADMIN_FIRST = process.env.SEED_SUPERADMIN_FIRST ?? "Super";
const SUPERADMIN_LAST = process.env.SEED_SUPERADMIN_LAST ?? "Admin";

async function main() {
  console.log("🌱 Seeding superadmin...");

  const existing = await prisma.user.findFirst({
    where: { email: SUPERADMIN_EMAIL, companyId: null },
  });

  if (existing) {
    console.log(`✓ Superadmin already exists: ${SUPERADMIN_EMAIL}`);
    return;
  }

  const passwordHash = await bcrypt.hash(SUPERADMIN_PASSWORD, 12);

  const user = await prisma.user.create({
    data: {
      email: SUPERADMIN_EMAIL,
      passwordHash,
      firstName: SUPERADMIN_FIRST,
      lastName: SUPERADMIN_LAST,
      role: "superadmin",
      companyId: null,
    },
    select: { id: true, email: true, role: true },
  });

  console.log("✓ Superadmin created:", user);
  console.log("\n⚠️  Change the default password immediately!");
  console.log(`   Email:    ${SUPERADMIN_EMAIL}`);
  console.log(`   Password: ${SUPERADMIN_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
