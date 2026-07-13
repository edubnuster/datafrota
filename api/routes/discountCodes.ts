import { Router, type Request, type Response } from "express";
import {
  cancelDiscountCode,
  createDiscountCode,
  DiscountValidationError,
  listDiscountCodes,
  resolveDiscountCode,
} from "../services/discountCodeService.js";
import type { CreateDiscountCodeInput } from "../../shared/discount.js";

const router = Router();

router.get("/", async (_req: Request, res: Response): Promise<void> => {
  try {
    const items = await listDiscountCodes();
    res.status(200).json({ success: true, items });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Nao foi possivel listar os codigos de desconto.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const created = await createDiscountCode(req.body as CreateDiscountCodeInput);
    res.status(201).json({ success: true, item: created });
  } catch (error) {
    if (error instanceof DiscountValidationError) {
      res.status(400).json({
        success: false,
        error: "Dados invalidos para gerar o codigo.",
        issues: error.issues,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: "Nao foi possivel gerar o codigo de desconto.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.get("/:shortCode", async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await resolveDiscountCode(req.params.shortCode);
    if (!result.found) {
      res.status(404).json({
        success: false,
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
      error: "Nao foi possivel resolver o codigo informado.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.post("/:shortCode/cancel", async (req: Request, res: Response): Promise<void> => {
  try {
    const updated = await cancelDiscountCode(req.params.shortCode);
    if (!updated) {
      res.status(404).json({
        success: false,
        error: "Codigo nao encontrado para cancelamento.",
      });
      return;
    }

    res.status(200).json({
      success: true,
      item: updated,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Nao foi possivel cancelar o codigo informado.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

export default router;
