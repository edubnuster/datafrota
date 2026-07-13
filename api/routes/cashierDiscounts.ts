import { Router, type Request, type Response } from "express";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { bootstrapCashierIntegration } from "../db.js";
import {
  CashierVoucherError,
  createCashierAuthorization,
  getCashierAuthorizationStatus,
  resolveCashierContext,
  validateCashierVoucher,
} from "../services/cashierDiscountService.js";
import type { CreateCashierAuthorizationInput } from "../../shared/cashier.js";

const router = Router();

// #region debug-point shared:cashier-route-report
function debugReportCashierRoute(
  hypothesisId: string,
  location: string,
  msg: string,
  data: Record<string, unknown> = {},
  runId = "pre-fix",
): void {
  let debugServerUrl = "http://127.0.0.1:7778/event";
  let debugSessionId = "cashier-preauth-stuck";

  try {
    const envFile = readFileSync(".dbg/cashier-preauth-stuck.env", "utf8");
    for (const line of envFile.split(/\r?\n/)) {
      if (line.startsWith("DEBUG_SERVER_URL=")) {
        debugServerUrl = line.split("=", 2)[1] || debugServerUrl;
      } else if (line.startsWith("DEBUG_SESSION_ID=")) {
        debugSessionId = line.split("=", 2)[1] || debugSessionId;
      }
    }
  } catch {
    // Ignora ausencia do arquivo de configuracao de debug local.
  }

  try {
    const url = new URL(debugServerUrl);
    const body = JSON.stringify({
      sessionId: debugSessionId,
      runId,
      hypothesisId,
      location,
      msg,
      data,
      ts: Date.now(),
    });
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume();
      },
    );
    req.on("error", () => undefined);
    req.end(body);
  } catch {
    // Nao interrompe o fluxo principal se o relay de debug estiver indisponivel.
  }
}
// #endregion

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
    const stationHint =
      typeof _req.query.stationHint === "string" ? _req.query.stationHint : undefined;
    const item = await resolveCashierContext(stationHint);
    res.status(200).json({
      success: true,
      item,
    });
  } catch (error) {
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
    const item = await getCashierAuthorizationStatus(req.params.shortCode);
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
    res.status(500).json({
      success: false,
      error: "Nao foi possivel consultar a situacao do voucher.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.post("/authorize", async (req: Request, res: Response): Promise<void> => {
  try {
    // #region debug-point D:route-authorize-start
    debugReportCashierRoute(
      "D",
      "cashierDiscounts.ts:POST /authorize",
      "[DEBUG] Endpoint /authorize recebido",
      req.body as Record<string, unknown>,
    );
    // #endregion
    const item = await createCashierAuthorization(req.body as CreateCashierAuthorizationInput);
    // #region debug-point D:route-authorize-success
    debugReportCashierRoute(
      "D",
      "cashierDiscounts.ts:POST /authorize",
      "[DEBUG] Endpoint /authorize concluiu com sucesso",
      item as unknown as Record<string, unknown>,
    );
    // #endregion
    res.status(201).json({
      success: true,
      item,
    });
  } catch (error) {
    // #region debug-point D:route-authorize-error
    debugReportCashierRoute(
      "D",
      "cashierDiscounts.ts:POST /authorize",
      "[DEBUG] Endpoint /authorize retornou erro",
      {
        message: error instanceof Error ? error.message : "Erro desconhecido",
        isCashierError: error instanceof CashierVoucherError,
      },
    );
    // #endregion
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
    const result = await validateCashierVoucher(req.params.shortCode);

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
    res.status(500).json({
      success: false,
      error: "Nao foi possivel validar o voucher informado.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

export default router;
