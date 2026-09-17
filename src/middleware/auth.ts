/**
 * Express auth middleware.
 *
 * SECURITY: company_id is ALWAYS sourced from the JWT — never from
 * request bodies or query params. This file is the single enforcement point.
 */
import { Request, Response, NextFunction } from "express";
import { UserRole } from "@prisma/client";
import { verifySessionToken, SessionUser } from "../lib/jwt";

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  let session: SessionUser;
  try {
    session = verifySessionToken(token);
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (session.role !== "superadmin" && !session.companyId) {
    return res.status(401).json({ error: "Invalid session — missing company context" });
  }

  req.user = session;
  next();
}

export function requireRoles(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}

export const SUPERADMIN_ONLY: UserRole[] = ["superadmin"];
export const ADMIN_ONLY: UserRole[] = ["admin"];
export const MANAGERS_UP: UserRole[] = ["superadmin", "admin", "manager"];
export const ALL_STAFF: UserRole[] = ["superadmin", "admin", "manager", "staff"];
export const COMPANY_ADMINS: UserRole[] = ["admin", "manager"];
