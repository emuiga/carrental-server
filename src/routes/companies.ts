import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { authenticate, requireRoles, SUPERADMIN_ONLY } from "../middleware/auth";

export const companiesRouter = Router();
companiesRouter.use(authenticate, requireRoles(...SUPERADMIN_ONLY));

const createSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  subscriptionStatus: z.enum(["trial", "active", "inactive"]).default("trial"),
  enabledFeatures: z
    .object({
      sms: z.boolean().default(false),
      mpesa: z.boolean().default(false),
      reports: z.boolean().default(false),
      portal: z.boolean().default(false),
      gps: z.boolean().default(false),
    })
    .default({ sms: false, mpesa: false, reports: false, portal: false, gps: false }),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8),
  adminFirstName: z.string().min(1).max(100),
  adminLastName: z.string().min(1).max(100),
});

const updateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  subscriptionStatus: z.enum(["trial", "active", "inactive"]).optional(),
});

const featuresSchema = z.object({
  sms: z.boolean().optional(),
  mpesa: z.boolean().optional(),
  reports: z.boolean().optional(),
  portal: z.boolean().optional(),
  gps: z.boolean().optional(),
});

companiesRouter.get("/", async (req, res) => {
  const status = req.query.status as string | undefined;

  const companies = await prisma.company.findMany({
    where: status ? { subscriptionStatus: status as never } : undefined,
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { users: true, vehicles: true, customers: true, bookings: true } } },
  });

  res.json(companies);
});

companiesRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const {
    name,
    slug,
    phone,
    email,
    address,
    primaryColor,
    subscriptionStatus,
    enabledFeatures,
    adminEmail,
    adminPassword,
    adminFirstName,
    adminLastName,
  } = parsed.data;

  const existingSlug = await prisma.company.findUnique({ where: { slug } });
  if (existingSlug) return res.status(409).json({ error: "A company with this slug already exists" });

  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const result = await prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: { name, slug, phone, email, address, primaryColor, subscriptionStatus, enabledFeatures },
    });

    const admin = await tx.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        firstName: adminFirstName,
        lastName: adminLastName,
        role: "admin",
        companyId: company.id,
      },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    });

    return { company, admin };
  });

  res.status(201).json(result);
});

companiesRouter.get("/:id", async (req, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { users: true, vehicles: true, customers: true, bookings: true, payments: true } } },
  });

  if (!company) return res.status(404).json({ error: "Company not found" });
  res.json(company);
});

companiesRouter.patch("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  if (parsed.data.slug) {
    const conflict = await prisma.company.findFirst({ where: { slug: parsed.data.slug, NOT: { id: req.params.id } } });
    if (conflict) return res.status(409).json({ error: "Slug already taken" });
  }

  const company = await prisma.company.update({ where: { id: req.params.id }, data: parsed.data });
  res.json(company);
});

companiesRouter.delete("/:id", async (req, res) => {
  await prisma.company.update({ where: { id: req.params.id }, data: { subscriptionStatus: "inactive" } });
  res.json({ message: "Company deactivated" });
});

companiesRouter.get("/:id/features", async (req, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.params.id },
    select: { id: true, name: true, enabledFeatures: true },
  });
  if (!company) return res.status(404).json({ error: "Company not found" });
  res.json(company);
});

companiesRouter.put("/:id/features", async (req, res) => {
  const parsed = featuresSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const company = await prisma.company.update({
    where: { id: req.params.id },
    data: { enabledFeatures: parsed.data },
    select: { id: true, name: true, enabledFeatures: true },
  });

  res.json(company);
});

companiesRouter.patch("/:id/features", async (req, res) => {
  const parsed = featuresSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const current = await prisma.company.findUnique({ where: { id: req.params.id }, select: { enabledFeatures: true } });
  if (!current) return res.status(404).json({ error: "Company not found" });

  const merged = { ...(current.enabledFeatures as object), ...parsed.data };

  const company = await prisma.company.update({
    where: { id: req.params.id },
    data: { enabledFeatures: merged },
    select: { id: true, name: true, enabledFeatures: true },
  });

  res.json(company);
});
