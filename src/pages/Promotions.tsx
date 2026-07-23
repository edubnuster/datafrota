import { useEffect, useMemo, useState } from "react";
import {
  Megaphone,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  Pause,
  TicketPercent,
} from "lucide-react";
import AppShell from "@/components/saas/AppShell";
import PromotionDialog, { type PromotionPayload } from "@/components/saas/PromotionDialog";
import type { Promotion, PromotionPdvSyncState, PromotionStatus } from "@/types/saas";
import {
  createPromotion as createPromotionRequest,
  deletePromotion as deletePromotionRequest,
  fetchPromotions,
  updatePromotion as updatePromotionRequest,
} from "@/utils/api";

type PromotionDisplay = {
  discountSummary: string;
  targetSummary: string;
  audienceSummary: string;
};

const badgeStyles: Record<PromotionStatus, string> = {
  ativa: "bg-emerald-50 text-emerald-700",
  agendada: "bg-sky-50 text-sky-700",
  pausada: "bg-amber-50 text-amber-700",
  encerrada: "bg-slate-100 text-slate-600",
};

const statusLabels: Record<PromotionStatus, string> = {
  ativa: "Ativa",
  agendada: "Agendada",
  pausada: "Pausada",
  encerrada: "Encerrada",
};

const integrationBadgeStyles: Record<PromotionPdvSyncState, string> = {
  pending: "bg-slate-100 text-slate-600",
  published: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-amber-50 text-amber-700",
  error: "bg-rose-50 text-rose-700",
};

const integrationLabels: Record<PromotionPdvSyncState, string> = {
  pending: "Pendente",
  published: "Publicado no PDV",
  cancelled: "Cancelado no PDV",
  error: "Erro no PDV",
};

function formatPromotionForDisplay(
  payload: PromotionPayload,
): PromotionDisplay {
  const discountLabel =
    payload.discountType === "fixed"
      ? `R$ ${payload.discountValue} de desconto`
      : `${payload.discountValue}% de desconto`;

  const targetSummary =
    payload.productMode === "group"
      ? `${payload.selectedProductGroupCodes.length} grupo(s) de produtos`
      : `${payload.selectedProductCodes.length} produto(s) avulso(s)`;

  const audienceSummary =
    payload.audienceMode === "all"
      ? "Todos os clientes"
      : payload.audienceMode === "firstPurchase"
        ? payload.newCustomerFirstPurchaseOnly
          ? "Clientes novos · primeira compra"
          : `Clientes novos · ${payload.newCustomerDays} dia(s)`
      : payload.audienceMode === "group"
        ? `${payload.selectedCustomerGroupCodes.length} grupo(s) de clientes`
        : `${payload.selectedCustomerCodes.length} cliente(s) avulso(s)`;

  const branchSummary =
    payload.selectedBranchIds.length === 0
      ? "Toda a rede"
      : `${payload.selectedBranchIds.length} filial(is)`;

  return {
    discountSummary: discountLabel,
    targetSummary,
    audienceSummary: `${audienceSummary} · ${branchSummary}`,
  };
}

