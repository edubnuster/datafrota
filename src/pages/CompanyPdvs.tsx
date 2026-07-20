import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  Copy,
  KeyRound,
  MonitorSmartphone,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import AppShell from "@/components/saas/AppShell";
import { useReferenceData } from "@/hooks/useReferenceData";
import { useSaasStore } from "@/hooks/useSaasStore";
import type { CompanyBranch, PdvAgent, PdvPairingToken } from "@/types/saas";
import {
  createPdvPairingToken,
  fetchCompanyBranches,
  fetchPdvAgents,
  fetchPdvPairingTokens,
  revokePdvAgent as revokePdvAgentRequest,
  resyncCompanyBranches as resyncCompanyBranchesRequest,
} from "@/utils/api";
import { formatDateTime } from "@/utils/format";

const agentStatusStyles: Record<PdvAgent["status"], string> = {
  active: "bg-emerald-50 text-emerald-700",
  revoked: "bg-rose-50 text-rose-700",
};

const agentStatusLabels: Record<PdvAgent["status"], string> = {
  active: "Ativo",
  revoked: "Revogado",
};

const pairingStatusStyles: Record<PdvPairingToken["status"], string> = {
  pending: "bg-sky-50 text-sky-700",
  used: "bg-emerald-50 text-emerald-700",
  expired: "bg-amber-50 text-amber-700",
  cancelled: "bg-slate-100 text-slate-600",
};

const pairingStatusLabels: Record<PdvPairingToken["status"], string> = {
  pending: "Pendente",
  used: "Utilizado",
  expired: "Expirado",
  cancelled: "Cancelado",
};

const pairingExpirationOptions = [
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hora" },
  { value: 180, label: "3 horas" },
  { value: 720, label: "12 horas" },
];

function getBranchLabel(branchId: string | null, branchMap: Map<string, string>) {
  if (!branchId) {
    return branchMap.size > 0 ? "Sem filial" : "Primeiro PDV";
  }

  return branchMap.get(branchId) || `Filial ${branchId}`;
}

function wasSeenRecently(value: string | null) {
  if (!value) {
    return false;
  }

  return Date.now() - new Date(value).getTime() <= 10 * 60 * 1000;
}

function formatRelativeTime(value?: string | null) {
  if (!value) {
    return "Nao informado";
  }

  const date = new Date(value);
  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / (60 * 1000));
  const formatter = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

  if (Math.abs(diffMinutes) < 1) {
    return "agora";
  }

  if (Math.abs(diffMinutes) < 60) {
    return formatter.format(diffMinutes, "minute");
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return formatter.format(diffHours, "hour");
  }

  const diffDays = Math.round(diffHours / 24);
  return formatter.format(diffDays, "day");
}

function getAgentDisplayLabel(agent: PdvAgent | null | undefined) {
  if (!agent) {
    return "PDV nao identificado";
  }

  return agent.stationCode || agent.deviceName || agent.id;
}

