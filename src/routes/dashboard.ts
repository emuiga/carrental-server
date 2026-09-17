import { Router } from "express";
import { prisma } from "../lib/prisma";
import { authenticate, requireRoles, ALL_STAFF } from "../middleware/auth";

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

dashboardRouter.get("/", requireRoles(...ALL_STAFF), async (req, res) => {
  const companyId = req.user!.companyId!;
  const now = new Date();

  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  const [
    revenueThisMonth,
    revenueLastMonth,
    bookingCounts,
    vehicleStatusCounts,
    customersThisMonth,
    totalCustomers,
    recentBookings,
  ] = await Promise.all([
    prisma.payment.aggregate({
      where: { companyId, paymentDate: { gte: startOfThisMonth } },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: { companyId, paymentDate: { gte: startOfLastMonth, lte: endOfLastMonth } },
      _sum: { amount: true },
    }),
    prisma.booking.groupBy({ by: ["status"], where: { companyId }, _count: { _all: true } }),
    prisma.vehicle.groupBy({ by: ["status"], where: { companyId, isActive: true }, _count: { _all: true } }),
    prisma.customer.count({ where: { companyId, createdAt: { gte: startOfThisMonth } } }),
    prisma.customer.count({ where: { companyId, isActive: true } }),
    prisma.booking.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        startDate: true,
        endDate: true,
        status: true,
        paymentStatus: true,
        totalAmount: true,
        vehicle: { select: { registrationNumber: true, make: true, model: true } },
        customer: { select: { fullName: true, phone: true } },
      },
    }),
  ]);

  const bookings: Record<string, number> = {};
  bookingCounts.forEach((b) => (bookings[b.status] = b._count._all));

  const vehicles: Record<string, number> = {};
  vehicleStatusCounts.forEach((v) => (vehicles[v.status] = v._count._all));

  const thisMonthRevenue = Number(revenueThisMonth._sum.amount ?? 0);
  const lastMonthRevenue = Number(revenueLastMonth._sum.amount ?? 0);
  const revenueChange =
    lastMonthRevenue === 0 ? null : ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100;

  res.json({
    revenue: {
      thisMonth: thisMonthRevenue,
      lastMonth: lastMonthRevenue,
      changePercent: revenueChange ? Math.round(revenueChange * 10) / 10 : null,
    },
    bookings: {
      active: bookings["active"] ?? 0,
      pending: bookings["pending"] ?? 0,
      completed: bookings["completed"] ?? 0,
      cancelled: bookings["cancelled"] ?? 0,
      total: Object.values(bookings).reduce((a, b) => a + b, 0),
    },
    vehicles: {
      available: vehicles["available"] ?? 0,
      rented: vehicles["rented"] ?? 0,
      maintenance: vehicles["maintenance"] ?? 0,
      total: Object.values(vehicles).reduce((a, b) => a + b, 0),
    },
    customers: { newThisMonth: customersThisMonth, total: totalCustomers },
    recentBookings,
  });
});
