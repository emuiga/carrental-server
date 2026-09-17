import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate, requireRoles, ALL_STAFF } from "../middleware/auth";

export const customersRouter = Router();
customersRouter.use(authenticate);

const createSchema = z.object({
  fullName: z.string().min(1).max(255),
  idNumber: z.string().min(1).max(50),
  customerType: z.enum(["local", "tourist", "expat"]).default("local"),
  drivingLicense: z.string().max(50).optional(),
  licenseExpiry: z.string().datetime().optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  nextOfKinName: z.string().max(255).optional(),
  nextOfKinPhone: z.string().max(20).optional(),
  employerDetails: z.string().optional(),
});

const updateSchema = z.object({
  fullName: z.string().min(1).max(255).optional(),
  customerType: z.enum(["local", "tourist", "expat"]).optional(),
  drivingLicense: z.string().max(50).optional(),
  licenseExpiry: z.string().datetime().optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  nextOfKinName: z.string().max(255).optional(),
  nextOfKinPhone: z.string().max(20).optional(),
  employerDetails: z.string().optional(),
});

async function getCustomer(id: string, companyId: string) {
  return prisma.customer.findFirst({ where: { id, companyId, isActive: true } });
}

customersRouter.get("/", requireRoles(...ALL_STAFF), async (req, res) => {
  const session = req.user!;
  const { search, type } = req.query as Record<string, string | undefined>;

  const customers = await prisma.customer.findMany({
    where: {
      companyId: session.companyId!,
      isActive: true,
      ...(type && { customerType: type as never }),
      ...(search && {
        OR: [
          { fullName: { contains: search, mode: "insensitive" } },
          { idNumber: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ],
      }),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fullName: true,
      idNumber: true,
      customerType: true,
      phone: true,
      email: true,
      drivingLicense: true,
      licenseExpiry: true,
      createdAt: true,
    },
  });

  res.json(customers);
});

customersRouter.post("/", requireRoles(...ALL_STAFF), async (req, res) => {
  const session = req.user!;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const { idNumber, licenseExpiry, ...rest } = parsed.data;

  const existing = await prisma.customer.findFirst({ where: { idNumber, companyId: session.companyId! } });
  if (existing) return res.status(409).json({ error: "A customer with this ID number already exists" });

  const customer = await prisma.customer.create({
    data: {
      ...rest,
      idNumber,
      companyId: session.companyId!,
      ...(licenseExpiry && { licenseExpiry: new Date(licenseExpiry) }),
    },
  });

  res.status(201).json(customer);
});

customersRouter.get("/:id", requireRoles(...ALL_STAFF), async (req, res) => {
  const session = req.user!;
  const customer = await prisma.customer.findFirst({
    where: { id: req.params.id, companyId: session.companyId!, isActive: true },
    include: {
      bookings: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          startDate: true,
          endDate: true,
          status: true,
          paymentStatus: true,
          totalAmount: true,
          vehicle: { select: { registrationNumber: true, make: true, model: true } },
        },
      },
    },
  });

  if (!customer) return res.status(404).json({ error: "Customer not found" });
  res.json(customer);
});

customersRouter.patch("/:id", requireRoles(...ALL_STAFF), async (req, res) => {
  const session = req.user!;
  const customer = await getCustomer(req.params.id, session.companyId!);
  if (!customer) return res.status(404).json({ error: "Customer not found" });

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const { licenseExpiry, ...rest } = parsed.data;

  const updated = await prisma.customer.update({
    where: { id: req.params.id },
    data: { ...rest, ...(licenseExpiry && { licenseExpiry: new Date(licenseExpiry) }) },
  });

  res.json(updated);
});

customersRouter.delete("/:id", requireRoles("admin"), async (req, res) => {
  const session = req.user!;
  const customer = await getCustomer(req.params.id, session.companyId!);
  if (!customer) return res.status(404).json({ error: "Customer not found" });

  const activeBooking = await prisma.booking.findFirst({
    where: { customerId: req.params.id, companyId: session.companyId!, status: { in: ["pending", "active"] } },
  });
  if (activeBooking) {
    return res.status(409).json({ error: "Cannot delete a customer with active or pending bookings" });
  }

  await prisma.customer.update({ where: { id: req.params.id }, data: { isActive: false } });
  res.json({ message: "Customer deleted" });
});
