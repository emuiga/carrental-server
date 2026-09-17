import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { authenticate, requireRoles, ALL_STAFF, MANAGERS_UP } from "../middleware/auth";

export const usersRouter = Router();
usersRouter.use(authenticate);

const updateSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  role: z.enum(["admin", "manager", "staff"]).optional(),
  password: z.string().min(8).optional(),
  isActive: z.boolean().optional(),
});

async function getUser(id: string, companyId: string | null) {
  return prisma.user.findFirst({ where: { id, ...(companyId !== null && { companyId }) } });
}

usersRouter.get("/", requireRoles(...MANAGERS_UP), async (req, res) => {
  const session = req.user!;
  const users = await prisma.user.findMany({
    where: { companyId: session.role === "superadmin" ? undefined : session.companyId!, isActive: true },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      companyId: true,
      createdAt: true,
      company: { select: { name: true, slug: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  res.json(users);
});

usersRouter.get("/:id", requireRoles(...ALL_STAFF), async (req, res) => {
  const session = req.user!;
  const isSelf = session.id === req.params.id;
  if (!isSelf && !["admin", "manager", "superadmin"].includes(session.role)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const user = await getUser(req.params.id, session.role === "superadmin" ? null : session.companyId);
  if (!user) return res.status(404).json({ error: "User not found" });

  const { passwordHash: _passwordHash, ...safe } = user;
  res.json(safe);
});

usersRouter.patch("/:id", requireRoles(...ALL_STAFF), async (req, res) => {
  const session = req.user!;
  const isSelf = session.id === req.params.id;
  const isAdmin = ["admin", "superadmin"].includes(session.role);

  if (!isSelf && !isAdmin) return res.status(403).json({ error: "Forbidden" });

  const user = await getUser(req.params.id, session.role === "superadmin" ? null : session.companyId!);
  if (!user) return res.status(404).json({ error: "User not found" });

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  if ((parsed.data.role || parsed.data.isActive !== undefined) && !isAdmin) {
    return res.status(403).json({ error: "Only admins can change roles or activation status" });
  }

  const { password, ...rest } = parsed.data;
  const data: Record<string, unknown> = { ...rest };
  if (password) data.passwordHash = await bcrypt.hash(password, 12);

  const updated = await prisma.user.update({
    where: { id: req.params.id },
    data,
    select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, updatedAt: true },
  });

  res.json(updated);
});

usersRouter.delete("/:id", requireRoles(...MANAGERS_UP), async (req, res) => {
  const session = req.user!;
  if (session.id === req.params.id) return res.status(400).json({ error: "Cannot deactivate your own account" });

  const user = await getUser(req.params.id, session.companyId);
  if (!user) return res.status(404).json({ error: "User not found" });

  await prisma.user.update({ where: { id: req.params.id }, data: { isActive: false } });
  res.json({ message: "User deactivated" });
});
