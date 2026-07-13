import { Router, type Request, type Response } from "express";
import { listReferenceData } from "../services/referenceDataService.js";
import type { ReferenceDataType } from "../../shared/referenceData.js";

const router = Router();

router.get("/:type", async (req: Request, res: Response): Promise<void> => {
  const type = req.params.type as ReferenceDataType;
  const allowedTypes: ReferenceDataType[] = [
    "products",
    "product-groups",
    "customer-groups",
    "customers",
    "payment-forms",
  ];

  if (!allowedTypes.includes(type)) {
    res.status(400).json({
      success: false,
      error: "Tipo de lista invalido.",
    });
    return;
  }

  try {
    const items = await listReferenceData(type, String(req.query.q || ""));
    res.status(200).json({
      success: true,
      items,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Nao foi possivel carregar os dados de referencia.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

export default router;
