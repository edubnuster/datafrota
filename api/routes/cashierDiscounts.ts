import { Router, type Request, type Response } from "express";
import { bootstrapCashierIntegration } from "../db.js";
import {
  CashierVoucherError,
  createCashierAuthorization,
  getCashierAuthorizationStatus,
  resolveCashierContext,
  validateCashierVoucher,
} from "../services/cashierDiscountService.js";
import type { CreateCashierAuthorizationInput } from "../../shared/cashier.js";
import { PdvAgentError, requirePdvAgentSession } from "../services/pdvAgentService.js";

const router = Router();

router.post("/bootstrap", async (_req: Request, res: Response): Promise<void> => {
  try {
    const status = await bootstrapCashierIntegration();
    res.status(status.ok ? 200 : 503).json({
      success: status.ok,
      item: status,
      error: status.ok ? undefined : "A estrutura da integracao nao ficou pronta para uso.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Nao foi possivel validar a estrutura da integracao no banco.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.get("/context", async (_req: Request, res: Response): Promise<void> => {
  try {
    const session = await requirePdvAgentSession(_req);
    const stationHint =
      typeof _req.query.stationHint === "string" ? _req.query.stationHint : undefined;
    const item = await resolveCashierContext(stationHint ?? session.stationCode);
    res.status(200).json({
      success: true,
      item,
    });
  } catch (error) {
    if (error instanceof PdvAgentError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }

    if (error instanceof CashierVoucherError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: "Nao foi possivel identificar o caixa aberto.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.get("/:shortCode/status", async (req: Request, res: Response): Promise<void> => {
  try {
    const session = await requirePdvAgentSession(req);
    const item = await getCashierAuthorizationStatus(req.params.shortCode, session);
    if (!item) {
      res.status(404).json({
        success: false,
        error: "Nenhuma pre-autorizacao encontrada para este voucher.",
      });
      return;
    }

    res.status(200).json({
      success: true,
      item,
    });
  } catch (error) {
    if (error instanceof PdvAgentError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: "Nao foi possivel consultar a situacao do voucher.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.post("/authorize", async (req: Request, res: Response): Promise<void> => {
  try {
    const session = await requirePdvAgentSession(req);
    const item = await createCashierAuthorization(req.body as CreateCashierAuthorizationInput, session);
    res.status(201).json({
      success: true,
      item,
    });
  } catch (error) {
    if (error instanceof PdvAgentError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }

    if (error instanceof CashierVoucherError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: "Nao foi possivel registrar a pre-autorizacao do voucher.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.get("/:shortCode", async (req: Request, res: Response): Promise<void> => {
  try {
    const session = await requirePdvAgentSession(req);
    const result = await validateCashierVoucher(req.params.shortCode, session);

    if (!result.found) {
      const reasonMap: Record<string, string> = {
        NOT_FOUND: "Voucher nao encontrado.",
        EXPIRED: "Voucher expirado.",
        CANCELLED: "Voucher ja utilizado ou cancelado.",
        INVALID_CONTEXT: "Voucher invalido para o contexto atual.",
      };

      res.status(404).json({
        success: false,
        error: reasonMap[result.reason ?? "NOT_FOUND"] ?? "Voucher invalido.",
        ...result,
      });
      return;
    }

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (error instanceof PdvAgentError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }

    if (error instanceof CashierVoucherError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: "Nao foi possivel validar o voucher informado.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

export default router;
