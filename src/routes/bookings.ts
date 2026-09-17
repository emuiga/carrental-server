import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate, requireRoles, ALL_STAFF } from "../middleware/auth";

export const bookingsRouter = Router();
bookingsRouter.use(authenticate);

const createSchema = z
  .object({
    vehicleId: z.string().uuid(),
    customerId: z.string().uuid(),
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    depositPaid: z.number().min(0).default(0),
    notes: z.string().optional(),
    pickupLocation: z.string().optional(),
    returnLocation: z.string().optional(),
    startMileage: z.number().int().min(0).optional(),
  })
  .refine((d) => new Date(d.endDate) > new Date(d.startDate), {
    message: "End date must be after start date",
    path: ["endDate"],
  });

const updateSchema = z.object({
  notes: z.string().optional(),
  pickupLocation: z.string().optional(),
  returnLocation: z.string().optional(),
  startMileage: z.number().int().min(0).optional(),
  endMileage: z.number().int().min(0).optional(),
  depositPaid: z.number().min(0).optional(),
});

const statusSchema = z.object({
  status: z.enum(["active", "completed", "cancelled"]),
  endMileage: z.number().int().min(0).optional(),
  notes: z.string().optional(),
});

const TRANSITIONS: Record<string, string[]> = {
  pending: ["active", "cancelled"],
  active: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

bookingsRouter.get("/", requireRoles(...ALL_STAFF), async (req, res) => {
  const session = req.user!;
  const { status, paymentStatus, vehicleId, customerId, from, to } = req.query as Record<
    string,
    string | undefined
  >;

  const bookings = await prisma.booking.findMany({
    where: {
      companyId: session.companyId!,
      ...(status && { status: status as never }),
      ...(paymentStatus && { paymentStatus: paymentStatus as never }),
      ...(vehicleId && { vehicleId }),
      ...(customerId && { customerId }),
      ...(from && { startDate: { gte: new Date(from) } }),
      ...(to && { endDate: { lte: new Date(to) } }),
    },
    include: {
      vehicle: { select: { registrationNumber: true, make: true, model: true, category: true } },
      customer: { select: { fullName: true, phone: true, idNumber: true } },
    },
    orderBy: { startDate: "desc" },
  });

  res.json(bookings);
});

bookingsRouter.post("/", requireRoles(...ALL_STAFF), async (req, res) => {
  const session = req.user!;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const { vehicleId, customerId, startDate, endDate, depositPaid, ...rest } = parsed.data;
  const start = new Date(startDate);
  const end = new Date(endDate);

  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, companyId: session.companyId!, isActive: true },
  });
  if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
  if (vehicle.status === "maintenance") {
    return res.status(400).json({ error: "Vehicle is currently under maintenance" });
  }

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, companyId: session.companyId!, isActive: true },
  });
  if (!customer) return res.status(404).json({ error: "Customer not found" });

  const conflict = await prisma.booking.findFirst({
    where: {
      companyId: session.companyId!,
      vehicleId,
      status: { in: ["pending", "active"] },
      startDate: { lt: end },
      endDate: { gt: start },
    },
  });
  if (conflict) {
    return res.status(409).json({
      error: `Vehicle is already booked from ${conflict.startDate.toISOString().slice(0, 10)} to ${conflict.endDate.toISOString().slice(0, 10)}`,
    });
  }

  const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const dailyRate = vehicle.dailyRate;
  const totalAmount = Number(dailyRate) * days;

  const booking = await prisma.$transaction(async (tx) => {
    const b = await tx.booking.create({
      data: {
        companyId: session.companyId!,
        vehicleId,
        customerId,
        startDate: start,
        endDate: end,
        dailyRate,
        totalAmount,
        depositPaid,
        createdBy: session.id,
        ...rest,
      },
      include: {
        vehicle: { select: { registrationNumber: true, make: true, model: true } },
        customer: { select: { fullName: true, phone: true } },
      },
    });

    const today = new Date();
    if (start <= today && end > today) {
      await tx.vehicle.update({ where: { id: vehicleId }, data: { status: "rented" } });
    }

    return b;
  });

  res.status(201).json(booking);
});

bookingsRouter.get("/:id", requireRoles(...ALL_STAFF), async (req, res) => {
  const session = req.user!;
  const booking = await prisma.booking.findFirst({
    where: { id: req.params.id, companyId: session.companyId! },
    include: { vehicle: true, customer: true, payments: { orderBy: { paymentDate: "desc" } } },
  });

  if (!booking) return res.status(404).json({ error: "Booking not found" });

  const amountPaid = booking.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const outstanding = Number(booking.totalAmount) - amountPaid;

  res.json({ ...booking, amountPaid, outstanding });
});

bookingsRouter.patch("/:id", requireRoles(...ALL_STAFF), async (req, res) => {
  const session = req.user!;
  const booking = await prisma.booking.findFirst({ where: { id: req.params.id, companyId: session.companyId! } });
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  if (booking.status === "cancelled") {
    return res.status(400).json({ error: "Cannot update a cancelled booking" });
  }

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const updated = await prisma.booking.update({ where: { id: req.params.id }, data: parsed.data });
  res.json(updated);
});

bookingsRouter.patch("/:id/status", requireRoles(...ALL_STAFF), async (req, res) => {
  const session = req.user!;
  const booking = await prisma.booking.findFirst({ where: { id: req.params.id, companyId: session.companyId! } });
  if (!booking) return res.status(404).json({ error: "Booking not found" });

  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const { status: newStatus, endMileage, notes } = parsed.data;

  if (!TRANSITIONS[booking.status].includes(newStatus)) {
    return res.status(422).json({ error: `Cannot transition booking from '${booking.status}' to '${newStatus}'` });
  }

  if (booking.status === "active" && newStatus === "cancelled") {
    if (!["admin", "superadmin"].includes(session.role)) {
      return res.status(403).json({ error: "Only admins can cancel an active booking" });
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const b = await tx.booking.update({
      where: { id: req.params.id },
      data: {
        status: newStatus,
        ...(notes && { notes }),
        ...(endMileage !== undefined && { endMileage }),
      },
    });

    if (newStatus === "active") {
      await tx.vehicle.update({ where: { id: booking.vehicleId }, data: { status: "rented" } });
    } else if (newStatus === "completed" || newStatus === "cancelled") {
      const otherActive = await tx.booking.findFirst({
        where: {
          vehicleId: booking.vehicleId,
          companyId: session.companyId!,
          status: "active",
          NOT: { id: req.params.id },
        },
      });
      if (!otherActive) {
        await tx.vehicle.update({ where: { id: booking.vehicleId }, data: { status: "available" } });
      }
    }

    return b;
  });

  res.json(updated);
});
