import { Router, type Request, type Response } from "express";
import type { ActivatePdvAgentInput, CreatePdvPairingTokenInput } from "../../shared/pdvAgent.js";
import {
  PdvAgentError,
  activatePdvAgent,
  createPdvPairingToken,
  getPdvAgentBySession,
  listPdvAgents,
  listPdvPairingTokens,
  listPdvPromotionsForAgent,
  revokePdvAgent,
  requirePdvAgentSession,
} from "../services/pdvAgentService.js";
import { listCompanyBranches, resyncCompanyBranches } from "../services/companyBranchSyncService.js";

const router = Router();

router.post("/activate", async (req: Request, res: Response): Promise<void> => {
  try {
    const item = await activatePdvAgent(req, req.body as ActivatePdvAgentInput);
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

    res.status(500).json({
      success: false,
      error: "Nao foi possivel ativar este PDV.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.get("/me", async (req: Request, res: Response): Promise<void> => {
  try {
    const session = await requirePdvAgentSession(req);
    const item = await getPdvAgentBySession(session);
    if (!item) {
      res.status(404).json({
        success: false,
        error: "O PDV autenticado nao foi encontrado.",
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
      error: "Nao foi possivel consultar o PDV autenticado.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.get("/me/sync", async (req: Request, res: Response): Promise<void> => {
  try {
    const session = await requirePdvAgentSession(req);
    const payload = await listPdvPromotionsForAgent(session);
    res.status(200).json({
      success: true,
      ...payload,
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
      error: "Nao foi possivel sincronizar as promocoes deste PDV.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.get("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const items = await listPdvAgents(req);
    res.status(200).json({
      success: true,
      items,
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
      error: "Nao foi possivel listar os PDVs da empresa.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.get("/company-branches", async (req: Request, res: Response): Promise<void> => {
  try {
    const items = await listCompanyBranches(req);
    res.status(200).json({
      success: true,
      items,
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
      error: "Nao foi possivel listar as filiais sincronizadas da empresa.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.post("/company-branches/resync", async (req: Request, res: Response): Promise<void> => {
  try {
    const items = await resyncCompanyBranches(req);
    res.status(200).json({
      success: true,
      items,
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
      error: "Nao foi possivel ressincronizar a rede de empresas do cliente.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.post("/:agentId/revoke", async (req: Request, res: Response): Promise<void> => {
  try {
    const item = await revokePdvAgent(req, req.params.agentId);
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
      error: "Nao foi possivel revogar o PDV informado.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.get("/pairing-tokens", async (req: Request, res: Response): Promise<void> => {
  try {
    const items = await listPdvPairingTokens(req);
    res.status(200).json({
      success: true,
      items,
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
      error: "Nao foi possivel listar os codigos de ativacao do PDV.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

router.post("/pairing-tokens", async (req: Request, res: Response): Promise<void> => {
  try {
    const item = await createPdvPairingToken(req, req.body as CreatePdvPairingTokenInput);
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

    res.status(500).json({
      success: false,
      error: "Nao foi possivel gerar um codigo de ativacao para o PDV.",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

export default router;