export default function Promotions() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPromotionId, setEditingPromotionId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [promotionsError, setPromotionsError] = useState<string | null>(null);
  const [loadingPromotions, setLoadingPromotions] = useState(true);
  const [promotions, setPromotions] = useState<Promotion[]>([]);

  useEffect(() => {
    let active = true;

    async function loadPromotions() {
      setLoadingPromotions(true);
      setPromotionsError(null);

      try {
        const items = await fetchPromotions();
        if (!active) {
          return;
        }

        setPromotions(items);
      } catch (error) {
        if (!active) {
          return;
        }

        setPromotionsError(
          error instanceof Error ? error.message : "Nao foi possivel carregar as campanhas do banco.",
        );
      } finally {
        if (active) {
          setLoadingPromotions(false);
        }
      }
    }

    void loadPromotions();

    return () => {
      active = false;
    };
  }, []);

  const filteredPromotions = useMemo(() => {
    const normalized = search.trim().toLowerCase();

    if (!normalized) {
      return promotions;
    }

    return promotions.filter((promotion) =>
      [
        promotion.name,
        promotion.voucherCode,
        promotion.voucherMode === "fixed" ? "voucher fixo" : "voucher mobile",
        ...Object.values(formatPromotionForDisplay(promotion)),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [promotions, search]);

  const editingPromotion = useMemo(
    () => promotions.find((promotion) => promotion.id === editingPromotionId) || null,
    [editingPromotionId, promotions],
  );

  function handleOpenCreate() {
    setEditingPromotionId(null);
    setSubmitError(null);
    setDialogOpen(true);
  }

  function handleOpenEdit(id: string) {
    setEditingPromotionId(id);
    setSubmitError(null);
    setDialogOpen(true);
  }

  function handleCloseDialog() {
    setDialogOpen(false);
    setEditingPromotionId(null);
    setSubmitError(null);
  }

  async function handleCreateOrUpdatePromotion(payload: PromotionPayload) {
    setFeedback(null);
    setSubmitError(null);

    try {
      if (editingPromotion) {
        const updatedPromotion = await updatePromotionRequest(editingPromotion.id, payload);
        setPromotions((current) =>
          current.map((item) => (item.id === editingPromotion.id ? updatedPromotion : item)),
        );
        setFeedback(`Promoção ${updatedPromotion.name} atualizada com sucesso.`);
        return;
      }

      const promotion = await createPromotionRequest(payload);
      setPromotions((current) => [promotion, ...current.filter((item) => item.id !== promotion.id)]);
      setFeedback(`Promoção ${promotion.name} criada com sucesso.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Nao foi possivel salvar a campanha no banco.";
      setSubmitError(message);
      throw error;
    }
  }

  async function handleToggleStatus(id: string) {
    const promotion = promotions.find((item) => item.id === id);

    if (!promotion) {
      return;
    }

    const nextStatus: PromotionStatus = promotion.status === "ativa" ? "pausada" : "ativa";

    setFeedback(null);
    setSubmitError(null);

    try {
      const updatedPromotion = await updatePromotionRequest(id, { ...promotion, status: nextStatus });
      setPromotions((current) => current.map((item) => (item.id === id ? updatedPromotion : item)));
      setFeedback(`Promoção ${updatedPromotion.name} ${nextStatus === "ativa" ? "ativada" : "pausada"} com sucesso.`);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Nao foi possivel atualizar o status da campanha.",
      );
    }
  }

  async function handleDeletePromotion(id: string) {
    const promotion = promotions.find((item) => item.id === id);

    if (!promotion) {
      return;
    }

    const shouldDelete = window.confirm(`Deseja remover a promoção ${promotion.name}?`);

    if (!shouldDelete) {
      return;
    }

    setFeedback(null);
    setSubmitError(null);

    try {
      const deletedPromotion = await deletePromotionRequest(id);
      setPromotions((current) => current.filter((item) => item.id !== id));
      setFeedback(`Promoção ${deletedPromotion.name} removida.`);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Nao foi possivel excluir a campanha no banco.",
      );
    }
  }

  return (
    <AppShell
      title="Campanhas"
      subtitle="Crie e gerencie suas promoções com o mesmo fluxo visual do painel operacional."
      actions={
        <button
          type="button"
          onClick={handleOpenCreate}
          className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-700"
        >
          <Plus className="h-4 w-4" />
          Nova promoção
        </button>
      }
    >
      <section className="rounded-[28px] border border-white/60 bg-white p-5 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
        <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
              <Megaphone className="h-5 w-5" />
            </div>
            <div>
              <p className="text-lg font-semibold text-slate-950">Campanhas</p>
              <p className="text-sm text-slate-500">Crie e gerencie suas promoções.</p>
            </div>
          </div>

          <label className="saas-compact-search w-full md:max-w-md">
            <Search className="h-3.5 w-3.5 shrink-0" />
            <input
              className="text-sm"
              placeholder="Buscar promoções..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>

        {feedback ? (
          <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {feedback}
          </div>
        ) : null}

        {submitError ? (
          <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {submitError}
          </div>
        ) : null}

        {promotionsError ? (
          <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            {promotionsError}
          </div>
        ) : null}

        <div className="grid gap-3">
          {loadingPromotions ? (
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-500">
              Carregando campanhas do PostgreSQL local...
            </div>
          ) : null}

          {!loadingPromotions && filteredPromotions.length === 0 ? (
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-500">
              Nenhuma promoção encontrada.
            </div>
          ) : null}

          {filteredPromotions.map((promotion) => {
            const canActivate = promotion.status !== "ativa";
            const display = formatPromotionForDisplay(promotion);
            const integrationStateLabel =
              promotion.voucherMode === "fixed"
                ? integrationLabels[promotion.integration?.state ?? "pending"]
                : "Gerado no mobile";
            const integrationStateStyle =
              promotion.voucherMode === "fixed"
                ? integrationBadgeStyles[promotion.integration?.state ?? "pending"]
                : "bg-violet-50 text-violet-700";
            const voucherLabel =
              promotion.voucherMode === "fixed"
                ? `Voucher fixo ${promotion.voucherCode || "Nao definido"}`
                : "Voucher gerado no app do cliente";

            return (
              <article
                key={promotion.id}
                className="flex flex-col gap-4 rounded-[24px] border border-slate-100 bg-slate-50/80 px-5 py-5 shadow-sm md:flex-row md:items-center md:justify-between"
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm">
                    <TicketPercent className="h-5 w-5" />
                  </div>
                  <div className="grid gap-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-base font-semibold text-slate-950">{promotion.name}</p>
                      <span className={`rounded-full px-3 py-1 text-xs font-medium ${badgeStyles[promotion.status]}`}>
                        {statusLabels[promotion.status]}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-medium ${integrationStateStyle}`}
                      >
                        {integrationStateLabel}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500">
                      {display.discountSummary} · {display.targetSummary} · {display.audienceSummary}
                    </p>
                    <p className="text-sm text-slate-400">{voucherLabel}</p>
                    <p className="text-xs text-slate-400">
                      {promotion.voucherMode === "fixed" && promotion.integration?.syncedAt
                        ? `Ultima publicacao PDV: ${new Date(promotion.integration.syncedAt).toLocaleString("pt-BR")}`
                        : promotion.voucherMode === "fixed"
                          ? "Aguardando primeira publicacao para o PDV"
                          : "O codigo sera criado no app quando a campanha sincronizar com o cliente"}
                    </p>
                    {promotion.voucherMode === "fixed" && promotion.integration?.error ? (
                      <p className="text-xs text-rose-600">{promotion.integration.error}</p>
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end md:self-auto">
                  <button
                    type="button"
                    onClick={() => handleToggleStatus(promotion.id)}
                    className={[
                      "inline-flex h-9 w-9 items-center justify-center rounded-full border transition",
                      canActivate
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
                    ].join(" ")}
                    aria-label={canActivate ? "Ativar promoção" : "Pausar promoção"}
                  >
                    {canActivate ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(promotion.id)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-violet-200 hover:text-violet-700"
                    aria-label="Editar promoção"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeletePromotion(promotion.id)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-rose-600 transition hover:bg-rose-100"
                    aria-label="Excluir promoção"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <PromotionDialog
        open={dialogOpen}
        initialValue={editingPromotion}
        submitError={submitError}
        onClose={handleCloseDialog}
        onSubmit={handleCreateOrUpdatePromotion}
      />
    </AppShell>
  );
}
