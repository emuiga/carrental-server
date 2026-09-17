import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth";
import { vehiclesRouter } from "./routes/vehicles";
import { customersRouter } from "./routes/customers";
import { bookingsRouter } from "./routes/bookings";
import { paymentsRouter } from "./routes/payments";
import { dashboardRouter } from "./routes/dashboard";
import { usersRouter } from "./routes/users";
import { companiesRouter } from "./routes/companies";

export const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL ?? "http://localhost:3000" }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/vehicles", vehiclesRouter);
app.use("/customers", customersRouter);
app.use("/bookings", bookingsRouter);
app.use("/payments", paymentsRouter);
app.use("/dashboard", dashboardRouter);
app.use("/users", usersRouter);
app.use("/companies", companiesRouter);
