/**
 * Prisma 7 configuration file.
 *
 * - `datasource.url` is used by Prisma CLI tools (db push, migrate, studio).
 * - The runtime PrismaClient uses the driver adapter defined in lib/prisma.ts.
 *
 * Prisma 7 `env()` requires vars to be in the process environment before the
 * config is evaluated. We load `.env` explicitly so the CLI can find DATABASE_URL.
 */

// Load .env so DATABASE_URL is available when Prisma CLI evaluates this config
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "./prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL as string,
  },
});
