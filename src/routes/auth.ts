import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { signSessionToken, signPendingToken, verifyPendingToken } from "../lib/jwt";
import { authenticate, requireRoles, MANAGERS_UP } from "../middleware/auth";

export const authRouter = Router();

async function findLoginUser(email: string, companySlug?: string) {
  if (companySlug) {
    const company = await prisma.company.findUnique({
      where: { slug: companySlug },
      select: { id: true, subscriptionStatus: true },
    });
    if (!company || company.subscriptionStatus === "inactive") return null;

    return prisma.user.findFirst({
      where: { email, companyId: company.id, isActive: true },
      include: { company: { select: { slug: true } } },
    });
  }

  return prisma.user.findFirst({
    where: { email, role: "superadmin", companyId: null, isActive: true },
  });
}

// ── POST /auth/login ──────────────────────────────────────────────────────────
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  companySlug: z.string().optional(),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request body" });

  const { email, password, companySlug } = parsed.data;

  const user = await findLoginUser(email, companySlug);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const validPassword = await bcrypt.compare(password, user.passwordHash);
  if (!validPassword) return res.status(401).json({ error: "Invalid credentials" });

  if (user.twoFactorEnabled) {
    return res.json({ requires2FA: true, pendingToken: signPendingToken(user.id) });
  }

  const companySlugValue =
    "company" in user && user.company ? (user.company as { slug: string }).slug : null;

  const sessionUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    companyId: user.companyId,
    firstName: user.firstName,
    lastName: user.lastName,
    companySlug: companySlugValue,
  };

  const token = signSessionToken(sessionUser);
  res.json({ ok: true, token, user: sessionUser });
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────
// Stateless JWT — nothing to invalidate server-side. Frontend just discards the token.
authRouter.post("/logout", (_req, res) => res.json({ ok: true }));

// ── POST /auth/2fa/verify ─────────────────────────────────────────────────────
const verifySchema = z.object({
  pendingToken: z.string().min(1),
  code: z.string().length(6),
});

authRouter.post("/2fa/verify", async (req, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request" });

  const userId = verifyPendingToken(parsed.data.pendingToken);
  if (!userId) return res.status(401).json({ error: "Invalid or expired token" });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { company: { select: { slug: true } } },
  });

  if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
    return res.status(401).json({ error: "Invalid session" });
  }

  const isValid = authenticator.verify({ token: parsed.data.code, secret: user.twoFactorSecret });
  if (!isValid) return res.status(400).json({ error: "Invalid code" });

  const companySlug = user.company?.slug ?? null;
  const sessionUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    companyId: user.companyId,
    firstName: user.firstName,
    lastName: user.lastName,
    companySlug,
  };

  const token = signSessionToken(sessionUser);
  res.json({ ok: true, token, user: sessionUser });
});

// ── GET /auth/2fa/setup ───────────────────────────────────────────────────────
authRouter.get("/2fa/setup", authenticate, async (req, res) => {
  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(req.user!.email, "CarRental HQ", secret);
  const qrCode = await QRCode.toDataURL(otpauth);
  res.json({ secret, otpauth, qrCode });
});

// ── POST /auth/2fa/enable ─────────────────────────────────────────────────────
const enableSchema = z.object({ secret: z.string().min(1), code: z.string().length(6) });

authRouter.post("/2fa/enable", authenticate, async (req, res) => {
  const parsed = enableSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request" });

  const { secret, code } = parsed.data;
  const isValid = authenticator.verify({ token: code, secret });
  if (!isValid) return res.status(400).json({ error: "Invalid code" });

  await prisma.user.update({
    where: { id: req.user!.id },
    data: { twoFactorSecret: secret, twoFactorEnabled: true },
  });

  res.json({ ok: true });
});

// ── POST /auth/2fa/disable ────────────────────────────────────────────────────
const disableSchema = z.object({ code: z.string().length(6) });

authRouter.post("/2fa/disable", authenticate, async (req, res) => {
  const parsed = disableSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request" });

  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { twoFactorSecret: true, twoFactorEnabled: true },
  });

  if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
    return res.status(400).json({ error: "2FA is not enabled" });
  }

  const isValid = authenticator.verify({ token: parsed.data.code, secret: user.twoFactorSecret });
  if (!isValid) return res.status(400).json({ error: "Invalid code" });

  await prisma.user.update({
    where: { id: req.user!.id },
    data: { twoFactorSecret: null, twoFactorEnabled: false },
  });

  res.json({ ok: true });
});

// ── POST /auth/register ───────────────────────────────────────────────────────
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  role: z.enum(["admin", "manager", "staff"]),
  companyId: z.string().uuid().optional(),
});

authRouter.post("/register", authenticate, requireRoles(...MANAGERS_UP), async (req, res) => {
  const session = req.user!;
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const { email, password, firstName, lastName, role, companyId } = parsed.data;

  let targetCompanyId: string;
  if (session.role === "superadmin") {
    if (!companyId) {
      return res.status(400).json({ error: "companyId is required when registering as superadmin" });
    }
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) return res.status(404).json({ error: "Company not found" });
    targetCompanyId = companyId;
  } else {
    targetCompanyId = session.companyId!;
    if (role === "admin" && session.role !== "admin") {
      return res.status(403).json({ error: "Only admins can create other admin accounts" });
    }
  }

  const existing = await prisma.user.findFirst({ where: { email, companyId: targetCompanyId } });
  if (existing) {
    return res.status(409).json({ error: "A user with this email already exists in this company" });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      firstName,
      lastName,
      role: role as UserRole,
      companyId: targetCompanyId,
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      companyId: true,
      createdAt: true,
    },
  });

  res.status(201).json(user);
});
