import jwt from "jsonwebtoken";
import { UserRole } from "@prisma/client";

const SECRET = process.env.JWT_SECRET!;
const SESSION_MAX_AGE = "30d";
const PENDING_MAX_AGE = "5m"; // 2FA window

export type SessionUser = {
  id: string;
  email: string;
  role: UserRole;
  /** null only for superadmin */
  companyId: string | null;
  companySlug: string | null;
  firstName: string | null;
  lastName: string | null;
};

export function signSessionToken(user: SessionUser): string {
  return jwt.sign(user, SECRET, { expiresIn: SESSION_MAX_AGE });
}

export function verifySessionToken(token: string): SessionUser {
  return jwt.verify(token, SECRET) as SessionUser;
}

export function signPendingToken(userId: string): string {
  return jwt.sign({ sub: userId, type: "2fa-pending" }, SECRET, {
    expiresIn: PENDING_MAX_AGE,
  });
}

export function verifyPendingToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, SECRET) as { sub: string; type: string };
    if (payload.type !== "2fa-pending") return null;
    return payload.sub;
  } catch {
    return null;
  }
}