export default function CompanyPdvs() {
  const session = useSaasStore((state) => state.session);
  const { items: branchOptions, loading: branchesLoading } = useReferenceData("branches");
  const [agents, setAgents] = useState<PdvAgent[]>([]);
  const [tokens, setTokens] = useState<PdvPairingToken[]>([]);
  const [companyBranches, setCompanyBranches] = useState<CompanyBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [selectedBranchFilter, setSelectedBranchFilter] = useState("all");
  const [branchId, setBranchId] = useState("");
  const [stationCode, setStationCode] = useState("");
  const [description, setDescription] = useState("");
  const [expiresInMinutes, setExpiresInMinutes] = useState(60);
  const [submitting, setSubmitting] = useState(false);
  const [resyncingBranches, setResyncingBranches] = useState(false);
  const [lastCreatedToken, setLastCreatedToken] = useState<PdvPairingToken | null>(null);

  const branchMap = useMemo(
    () =>
      new Map(
        branchOptions.map((item) => [
          item.value?.trim() || item.code.trim(),
          `${item.code.trim()} - ${item.name.trim()}`,
        ]),
      ),
    [branchOptions],
  );
  const agentMap = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);

  useEffect(() => {
    if (!session || session.role !== "company_admin") {
      setLoading(false);
      return;
    }

    let active = true;

    async function loadData() {
      setLoading(true);
      setError(null);

      try {
        const [agentItems, tokenItems, branchItems] = await Promise.all([
          fetchPdvAgents(),
          fetchPdvPairingTokens(),
          fetchCompanyBranches(),
        ]);
        if (!active) {
          return;
        }

        setAgents(agentItems);
        setTokens(tokenItems);
        setCompanyBranches(branchItems);
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "Nao foi possivel carregar a gestao de PDVs.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadData();

    return () => {
      active = false;
    };
  }, [session]);

  const filteredAgents = useMemo(() => {
    if (selectedBranchFilter === "all") {
      return agents;
    }

    return agents.filter((item) => item.branchId === selectedBranchFilter);
  }, [agents, selectedBranchFilter]);

  const filteredTokens = useMemo(() => {
    if (selectedBranchFilter === "all") {
      return tokens;
    }

    return tokens.filter((item) => item.branchId === selectedBranchFilter);
  }, [tokens, selectedBranchFilter]);

  const activeAgents = useMemo(() => agents.filter((item) => item.status === "active"), [agents]);
  const healthyAgents = useMemo(
    () => activeAgents.filter((item) => wasSeenRecently(item.lastSeenAt)),
    [activeAgents],
  );
  const activeCompanyBranches = useMemo(
    () => companyBranches.filter((item) => item.isActive),
    [companyBranches],
  );
  const latestDiscoveryBranch = useMemo(() => {
    const sorted = [...companyBranches].sort(
      (left, right) => new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime(),
    );

    return sorted[0] ?? null;
  }, [companyBranches]);
  const branchOperationalStats = useMemo(() => {
    const stats = new Map<
      string,
      {
        totalAgents: number;
        activeAgents: number;
        healthyAgents: number;
        revokedAgents: number;
        pendingTokens: number;
      }
    >();

    for (const branch of companyBranches) {
      stats.set(branch.branchId, {
        totalAgents: 0,
        activeAgents: 0,
        healthyAgents: 0,
        revokedAgents: 0,
        pendingTokens: 0,
      });
    }

    for (const agent of agents) {
      if (!agent.branchId) {
        continue;
      }

      const current = stats.get(agent.branchId) ?? {
        totalAgents: 0,
        activeAgents: 0,
        healthyAgents: 0,
        revokedAgents: 0,
        pendingTokens: 0,
      };

      current.totalAgents += 1;
      if (agent.status === "active") {
        current.activeAgents += 1;
        if (wasSeenRecently(agent.lastSeenAt)) {
          current.healthyAgents += 1;
        }
      } else {
        current.revokedAgents += 1;
      }

      stats.set(agent.branchId, current);
    }

    for (const token of tokens) {
      if (!token.branchId || token.status !== "pending") {
        continue;
      }

      const current = stats.get(token.branchId) ?? {
        totalAgents: 0,
        activeAgents: 0,
        healthyAgents: 0,
        revokedAgents: 0,
        pendingTokens: 0,
      };

      current.pendingTokens += 1;
      stats.set(token.branchId, current);
    }

    return stats;
  }, [agents, companyBranches, tokens]);
  const branchesWithActivePdvs = useMemo(
    () => new Set(activeAgents.map((item) => item.branchId).filter((value): value is string => Boolean(value))),
    [activeAgents],
  );
  const branchesWithHealthyPdvs = useMemo(
    () => new Set(healthyAgents.map((item) => item.branchId).filter((value): value is string => Boolean(value))),
    [healthyAgents],
  );
  const connectedCompanyBranches = useMemo(
    () => companyBranches.filter((item) => branchesWithHealthyPdvs.has(item.branchId)),
    [branchesWithHealthyPdvs, companyBranches],
  );
  const filteredPendingTokens = useMemo(
    () => filteredTokens.filter((item) => item.status === "pending"),
    [filteredTokens],
  );

  async function reloadData() {
    setLoading(true);
    setError(null);
    setFeedback(null);

    try {
      const [agentItems, tokenItems, branchItems] = await Promise.all([
        fetchPdvAgents(),
        fetchPdvPairingTokens(),
        fetchCompanyBranches(),
      ]);
      setAgents(agentItems);
      setTokens(tokenItems);
      setCompanyBranches(branchItems);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Nao foi possivel atualizar a tela de PDVs.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateToken(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFeedback(null);

    try {
      if (branchOptions.length > 0 && !branchId) {
        setError("Selecione uma filial para gerar o codigo de ativacao.");
        return;
      }

      const item = await createPdvPairingToken({
        branchId: branchId || null,
        stationCode: stationCode.trim() || null,
        description: description.trim() || null,
        expiresInMinutes,
      });
      setLastCreatedToken(item);
      setTokens((current) => [item, ...current]);
      setFeedback(`Codigo ${item.tokenCode} gerado com sucesso para ${getBranchLabel(item.branchId, branchMap)}.`);
      setStationCode("");
      setDescription("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Nao foi possivel gerar o codigo do PDV.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopyToken(tokenCode: string) {
    try {
      await navigator.clipboard.writeText(tokenCode);
      setFeedback(`Codigo ${tokenCode} copiado para a area de transferencia.`);
    } catch {
      setError("Nao foi possivel copiar o codigo automaticamente. Copie manualmente.");
    }
  }

  async function handleRevokeAgent(agent: PdvAgent) {
    if (agent.status === "revoked") {
      return;
    }

    const confirmed = window.confirm(
      `Revogar o PDV ${agent.deviceName || agent.stationCode || agent.id}? O terminal precisara ser ativado novamente.`,
    );
    if (!confirmed) {
      return;
    }

    setError(null);
    setFeedback(null);

    try {
      const updated = await revokePdvAgentRequest(agent.id);
      setAgents((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setFeedback(`PDV ${updated.deviceName || updated.stationCode || updated.id} revogado com sucesso.`);
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "Nao foi possivel revogar o PDV.");
    }
  }

  async function handleResyncBranches() {
    setResyncingBranches(true);
    setError(null);
    setFeedback(null);

    try {
      const branchItems = await resyncCompanyBranchesRequest();
      const [agentItems, tokenItems] = await Promise.all([fetchPdvAgents(), fetchPdvPairingTokens()]);
      setAgents(agentItems);
      setTokens(tokenItems);
      setCompanyBranches(branchItems);
      setFeedback("Rede de empresas ressincronizada com sucesso a partir do banco local do cliente.");
    } catch (resyncError) {
      setError(
        resyncError instanceof Error
          ? resyncError.message
          : "Nao foi possivel ressincronizar a rede de empresas do cliente.",
      );
    } finally {
      setResyncingBranches(false);
    }
  }

  if (!session || session.role !== "company_admin") {
    return null;
  }

  return (
    <AppShell
      title="PDVs da empresa"
      subtitle="Gerencie a rede da empresa por filial, considerando uma base local por unidade e varios PDVs operando em cada posto."
      actions={
        <button
          type="button"
          onClick={() => void reloadData()}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-violet-200 hover:text-violet-700"
        >
          <RefreshCw className="h-4 w-4" />
          Atualizar
        </button>
      }
    >
      <section className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        <article className="rounded-[24px] border border-white/60 bg-white p-5 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Filiais sincronizadas</p>
          <p className="mt-3 text-3xl font-semibold text-slate-950">{companyBranches.length}</p>
          <p className="mt-2 text-sm text-slate-500">Cada filial descoberta representa uma base operacional mapeada para a rede da empresa.</p>
        </article>
        <article className="rounded-[24px] border border-white/60 bg-white p-5 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Filiais ativadas</p>
          <p className="mt-3 text-3xl font-semibold text-slate-950">{activeCompanyBranches.length}</p>
          <p className="mt-2 text-sm text-slate-500">Filiais da rede marcadas como ativas no banco operacional do cliente.</p>
        </article>
        <article className="rounded-[24px] border border-white/60 bg-white p-5 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Filiais conectadas</p>
          <p className="mt-3 text-3xl font-semibold text-slate-950">{connectedCompanyBranches.length}</p>
          <p className="mt-2 text-sm text-slate-500">Filiais com app Python rodando e enviando sinal recente para a plataforma.</p>
        </article>
        <article className="rounded-[24px] border border-white/60 bg-white p-5 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">PDVs online recente</p>
          <p className="mt-3 text-3xl font-semibold text-slate-950">{healthyAgents.length}</p>
          <p className="mt-2 text-sm text-slate-500">Terminais ativos com contato recente nas bases das filiais nos ultimos 10 minutos.</p>
        </article>
      </section>

      <section>
        <article className="rounded-[28px] border border-white/60 bg-white p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
              <MonitorSmartphone className="h-5 w-5" />
            </div>
            <div>
              <p className="text-lg font-semibold text-slate-950">Terminais vinculados</p>
              <p className="text-sm text-slate-500">Cada PDV pertence a uma filial da rede e opera sobre a base local daquela unidade.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 2xl:grid-cols-2">
            {loading ? (
              <div className="2xl:col-span-2 rounded-[24px] border border-dashed border-slate-200 bg-slate-50/80 px-5 py-6 text-sm text-slate-500">
                Carregando terminais vinculados...
              </div>
            ) : filteredAgents.length === 0 ? (
              <div className="2xl:col-span-2 rounded-[24px] border border-dashed border-slate-200 bg-slate-50/80 px-5 py-6 text-sm text-slate-500">
                Nenhum PDV encontrado para o filtro atual.
              </div>
            ) : (
              filteredAgents.map((agent) => {
                const healthy = wasSeenRecently(agent.lastSeenAt);
                return (
                  <article key={agent.id} className="rounded-[24px] border border-slate-100 bg-slate-50/70 p-4 transition hover:border-violet-100 hover:bg-white">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-base font-semibold text-slate-950">
                            {agent.deviceName || agent.stationCode || "PDV sem nome"}
                          </p>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${agentStatusStyles[agent.status]}`}>
                            {agentStatusLabels[agent.status]}
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                              healthy ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {healthy ? "Online recente" : "Sem sinal recente"}
                          </span>
                        </div>

                        <div className="grid gap-2 text-sm text-slate-500 sm:grid-cols-2">
                          <p>Filial: <span className="font-medium text-slate-700">{getBranchLabel(agent.branchId, branchMap)}</span></p>
                          <p>Estacao: <span className="font-medium text-slate-700">{agent.stationCode || "Nao informada"}</span></p>
                          <p>Versao: <span className="font-medium text-slate-700">{agent.installedVersion || "Nao informada"}</span></p>
                          <p>Ultimo contato: <span className="font-medium text-slate-700">{formatDateTime(agent.lastSeenAt)}</span></p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleRevokeAgent(agent)}
                        disabled={agent.status === "revoked"}
                        className="inline-flex items-center justify-center gap-2 rounded-full border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                      >
                        <Unplug className="h-4 w-4" />
                        {agent.status === "revoked" ? "Revogado" : "Revogar"}
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </article>
      </section>

      <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(360px,0.92fr)]">
        <article className="rounded-[28px] border border-white/60 bg-white p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-950">Rede sincronizada</p>
                <p className="mt-1 text-sm text-slate-500">
                  Cada filial descoberta corresponde a uma base local sincronizada a partir do banco operacional do cliente.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleResyncBranches()}
              disabled={resyncingBranches}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-violet-200 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${resyncingBranches ? "animate-spin" : ""}`} />
              {resyncingBranches ? "Ressincronizando..." : "Ressincronizar rede"}
            </button>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Filiais da rede</p>
              <p className="mt-3 text-2xl font-semibold text-slate-950">{companyBranches.length}</p>
            </div>
            <div className="rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Filiais ativadas</p>
              <p className="mt-3 text-2xl font-semibold text-slate-950">{activeCompanyBranches.length}</p>
            </div>
            <div className="rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Filiais conectadas</p>
              <p className="mt-3 text-2xl font-semibold text-slate-950">{connectedCompanyBranches.length}</p>
            </div>
            <div className="rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">PDVs ativos</p>
              <p className="mt-3 text-2xl font-semibold text-slate-950">{activeAgents.length}</p>
            </div>
          </div>

          <div className="mt-4 rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">Cobertura da rede</p>
                <p className="mt-1 text-sm text-slate-600">
                  {connectedCompanyBranches.length > 0
                    ? `${connectedCompanyBranches.length} filial(is) com app conectado neste momento e ${branchesWithActivePdvs.size} filial(is) com ao menos um PDV ativo vinculado.`
                    : "Nenhuma filial esta com app conectado neste momento. Os vinculos ainda podem existir sem sinal recente."}
                </p>
              </div>
              <div className="max-w-md text-sm text-slate-500">
                {latestDiscoveryBranch?.sourceAgentId
                  ? `Ultima descoberta confirmada por ${getAgentDisplayLabel(agentMap.get(latestDiscoveryBranch.sourceAgentId))}.`
                  : "Nenhum PDV informou ainda a origem da descoberta da rede."}
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 xl:grid-cols-2">
            {companyBranches.length === 0 ? (
              <div className="xl:col-span-2 rounded-[24px] border border-dashed border-slate-200 bg-slate-50/80 px-5 py-6 text-sm text-slate-500">
                Nenhuma empresa sincronizada ainda. Ative o primeiro PDV ou force uma ressincronizacao da rede.
              </div>
            ) : (
              companyBranches.map((branch) => {
                const branchStats = branchOperationalStats.get(branch.branchId) ?? {
                  totalAgents: 0,
                  activeAgents: 0,
                  healthyAgents: 0,
                  revokedAgents: 0,
                  pendingTokens: 0,
                };
                const branchConnected = branchStats.healthyAgents > 0;

                return (
                  <article key={branch.id} className="rounded-[22px] border border-slate-100 bg-slate-50/70 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-950">
                        {branch.branchCode} - {branch.branchName}
                      </p>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          branch.isActive ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {branch.isActive ? "Ativa" : "Inativa"}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          branchConnected ? "bg-sky-50 text-sky-700" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {branchConnected ? "Conectada" : "Desconectada"}
                      </span>
                      <span className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-slate-600">
                        Atualizada {formatDateTime(branch.updatedAt)}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-[18px] border border-white/70 bg-white/80 p-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">PDVs ativos</p>
                        <p className="mt-2 text-xl font-semibold text-slate-950">{branchStats.activeAgents}</p>
                      </div>
                      <div className="rounded-[18px] border border-white/70 bg-white/80 p-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Online recente</p>
                        <p className="mt-2 text-xl font-semibold text-slate-950">{branchStats.healthyAgents}</p>
                      </div>
                      <div className="rounded-[18px] border border-white/70 bg-white/80 p-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Codigos pendentes</p>
                        <p className="mt-2 text-xl font-semibold text-slate-950">{branchStats.pendingTokens}</p>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2 text-sm text-slate-500 sm:grid-cols-2">
                      <p>ID interno: <span className="font-medium text-slate-700">{branch.branchId}</span></p>
                      <p>Total de PDVs: <span className="font-medium text-slate-700">{branchStats.totalAgents}</span></p>
                      <p>PDVs revogados: <span className="font-medium text-slate-700">{branchStats.revokedAgents}</span></p>
                      <p>Ultima leitura da base: <span className="font-medium text-slate-700">{formatDateTime(branch.lastSeenAt)}</span></p>
                      <p>Status de conexao: <span className="font-medium text-slate-700">{branchConnected ? "Conectada" : "Desconectada"}</span></p>
                      <p>Ultima atualizacao: <span className="font-medium text-slate-700">{formatDateTime(branch.updatedAt)}</span></p>
                      <p>Atualizada ha: <span className="font-medium text-slate-700">{formatRelativeTime(branch.updatedAt)}</span></p>
                      <p>
                        Origem da descoberta:{" "}
                        <span className="font-medium text-slate-700">
                          {branch.sourceAgentId ? getAgentDisplayLabel(agentMap.get(branch.sourceAgentId)) : "Nao informado"}
                        </span>
                      </p>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </article>
        <div className="grid content-start self-start gap-4">
          <article className="rounded-[28px] border border-white/60 bg-white p-5 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-950">Gerar codigo de ativacao</p>
                <p className="mt-1 text-sm text-slate-500">
                  Gere um codigo bootstrap para o primeiro PDV ou vincule o pareamento a uma filial ja descoberta na rede.
                </p>
              </div>
            </div>

            <form className="mt-5 grid gap-3.5" onSubmit={(event) => void handleCreateToken(event)}>
              <label className="grid gap-2 text-sm font-medium text-slate-700">
                Filial
                <select
                  value={branchId}
                  onChange={(event) => setBranchId(event.target.value)}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-violet-300 focus:bg-white"
                >
                  {branchOptions.length === 0 ? (
                    <option value="">Primeiro PDV</option>
                  ) : (
                    <option value="" disabled>
                      Selecione uma filial
                    </option>
                  )}
                  {branchOptions.map((item) => {
                    const value = item.value?.trim() || item.code.trim();
                    return (
                      <option key={value} value={value}>
                        {item.code} - {item.name}
                      </option>
                    );
                  })}
                </select>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium text-slate-700">
                  Estacao sugerida
                  <input
                    value={stationCode}
                    onChange={(event) => setStationCode(event.target.value.toUpperCase())}
                    placeholder="Ex.: CAIXA-01"
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-violet-300 focus:bg-white"
                  />
                </label>

                <label className="grid gap-2 text-sm font-medium text-slate-700">
                  Validade do codigo
                  <select
                    value={expiresInMinutes}
                    onChange={(event) => setExpiresInMinutes(Number(event.target.value))}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-violet-300 focus:bg-white"
                  >
                    {pairingExpirationOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="grid gap-2 text-sm font-medium text-slate-700">
                Descricao interna
                <input
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Ex.: Caixa da pista 1"
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-violet-300 focus:bg-white"
                />
              </label>

              <button
                type="submit"
                disabled={submitting || (branchOptions.length > 0 && !branchId)}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <KeyRound className="h-4 w-4" />
                {submitting
                  ? "Gerando codigo..."
                  : branchOptions.length === 0
                    ? "Gerar codigo bootstrap"
                    : "Gerar codigo da filial"}
              </button>
            </form>

            {branchOptions.length === 0 ? (
              <div className="mt-3 rounded-[20px] border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Nenhuma filial sincronizada ainda. Gere um codigo bootstrap, ative o primeiro PDV e deixe o app sincronizar a
                descoberta da rede antes de vincular os proximos terminais a uma filial especifica.
              </div>
            ) : null}

            {lastCreatedToken ? (
              <div className="mt-4 rounded-[24px] border border-emerald-100 bg-emerald-50/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-emerald-600">Ultimo codigo gerado</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <p className="text-2xl font-semibold tracking-[0.18em] text-emerald-800">{lastCreatedToken.tokenCode}</p>
                  <button
                    type="button"
                    onClick={() => void handleCopyToken(lastCreatedToken.tokenCode)}
                    className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-2 text-sm font-medium text-emerald-700 transition hover:border-emerald-300"
                  >
                    <Copy className="h-4 w-4" />
                    Copiar
                  </button>
                </div>
                <p className="mt-2 text-sm text-emerald-700">
                  {getBranchLabel(lastCreatedToken.branchId, branchMap)} · expira em {formatDateTime(lastCreatedToken.expiresAt)}
                </p>
              </div>
            ) : null}
          </article>

          <article className="rounded-[28px] border border-white/60 bg-white p-5 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-lg font-semibold text-slate-950">Visao operacional</p>
                <p className="mt-1 text-sm text-slate-500">
                  Veja a distribuicao dos PDVs por filial e acompanhe a cobertura da rede em cada base local.
                </p>
              </div>
              <select
                value={selectedBranchFilter}
                onChange={(event) => setSelectedBranchFilter(event.target.value)}
                className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 outline-none transition focus:border-violet-300 focus:bg-white"
              >
                <option value="all">Todas as filiais</option>
                {branchOptions.map((item) => {
                  const value = item.value?.trim() || item.code.trim();
                  return (
                    <option key={value} value={value}>
                      {item.code} - {item.name}
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">PDVs no filtro</p>
                <p className="mt-3 text-2xl font-semibold text-slate-950">
                  {filteredAgents.length}
                </p>
              </div>
              <div className="rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Codigos pendentes</p>
                <p className="mt-3 text-2xl font-semibold text-slate-950">
                  {filteredPendingTokens.length}
                </p>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Filiais com sinal recente</p>
                <p className="mt-3 text-2xl font-semibold text-slate-950">
                  {selectedBranchFilter === "all"
                    ? branchesWithHealthyPdvs.size
                    : branchesWithHealthyPdvs.has(selectedBranchFilter)
                      ? 1
                      : 0}
                </p>
              </div>
              <div className="rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Bases sincronizadas</p>
                <p className="mt-3 text-2xl font-semibold text-slate-950">
                  {branchesLoading ? "..." : selectedBranchFilter === "all" ? companyBranches.length : companyBranches.filter((item) => item.branchId === selectedBranchFilter).length}
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
              <p className="text-sm font-medium text-slate-900">Fluxo de implantacao</p>
              <ol className="mt-3 grid gap-2 text-sm text-slate-600">
                <li>1. Gere um codigo bootstrap para ativar o primeiro PDV da rede sem depender de filial previa.</li>
                <li>2. Deixe o app identificar a filial local, sincronizar a base e descobrir as demais unidades do cliente.</li>
                <li>3. Depois distribua os proximos codigos por filial e acompanhe o sinal recente de cada PDV por base.</li>
              </ol>
            </div>
          </article>

          <article className="rounded-[28px] border border-white/60 bg-white p-5 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.25)]">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-950">Codigos recentes</p>
                <p className="text-sm text-slate-500">Historico de ativacoes emitidas para as filiais da empresa.</p>
              </div>
            </div>

            <div className="mt-5 grid gap-4">
              {loading ? (
                <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/80 px-5 py-6 text-sm text-slate-500">
                  Carregando codigos recentes...
                </div>
              ) : filteredTokens.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/80 px-5 py-6 text-sm text-slate-500">
                  Nenhum codigo de ativacao encontrado para o filtro atual.
                </div>
              ) : (
                filteredTokens.slice(0, 8).map((token) => (
                  <article key={token.id} className="rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold tracking-[0.12em] text-slate-950">{token.tokenCode}</p>
                        <p className="mt-1 text-sm text-slate-500">{getBranchLabel(token.branchId, branchMap)}</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${pairingStatusStyles[token.status]}`}>
                        {pairingStatusLabels[token.status]}
                      </span>
                    </div>

                    <div className="mt-3 grid gap-2 text-sm text-slate-500">
                      <p>Descricao: <span className="font-medium text-slate-700">{token.description || "Nao informada"}</span></p>
                      <p>Estacao sugerida: <span className="font-medium text-slate-700">{token.stationCode || "Nao informada"}</span></p>
                      <p>Expira em: <span className="font-medium text-slate-700">{formatDateTime(token.expiresAt)}</span></p>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleCopyToken(token.tokenCode)}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-violet-200 hover:text-violet-700"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copiar
                      </button>
                      {token.status === "pending" ? (
                        <span className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700">
                          <ShieldAlert className="h-3.5 w-3.5" />
                          Aguardando ativacao
                        </span>
                      ) : null}
                    </div>
                  </article>
                ))
              )}
            </div>
          </article>
        </div>
      </section>

      {feedback ? (
        <section className="rounded-[24px] border border-emerald-100 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-700">
          {feedback}
        </section>
      ) : null}

      {error ? (
        <section className="rounded-[24px] border border-rose-100 bg-rose-50 px-5 py-4 text-sm font-medium text-rose-700">
          {error}
        </section>
      ) : null}

    </AppShell>
  );
}
