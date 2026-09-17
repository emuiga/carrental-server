import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate, requireRoles, ALL_STAFF, COMPANY_ADMINS } from "../middleware/auth";

export const vehiclesRouter = Router();
vehiclesRouter.use(authenticate);

const createSchema = z.object({
  registrationNumber: z.string().min(1).max(20),
  make: z.string().min(1).max(100),
  model: z.string().min(1).max(100),
  year: z.number().int().min(1990).max(new Date().getFullYear() + 1),
  category: z.enum(["small", "sedan", "suv", "van", "seven_seater"]),
  dailyRate: z.number().positive(),
  mileage: z.number().int().min(0).optional(),
  color: z.string().max(50).optional(),
  fuelType: z.string().max(20).optional(),
  transmission: z.string().max(20).optional(),
  seats: z.number().int().min(1).max(30).optional(),
  notes: z.string().optional(),
});

const updateSchema = z.object({
  make: z.string().min(1).max(100).optional(),
  model: z.string().min(1).max(100).optional(),
  year: z.number().int().min(1990).optional(),
  category: z.enum(["small", "sedan", "suv", "van", "seven_seater"]).optional(),
  dailyRate: z.number().positive().optional(),
  status: z.enum(["available", "rented", "maintenance"]).optional(),
  mileage: z.number().int().min(0).optional(),
  color: z.string().max(50).optional(),
  fuelType: z.string().max(20).optional(),
  transmission: z.string().max(20).optional(),
  seats: z.number().int().min(1).max(30).optional(),
  notes: z.string().optional(),
});

async function getVehicle(id: string, companyId: string) {
  return prisma.vehicle.findFirst({ where: { id, companyId, isActive: true } });
}

vehiclesRouter.get("/", requireRoles(...ALL_STAFF), async (req, res) => {
  const session = req.user!;
  const { status, category, search } = req.query as Record<string, string | undefined>;

  const vehicles = await prisma.vehicle.findMany({
    where: {
      companyId: session.companyId!,
      isActive: true,
      ...(status && { status: status as never }),
      ...(category && { category: category as never }),
      ...(search && {
        OR: [
          { make: { contains: search, mode: "insensitive" } },
          { model: { contains: search, mode: "insensitive" } },
          { registrationNumber: { contains: search, mode: "insensitive" } },
        ],
      }),
    },
    orderBy: { createdAt: "desc" },
  });

  res.json(vehicles);
});

vehiclesRouter.post("/", requireRoles(...COMPANY_ADMINS), async (req, res) => {
  const session = req.user!;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const { registrationNumber, dailyRate, ...rest } = parsed.data;

  const existing = await prisma.vehicle.findFirst({
    where: { registrationNumber, companyId: session.companyId! },
  });
  if (existing) return res.status(409).json({ error: "A vehicle with this registration number already exists" });

  const vehicle = await prisma.vehicle.create({
    data: { ...rest, registrationNumber, dailyRate, companyId: session.companyId! },
  });

  res.status(201).json(vehicle);
});

vehiclesRouter.get("/:id", requireRoles(...ALL_STAFF), async (req, res) => {
  const session = req.user!;
  const vehicle = await getVehicle(req.params.id, session.companyId!);
  if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });

  const upcomingBookings = await prisma.booking.findMany({
    where: {
      vehicleId: req.params.id,
      companyId: session.companyId!,
      status: { in: ["pending", "active"] },
      endDate: { gte: new Date() },
    },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      status: true,
      customer: { select: { fullName: true, phone: true } },
    },
    orderBy: { startDate: "asc" },
    take: 5,
  });

  res.json({ ...vehicle, upcomingBookings });
});

vehiclesRouter.patch("/:id", requireRoles(...COMPANY_ADMINS), async (req, res) => {
  const session = req.user!;
  const vehicle = await getVehicle(req.params.id, session.companyId!);
  if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const updated = await prisma.vehicle.update({ where: { id: req.params.id }, data: parsed.data });
  res.json(updated);
});

vehiclesRouter.delete("/:id", requireRoles("admin"), async (req, res) => {
  const session = req.user!;
  const vehicle = await getVehicle(req.params.id, session.companyId!);
  if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });

  const activeBooking = await prisma.booking.findFirst({
    where: { vehicleId: req.params.id, companyId: session.companyId!, status: { in: ["pending", "active"] } },
  });
  if (activeBooking) {
    return res.status(409).json({ error: "Cannot delete a vehicle with active or pending bookings" });
  }

  await prisma.vehicle.update({ where: { id: req.params.id }, data: { isActive: false } });
  res.json({ message: "Vehicle deleted" });
});
