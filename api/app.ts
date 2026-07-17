/**
 * This is a API server
 */

import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import discountCodeRoutes from "./routes/discountCodes.js";
import cashierDiscountRoutes from "./routes/cashierDiscounts.js";
import referenceDataRoutes from "./routes/referenceData.js";
import companyRoutes from "./routes/companies.js";
import promotionRoutes from "./routes/promotions.js";
import pdvPromotionRoutes from "./routes/pdvPromotions.js";
import pdvAgentRoutes from "./routes/pdvAgents.js";
import adminAccountRoutes from "./routes/adminAccount.js";

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
app.use("/api/companies", companyRoutes);
app.use("/api/promotions", promotionRoutes);
app.use("/api/pdv-promotions", pdvPromotionRoutes);
app.use("/api/pdv-agents", pdvAgentRoutes);
app.use("/api/admin-account", adminAccountRoutes);

/**
 * health
 */
app.use(
  "/api/health",
  (_req: Request, res: Response): void => {
    res.status(200).json({
      success: true,
      message: "ok",
      databases: {
        client: {
          host: process.env.PGHOST || "localhost",
          port: Number(process.env.PGPORT || 5432),
          database: process.env.PGDATABASE || "frota",
        },
        saas: {
          host: process.env.SAAS_PGHOST || process.env.PGHOST || "localhost",
          port: Number(process.env.SAAS_PGPORT || process.env.PGPORT || 5432),
          database: process.env.SAAS_PGDATABASE || "datafrota",
        },
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
