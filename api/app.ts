/**
 * This is a API server
 */

import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import discountCodeRoutes from "./routes/discountCodes.js";
import cashierDiscountRoutes from "./routes/cashierDiscounts.js";
import referenceDataRoutes from "./routes/referenceData.js";

dotenv.config();

const app: express.Application = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

/**
 * API Routes
 */
app.use("/api/discount-codes", discountCodeRoutes);
app.use("/api/cashier-discounts", cashierDiscountRoutes);
app.use("/api/reference-data", referenceDataRoutes);

/**
 * health
 */
app.use(
  "/api/health",
  (_req: Request, res: Response): void => {
    res.status(200).json({
      success: true,
      message: "ok",
      database: {
        host: process.env.PGHOST || "localhost",
        port: Number(process.env.PGPORT || 5432),
        database: process.env.PGDATABASE || "frota",
      },
    });
  },
);

/**
 * error handler middleware
 */
app.use((error: Error, _req: Request, res: Response, next: NextFunction) => {
  void next;
  res.status(500).json({
    success: false,
    error: "Server internal error",
    details: error.message,
  });
});

/**
 * 404 handler
 */
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: `API not found: ${req.method} ${req.originalUrl}`,
  });
});

export default app;
