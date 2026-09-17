import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate, requireRoles, ALL_STAFF } from "../middleware/auth";

export const paymentsRouter = Router();
paymentsRouter.use(authenticate);

const createSchema = z.object({
  bookingId: z.string().uuid(),
  amount: z.number().positive(),
  paymentMethod: z.enum(["mpesa", "cash", "card", "bank"]),
  transactionRef: z.string().max(100).optional(),
  paymentDate: z.string().datetime(),
  notes: z.string().optional(),
});

paymentsRouter.get("/", requireRoles(...ALL_STAFF), async (req, res) => {
  const session = req.user!;
  const { bookingId, method, from, to } = req.query as Record<string, string | undefined>;

  const payments = await prisma.payment.findMany({
    where: {
      companyId: session.companyId!,
      ...(bookingId && { bookingId }),
      ...(method && { paymentMethod: method as never }),
      ...(from && { paymentDate: { gte: new Date(from) } }),
      ...(to && { paymentDate: { lte: new Date(to) } }),
    },
    include: {
      booking: {
        select: {
          id: true,
          totalAmount: true,
          vehicle: { select: { registrationNumber: true, make: true, model: true } },
          customer: { select: { fullName: true, phone: true } },
        },
      },
    },
    orderBy: { paymentDate: "desc" },
  });

  res.json(payments);
});

paymentsRouter.post("/", requireRoles(...ALL_STAFF), async (req, res) => {
  const session = req.user!;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const { bookingId, amount, paymentMethod, transactionRef, paymentDate, notes } = parsed.data;

  const booking = await prisma.booking.findFirst({ where: { id: bookingId, companyId: session.companyId! } });
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  if (booking.status === "cancelled") {
    return res.status(400).json({ error: "Cannot record payment for a cancelled booking" });
  }

  const payment = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.create({
      data: {
        companyId: session.companyId!,
        bookingId,
        amount,
        paymentMethod,
        transactionRef,
        paymentDate: new Date(paymentDate),
        notes,
        recordedBy: session.id,
      },
    });

    const agg = await tx.payment.aggregate({ where: { bookingId }, _sum: { amount: true } });
    const totalPaid = Number(agg._sum.amount ?? 0);
    const total = Number(booking.totalAmount);

    let paymentStatus: "unpaid" | "partial" | "paid" = "unpaid";
    if (totalPaid >= total) paymentStatus = "paid";
    else if (totalPaid > 0) paymentStatus = "partial";

    await tx.booking.update({ where: { id: bookingId }, data: { paymentStatus } });

    return p;
  });

  res.status(201).json(payment);
});

paymentsRouter.get("/:id", requireRoles(...ALL_STAFF), async (req, res) => {
  const session = req.user!;
  const payment = await prisma.payment.findFirst({
    where: { id: req.params.id, companyId: session.companyId! },
    include: {
      booking: {
        include: {
          vehicle: { select: { registrationNumber: true, make: true, model: true } },
          customer: { select: { fullName: true, idNumber: true, phone: true } },
        },
      },
    },
  });

  if (!payment) return res.status(404).json({ error: "Payment not found" });
  res.json(payment);
});

paymentsRouter.delete("/:id", requireRoles("admin"), async (req, res) => {
  const session = req.user!;
  const payment = await prisma.payment.findFirst({ where: { id: req.params.id, companyId: session.companyId! } });
  if (!payment) return res.status(404).json({ error: "Payment not found" });

  await prisma.$transaction(async (tx) => {
    await tx.payment.delete({ where: { id: req.params.id } });

    const agg = await tx.payment.aggregate({ where: { bookingId: payment.bookingId }, _sum: { amount: true } });
    const booking = await tx.booking.findUnique({ where: { id: payment.bookingId }, select: { totalAmount: true } });

    const totalPaid = Number(agg._sum.amount ?? 0);
    const total = Number(booking?.totalAmount ?? 0);

    let paymentStatus: "unpaid" | "partial" | "paid" = "unpaid";
    if (totalPaid >= total && total > 0) paymentStatus = "paid";
    else if (totalPaid > 0) paymentStatus = "partial";

    await tx.booking.update({ where: { id: payment.bookingId }, data: { paymentStatus } });
  });

  res.json({ message: "Payment voided" });
});
