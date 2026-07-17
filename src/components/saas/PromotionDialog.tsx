import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  BadgePercent,
  Building2,
  Boxes,
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Globe,
  Search,
  Sparkles,
  UserRoundPlus,
  UsersRound,
  Wallet,
  WandSparkles,
  X,
} from "lucide-react";
import ModernDateInput from "@/components/ModernDateInput";
import { useReferenceData } from "@/hooks/useReferenceData";
import type { CreatePromotionInput, PromotionStatus, PromotionWeekday } from "@/types/saas";
import CompactComboBox from "./CompactComboBox";

type WizardStep = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type PromotionPayload = CreatePromotionInput;

interface PromotionDialogProps {
  open: boolean;
  initialValue?: PromotionPayload | null;
  submitError?: string | null;
  onClose(): void;
  onSubmit(payload: PromotionPayload): Promise<void> | void;
}

const steps = [
  { label: "Início", shortLabel: "1", icon: Sparkles },
  { label: "Produtos", shortLabel: "2", icon: Boxes },
  { label: "Público", shortLabel: "3", icon: UsersRound },
  { label: "Filiais", shortLabel: "4", icon: Building2 },
  { label: "Pagamento", shortLabel: "5", icon: Wallet },
  { label: "Regras", shortLabel: "6", icon: CalendarRange },
  { label: "Resumo", shortLabel: "7", icon: ClipboardList },
] as const;

const defaultActiveWeekdays: PromotionWeekday[] = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];

const initialForm: PromotionPayload = {
  name: "",
  voucherCode: "",
  description: "",
  discountType: "fixed",
  discountValue: "0,15",
  productMode: "individual",
  selectedProductCodes: [],
  selectedProductGroupCodes: [],
  audienceMode: "individual",
  newCustomerFirstPurchaseOnly: false,
  newCustomerDays: "30",
  selectedCustomerCodes: [],
  selectedCustomerGroupCodes: [],
  selectedBranchIds: [],
  paymentMode: "all",
  selectedPaymentFormCodes: [],
  startDate: "",
  endDate: "",
  startTime: "",
  endTime: "",
  activeWeekdays: defaultActiveWeekdays,
  birthdayOnly: false,
  maxDiscountPerDay: "",
  maxVolumePerDay: "",
  maxQuantityPerItem: "",
  redemptionsPerCustomer: "",
  maxPurchasesPerWeek: "",
  maxPurchasesPerMonth: "",
  couponValidityMinutes: "15",
  status: "ativa",
};

const discountTypeOptions = [
  { value: "fixed", label: "Valor fixo (R$)" },
  { value: "percent", label: "Percentual (%)" },
] as const;

const weekdayOptions = [
  { value: "dom", label: "Dom" },
  { value: "seg", label: "Seg" },
  { value: "ter", label: "Ter" },
  { value: "qua", label: "Qua" },
  { value: "qui", label: "Qui" },
  { value: "sex", label: "Sex" },
  { value: "sab", label: "Sáb" },
] as const;

const promotionStatusOptions = [
  { value: "ativa", label: "Ativa" },
  { value: "agendada", label: "Agendada" },
  { value: "pausada", label: "Pausada" },
  { value: "encerrada", label: "Encerrada" },
] as const;

function createVoucherCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function formatDateLabel(value: string) {
  if (!value) {
    return "Não definido";
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return value;
  }

  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

function formatTimeLabel(value: string) {
  return value || "Livre";
}

function joinLabels(labels: string[], emptyLabel: string) {
  return labels.length > 0 ? labels.join(", ") : emptyLabel;
}

function getNewCustomerAudienceLabel(firstPurchaseOnly: boolean, days: string) {
  if (firstPurchaseOnly) {
    return "Clientes novos · primeira compra";
  }

  const normalizedDays = Number(days);
  if (Number.isFinite(normalizedDays) && normalizedDays > 0) {
    return `Clientes novos · ${normalizedDays} dia(s)`;
  }

  return "Clientes novos";
}

function StepBadge({
  index,
  currentStep,
  label,
  disabled,
  onClick,
}: {
  index: number;
  currentStep: WizardStep;
  label: string;
  disabled: boolean;
  onClick(): void;
}) {
  const complete = index < currentStep;
  const active = index === currentStep;

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={[
          "inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm font-semibold transition",
          disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer",
          complete
            ? disabled
              ? "border-slate-200 bg-white text-slate-700"
              : "border-slate-200 bg-white text-slate-800 hover:border-violet-200 hover:text-violet-700"
            : active
              ? "border-violet-200 bg-violet-100 text-slate-950"
              : disabled
                ? "border-transparent bg-transparent text-slate-300"
                : "border-transparent bg-transparent text-slate-500 hover:bg-white hover:text-slate-800",
        ].join(" ")}
      >
        <span
          className={[
            "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs",
            complete ? "bg-slate-100 text-slate-700" : active ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-400",
          ].join(" ")}
        >
          {complete ? <Check className="h-3.5 w-3.5" /> : index + 1}
        </span>
        <span>{label}</span>
      </button>
      {index < steps.length - 1 ? <div className="hidden h-px w-10 bg-slate-200 md:block" /> : null}
    </div>
  );
}

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-2 text-sm text-slate-600">
      <span className="font-semibold text-slate-800">{label}</span>
      {description ? <span className="-mt-1 text-xs text-slate-400">{description}</span> : null}
      {children}
    </label>
  );
}

function ChoiceCard({
  title,
  description,
  active,
  icon,
  onClick,
  compact = false,
}: {
  title: string;
  description: string;
  active: boolean;
  icon: ReactNode;
  onClick(): void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex min-h-[5rem] w-full items-center justify-between rounded-[22px] border text-left transition",
        compact ? "px-4 py-3" : "px-5 py-4",
        active
          ? "border-violet-200 bg-white shadow-[0_8px_24px_-16px_rgba(109,40,217,0.5)]"
          : "border-slate-200 bg-white hover:border-slate-300",
      ].join(" ")}
    >
      <div className={`flex min-w-0 items-center ${compact ? "gap-3" : "gap-4"}`}>
        <div
          className={[
            "flex shrink-0 items-center justify-center",
            compact ? "h-10 w-10 rounded-xl" : "h-12 w-12 rounded-2xl",
            active ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-400",
          ].join(" ")}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className={compact ? "text-base font-semibold leading-tight text-slate-900" : "text-lg font-semibold text-slate-900"}>
            {title}
          </p>
          <p className={compact ? "mt-1 text-[13px] leading-snug text-slate-500" : "text-sm text-slate-500"}>{description}</p>
        </div>
      </div>
      <span
        className={[
          "inline-flex shrink-0 items-center justify-center rounded-full border",
          compact ? "h-5 w-5" : "h-6 w-6",
          active ? "border-violet-600 bg-violet-600 text-white" : "border-slate-200 bg-white text-white",
        ].join(" ")}
      >
        <Check className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
      </span>
    </button>
  );
}

function SearchField({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string;
  value: string;
  onChange(value: string): void;
}) {
  return (
    <label className="saas-compact-search rounded-none border-x-0 border-t-0 border-b border-slate-100 bg-white px-4 py-2.5 text-slate-400 focus-within:rounded-none focus-within:bg-white">
      <Search className="h-3.5 w-3.5 shrink-0" />
      <input
        className="text-sm"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            onChange("");
          }
        }}
      />
    </label>
  );
}

function SelectableList({
  items,
  selectedCodes,
  helperByCode,
  emptyMessage,
  loading,
  prioritizeSelected = true,
  onToggle,
}: {
  items: Array<{ code: string; name: string }>;
  selectedCodes: string[];
  helperByCode?: Record<string, string>;
  emptyMessage: string;
  loading: boolean;
  prioritizeSelected?: boolean;
  onToggle(code: string): void;
}) {
  const orderedItems = useMemo(() => {
    if (!prioritizeSelected) {
      return items;
    }

    const selectedSet = new Set(selectedCodes);
    return [...items].sort((left, right) => Number(selectedSet.has(right.code)) - Number(selectedSet.has(left.code)));
  }, [items, prioritizeSelected, selectedCodes]);

  return (
    <div className="overflow-hidden rounded-[22px] border border-slate-200 bg-white">
      <div className="max-h-[18.5rem] overflow-y-auto">
        {loading ? (
          <div className="px-4 py-4 text-sm text-slate-500">Carregando opcoes...</div>
        ) : orderedItems.length === 0 ? (
          <div className="px-4 py-4 text-sm text-slate-500">{emptyMessage}</div>
        ) : (
          orderedItems.map((item) => {
            const selected = selectedCodes.includes(item.code);
            return (
              <button
                key={item.code}
                type="button"
                onClick={() => onToggle(item.code)}
                className={[
                  "flex w-full items-start gap-3 border-b border-slate-100 px-4 py-2.5 text-left transition last:border-b-0",
                  selected ? "bg-violet-50/60" : "bg-white hover:bg-slate-50",
                ].join(" ")}
              >
                <span
                  className={[
                    "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                    selected ? "border-violet-600 bg-violet-600 text-white" : "border-slate-300 bg-white text-white",
                  ].join(" ")}
                >
                  <Check className="h-3 w-3" />
                </span>
                <span className="grid gap-px">
                  <span className="text-sm font-semibold leading-5 tracking-tight text-slate-900">{item.name}</span>
                  {helperByCode?.[item.code] ? (
                    <span className="text-xs leading-4 text-slate-400">{helperByCode[item.code]}</span>
                  ) : null}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between rounded-[22px] border border-slate-200 bg-white px-5 py-4 text-left transition hover:border-slate-300"
    >
      <div>
        <p className="font-semibold text-slate-900">{title}</p>
        <p className="text-sm text-slate-500">{description}</p>
      </div>
      <span
        className={[
          "relative inline-flex h-7 w-12 rounded-full transition",
          checked ? "bg-violet-600" : "bg-slate-200",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-1 h-5 w-5 rounded-full bg-white shadow transition",
            checked ? "left-6" : "left-1",
          ].join(" ")}
        />
      </span>
    </button>
  );
}

function SummarySection({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bg-white p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</p>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 text-sm text-slate-700">{children}</div>
    </section>
  );
}

function SummaryRow({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="grid gap-1 border-b border-slate-100 pb-3 last:border-b-0 last:pb-0 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:items-start sm:gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</span>
      <span className={["min-w-0 text-sm text-slate-700", emphasize ? "font-semibold text-slate-950" : ""].join(" ")}>
        {value}
      </span>
    </div>
  );
}

export default function PromotionDialog({ open, initialValue, submitError, onClose, onSubmit }: PromotionDialogProps) {
  const [step, setStep] = useState<WizardStep>(0);
  const [form, setForm] = useState<PromotionPayload>(initialForm);
  const [error, setError] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [productGroupSearch, setProductGroupSearch] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerGroupSearch, setCustomerGroupSearch] = useState("");
  const [branchSearch, setBranchSearch] = useState("");
  const [paymentSearch, setPaymentSearch] = useState("");

  const { items: productItems, loading: productsLoading } = useReferenceData(
    "products",
    productSearch,
    productSearch.trim() ? [] : form.selectedProductCodes,
  );
  const { items: productGroups, loading: productGroupsLoading } = useReferenceData("product-groups", productGroupSearch);
  const { items: customerItems, loading: customersLoading } = useReferenceData("customers", customerSearch);
  const { items: customerGroups, loading: customerGroupsLoading } = useReferenceData("customer-groups", customerGroupSearch);
  const { items: branchOptions, loading: branchesLoading } = useReferenceData("branches", branchSearch);
  const { items: paymentForms, loading: paymentsLoading } = useReferenceData("payment-forms", paymentSearch);

  useEffect(() => {
    if (!open) {
      setStep(0);
      setForm(initialForm);
      setError(null);
      setProductSearch("");
      setProductGroupSearch("");
      setCustomerSearch("");
      setCustomerGroupSearch("");
      setBranchSearch("");
      setPaymentSearch("");
      return;
    }

    setForm(
      initialValue
        ? {
            ...initialValue,
            couponValidityMinutes: initialValue.couponValidityMinutes?.trim() || "15",
          }
        : { ...initialForm, voucherCode: createVoucherCode() },
    );
    setError(null);
  }, [initialValue, open]);

  const productHelperByCode = useMemo<Record<string, string>>(() => {
    return Object.fromEntries(
      productItems.map((item) => [item.value ?? item.code, item.value ? `Código ${item.code}` : "Produto ativo"]),
    );
  }, [productItems]);

  const customerHelperByCode = useMemo<Record<string, string>>(() => {
    return Object.fromEntries(customerItems.map((item) => [item.value ?? item.code, `Cliente ${item.code}`]));
  }, [customerItems]);

  const paymentHelperByCode = useMemo<Record<string, string>>(() => {
    return Object.fromEntries(paymentForms.map((item) => [item.value ?? item.code, `Forma ${item.code}`]));
  }, [paymentForms]);

  const productSelectableItems = useMemo(() => {
    return productItems.map((item) => ({
      code: item.value ?? item.code,
      name: item.name,
    }));
  }, [productItems]);

  const customerSelectableItems = useMemo(() => {
    return customerItems.map((item) => ({
      code: item.value ?? item.code,
      name: item.name,
    }));
  }, [customerItems]);

  const paymentSelectableItems = useMemo(() => {
    return paymentForms.map((item) => ({
      code: item.value ?? item.code,
      name: item.name,
    }));
  }, [paymentForms]);

  const branchItems = useMemo(() => {
    return branchOptions.map((item) => ({
      code: item.value ?? item.code,
      name: item.name,
    }));
  }, [branchOptions]);

  const branchHelperByCode = useMemo<Record<string, string>>(() => {
    return Object.fromEntries(branchOptions.map((item) => [item.value ?? item.code, `Código ${item.code}`]));
  }, [branchOptions]);

  const productNameByCode = useMemo<Record<string, string>>(() => {
    return Object.fromEntries(productItems.map((item) => [item.value ?? item.code, item.name]));
  }, [productItems]);

  const customerNameByCode = useMemo<Record<string, string>>(() => {
    return Object.fromEntries(customerItems.map((item) => [item.value ?? item.code, item.name]));
  }, [customerItems]);

  const paymentNameByCode = useMemo<Record<string, string>>(() => {
    return Object.fromEntries(paymentForms.map((item) => [item.value ?? item.code, item.name]));
  }, [paymentForms]);

  const branchNameByCode = useMemo<Record<string, string>>(() => {
    return Object.fromEntries(branchOptions.map((item) => [item.value ?? item.code, item.name]));
  }, [branchOptions]);

  const productCount = form.productMode === "group" ? form.selectedProductGroupCodes.length : form.selectedProductCodes.length;
  const customerCount =
    form.audienceMode === "all"
      ? 0
      : form.audienceMode === "firstPurchase"
        ? 0
      : form.audienceMode === "group"
        ? form.selectedCustomerGroupCodes.length
        : form.selectedCustomerCodes.length;
  const branchCount = form.selectedBranchIds.length;
  const paymentCount =
    form.paymentMode === "all" ? paymentForms.length : form.selectedPaymentFormCodes.length;
  const selectedWeekdayLabels = weekdayOptions
    .filter((option) => form.activeWeekdays.includes(option.value))
    .map((option) => option.label);
  const selectedProductLabels = form.selectedProductCodes.map((code) => productNameByCode[code] || `Produto ${code}`);
  const selectedCustomerLabels = form.selectedCustomerCodes.map((code) => customerNameByCode[code] || `Cliente ${code}`);
  const selectedBranchLabels = form.selectedBranchIds.map((code) => branchNameByCode[code] || `Filial ${code}`);
  const selectedPaymentLabels = form.selectedPaymentFormCodes.map((code) => paymentNameByCode[code] || `Forma ${code}`);
  const selectedProductGroupNames = form.selectedProductGroupCodes.map(
    (code) => productGroups.find((item) => item.code === code)?.name || `Grupo ${code}`,
  );
  const selectedCustomerGroupNames = form.selectedCustomerGroupCodes.map(
    (code) => customerGroups.find((item) => item.code === code)?.name || `Grupo ${code}`,
  );
  const isEditing = Boolean(initialValue);
  const maxNavigableStep = useMemo<WizardStep>(() => {
    if (isEditing) {
      return 6;
    }

    let highestStep = 0 as WizardStep;

    for (let index = 0; index <= 5; index += 1) {
      const currentIndex = index as WizardStep;
      const stepError = validateStep(currentIndex);

      if (stepError) {
        return highestStep;
      }

      highestStep = Math.min(6, index + 1) as WizardStep;
    }

    return 6;
  }, [form, isEditing]);

  if (!open) {
    return null;
  }

  function updateField<K extends keyof PromotionPayload>(field: K, value: PromotionPayload[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setError(null);
  }

  function setProductMode(mode: PromotionPayload["productMode"]) {
    setForm((current) => ({
      ...current,
      productMode: mode,
      selectedProductCodes: mode === "group" ? [] : current.selectedProductCodes,
      selectedProductGroupCodes: mode === "individual" ? [] : current.selectedProductGroupCodes,
    }));
    setError(null);
  }

  function setAudienceMode(mode: PromotionPayload["audienceMode"]) {
    setForm((current) => ({
      ...current,
      audienceMode: mode,
      selectedCustomerCodes: mode === "individual" ? current.selectedCustomerCodes : [],
      selectedCustomerGroupCodes: mode === "group" ? current.selectedCustomerGroupCodes : [],
    }));
    setError(null);
  }

  function selectAllBranches() {
    setForm((current) => ({
      ...current,
      selectedBranchIds: branchItems.map((item) => item.code),
    }));
    setError(null);
  }

  function clearBranches() {
    setForm((current) => ({
      ...current,
      selectedBranchIds: [],
    }));
    setError(null);
  }

  function toggleNewCustomerFirstPurchaseOnly() {
    setForm((current) => ({
      ...current,
      newCustomerFirstPurchaseOnly: !current.newCustomerFirstPurchaseOnly,
    }));
    setError(null);
  }

  function toggleSelection(
    field:
      | "selectedProductCodes"
      | "selectedProductGroupCodes"
      | "selectedCustomerCodes"
      | "selectedCustomerGroupCodes"
      | "selectedBranchIds"
      | "selectedPaymentFormCodes",
    code: string,
  ) {
    setForm((current) => {
      const nextValues = current[field].includes(code)
        ? current[field].filter((item) => item !== code)
        : [...current[field], code];

      if (field === "selectedProductCodes") {
        return {
          ...current,
          productMode: "individual",
          selectedProductCodes: nextValues,
          selectedProductGroupCodes: [],
        };
      }

      if (field === "selectedProductGroupCodes") {
        return {
          ...current,
          productMode: "group",
          selectedProductGroupCodes: nextValues,
          selectedProductCodes: [],
        };
      }

      if (field === "selectedCustomerCodes") {
        return {
          ...current,
          audienceMode: "individual",
          selectedCustomerCodes: nextValues,
          selectedCustomerGroupCodes: [],
        };
      }

      if (field === "selectedCustomerGroupCodes") {
        return {
          ...current,
          audienceMode: "group",
          selectedCustomerGroupCodes: nextValues,
          selectedCustomerCodes: [],
        };
      }

      return {
        ...current,
        [field]: nextValues,
      };
    });
    setError(null);
  }

  function toggleWeekday(code: PromotionWeekday) {
    setForm((current) => ({
      ...current,
      activeWeekdays: current.activeWeekdays.includes(code)
        ? current.activeWeekdays.filter((item) => item !== code)
        : [...current.activeWeekdays, code],
    }));
    setError(null);
  }

  function validateStep(currentStep: WizardStep) {
    if (currentStep === 0) {
      if (!form.name.trim()) {
        return "Informe o nome da campanha.";
      }
      if (!form.voucherCode.trim()) {
        return "Informe ou gere o codigo do voucher.";
      }
      if (!form.discountValue.trim()) {
        return "Informe o valor do desconto.";
      }
    }

    if (currentStep === 1) {
      if (form.productMode === "group" && form.selectedProductGroupCodes.length === 0) {
        return "Selecione ao menos um grupo de produtos.";
      }
      if (form.productMode === "individual" && form.selectedProductCodes.length === 0) {
        return "Selecione ao menos um produto alvo.";
      }
    }

    if (currentStep === 2) {
      if (form.audienceMode === "group" && form.selectedCustomerGroupCodes.length === 0) {
        return "Selecione ao menos um grupo de clientes.";
      }
      if (form.audienceMode === "individual" && form.selectedCustomerCodes.length === 0) {
        return "Selecione ao menos um cliente.";
      }
      if (form.audienceMode === "firstPurchase") {
        const newCustomerDays = Number(form.newCustomerDays);
        if (
          !form.newCustomerFirstPurchaseOnly &&
          (!Number.isInteger(newCustomerDays) || newCustomerDays <= 0)
        ) {
          return "Informe a quantidade de dias em que o cliente sera considerado novo.";
        }
      }
    }

    if (currentStep === 4) {
      if (form.paymentMode === "selected" && form.selectedPaymentFormCodes.length === 0) {
        return "Selecione ao menos uma forma de pagamento.";
      }
    }

    if (currentStep === 3 && form.selectedBranchIds.length === 0) {
      return "Selecione ao menos uma filial participante.";
    }

    if (currentStep === 5) {
      if (!form.startDate) {
        return "Informe a data de início da regra.";
      }
      if (!form.endDate) {
        return "Informe a data de término da regra.";
      }
      if (form.startDate > form.endDate) {
        return "A data de término deve ser maior ou igual à data de início.";
      }
      if (form.startDate === form.endDate && form.startTime && form.endTime && form.startTime > form.endTime) {
        return "A hora final deve ser maior que a hora inicial.";
      }
      if (form.activeWeekdays.length === 0) {
        return "Selecione ao menos um dia da semana.";
      }
      if (!form.couponValidityMinutes.trim()) {
        return "Informe a validade do código em minutos.";
      }
    }

    return null;
  }

  function handleNext() {
    const stepError = validateStep(step);
    if (stepError) {
      setError(stepError);
      return;
    }

    setStep((current) => Math.min(6, current + 1) as WizardStep);
  }

  function handlePrevious() {
    setError(null);
    setStep((current) => Math.max(0, current - 1) as WizardStep);
  }

  async function handleSubmit() {
    const stepError = validateStep(step);
    if (stepError) {
      setError(stepError);
      return;
    }

    await onSubmit(form);
    onClose();
  }

  const rulesPeriodLabel = `${formatDateLabel(form.startDate)} até ${formatDateLabel(form.endDate)}`;
  const rulesTimeLabel = `${formatTimeLabel(form.startTime)} até ${formatTimeLabel(form.endTime)}`;
  const rulesWeekdayLabel = joinLabels(selectedWeekdayLabels, "Todos os dias");
  const productsSummaryLabel =
    form.productMode === "group"
      ? joinLabels(selectedProductGroupNames.slice(0, 4), "Nenhum grupo selecionado") +
        (selectedProductGroupNames.length > 4 ? ` +${selectedProductGroupNames.length - 4}` : "")
      : joinLabels(
          selectedProductLabels.slice(0, 4),
          "Nenhum produto selecionado",
        ) + (selectedProductLabels.length > 4 ? ` +${selectedProductLabels.length - 4}` : "");
  const audienceSummaryLabel =
    form.audienceMode === "all"
      ? "Toda a base"
      : form.audienceMode === "firstPurchase"
        ? getNewCustomerAudienceLabel(form.newCustomerFirstPurchaseOnly, form.newCustomerDays)
        : form.audienceMode === "group"
          ? joinLabels(selectedCustomerGroupNames.slice(0, 4), "Nenhum grupo selecionado") +
            (selectedCustomerGroupNames.length > 4 ? ` +${selectedCustomerGroupNames.length - 4}` : "")
          : joinLabels(
              selectedCustomerLabels.slice(0, 4),
              "Nenhum cliente selecionado",
            ) + (selectedCustomerLabels.length > 4 ? ` +${selectedCustomerLabels.length - 4}` : "");
  const branchesSummaryLabel =
    form.selectedBranchIds.length === 0
      ? "Nenhuma filial selecionada"
      : joinLabels(selectedBranchLabels.slice(0, 4), "Nenhuma filial selecionada") +
        (selectedBranchLabels.length > 4 ? ` +${selectedBranchLabels.length - 4}` : "");
  const paymentsSummaryLabel =
    form.paymentMode === "all"
      ? "Todas as formas"
      : joinLabels(selectedPaymentLabels.slice(0, 4), "Nenhuma forma selecionada") +
        (selectedPaymentLabels.length > 4 ? ` +${selectedPaymentLabels.length - 4}` : "");
  const discountSummaryLabel = `${form.discountType === "fixed" ? "Valor fixo" : "Percentual"} ${form.discountValue || "0"}`;
  const statusSummaryLabel = promotionStatusOptions.find((option) => option.value === form.status)?.label || form.status;
  const productScopeLabel = form.productMode === "group" ? `${productCount} grupo(s)` : `${productCount} produto(s)`;
  const audienceScopeLabel =
    form.audienceMode === "all"
      ? "Toda a base"
      : form.audienceMode === "firstPurchase"
        ? "Clientes novos"
        : form.audienceMode === "group"
          ? `${customerCount} grupo(s)`
          : `${customerCount} cliente(s)`;
  const branchScopeLabel = branchCount === 0 ? "0 filial" : `${branchCount} filial(is)`;
  const paymentScopeLabel = form.paymentMode === "all" ? "Todas as formas" : `${form.selectedPaymentFormCodes.length} forma(s)`;

  function handleStepNavigation(targetStep: WizardStep) {
    if (isEditing || targetStep <= maxNavigableStep || targetStep === step) {
      setError(null);
      setStep(targetStep);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-4 backdrop-blur-sm">
      <div className="flex h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] w-full max-w-[72rem] flex-col overflow-hidden rounded-[30px] border border-white/70 bg-[#f6f7fb] shadow-[0_40px_120px_-40px_rgba(15,23,42,0.45)]">
        <div className="flex items-center justify-between border-b border-slate-200/80 px-6 py-5">
          <h2 className="text-[2rem] font-semibold tracking-tight text-slate-950">
            {isEditing ? "Editar promoção" : "Nova promoção"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-400 transition hover:bg-white hover:text-slate-700"
            aria-label="Fechar modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b border-slate-200/80 px-6 py-5">
          <div className="flex flex-wrap items-center gap-2 md:gap-0">
            {steps.map((item, index) => (
              <StepBadge
                key={item.label}
                index={index}
                currentStep={step}
                label={item.label}
                disabled={!isEditing && index > maxNavigableStep && index !== step}
                onClick={() => handleStepNavigation(index as WizardStep)}
              />
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex h-full w-full max-w-[64rem] flex-col px-7 py-7">
          {step === 0 ? (
            <div className="grid gap-6">
              <Field label="Nome da campanha">
                <input
                  className="saas-input rounded-[18px] border-slate-200 bg-white"
                  placeholder="Ex: Desconto Gasolina Fim de Semana"
                  value={form.name}
                  onChange={(event) => updateField("name", event.target.value)}
                />
              </Field>

              <Field label="Código do voucher" description="Codigo que aparece no app do cliente para usar no caixa.">
                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                  <input
                    className="saas-input rounded-[18px] border-slate-200 bg-white"
                    placeholder="Ex: GAS10"
                    value={form.voucherCode}
                    onChange={(event) => updateField("voucherCode", event.target.value.toUpperCase())}
                  />
                  <button
                    type="button"
                    onClick={() => updateField("voucherCode", createVoucherCode())}
                    className="inline-flex items-center justify-center gap-2 rounded-[18px] border border-slate-200 bg-white px-5 py-3 font-semibold text-slate-700 transition hover:border-violet-200 hover:text-violet-700"
                  >
                    <WandSparkles className="h-4 w-4" />
                    Gerar
                  </button>
                </div>
              </Field>

              <Field label="Descrição (opcional)">
                <textarea
                  className="saas-input min-h-[8rem] rounded-[18px] border-slate-200 bg-white"
                  value={form.description}
                  onChange={(event) => updateField("description", event.target.value)}
                />
              </Field>

              <div className="grid gap-5 md:grid-cols-2">
                <Field label="Tipo de desconto">
                  <CompactComboBox
                    value={form.discountType}
                    options={[...discountTypeOptions]}
                    onChange={(value) => updateField("discountType", value as PromotionPayload["discountType"])}
                  />
                </Field>

                <Field label="Valor do desconto">
                  <input
                    className="saas-input rounded-[18px] border-slate-200 bg-white"
                    placeholder="0,15"
                    value={form.discountValue}
                    onChange={(event) => updateField("discountValue", event.target.value)}
                  />
                </Field>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="grid gap-6">
              <div>
                <p className="text-3xl font-semibold tracking-tight text-slate-900">Produtos alvo</p>
                <p className="mt-1 text-sm text-slate-500">Escolha como definir os produtos com desconto.</p>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <ChoiceCard
                  title="Grupo de produtos"
                  description="Usar um grupo ja cadastrado"
                  active={form.productMode === "group"}
                  icon={<Boxes className="h-6 w-6" />}
                  onClick={() => setProductMode("group")}
                />
                <ChoiceCard
                  title="Produtos avulsos"
                  description="Escolher um ou mais produtos"
                  active={form.productMode === "individual"}
                  icon={<Sparkles className="h-6 w-6" />}
                  onClick={() => setProductMode("individual")}
                />
              </div>

              {form.productMode === "group" ? (
                <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
                  <SearchField
                    placeholder="Buscar grupos de produtos..."
                    value={productGroupSearch}
                    onChange={setProductGroupSearch}
                  />
                  <SelectableList
                    items={productGroups}
                    selectedCodes={form.selectedProductGroupCodes}
                    emptyMessage="Nenhum grupo de produtos encontrado."
                    loading={productGroupsLoading}
                    prioritizeSelected={!productGroupSearch.trim()}
                    onToggle={(code) => toggleSelection("selectedProductGroupCodes", code)}
                  />
                </div>
              ) : (
                <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
                  <SearchField
                    placeholder="Buscar produtos..."
                    value={productSearch}
                    onChange={setProductSearch}
                  />
                  <SelectableList
                    items={productSelectableItems}
                    selectedCodes={form.selectedProductCodes}
                    helperByCode={productHelperByCode}
                    emptyMessage="Nenhum produto encontrado."
                    loading={productsLoading}
                    prioritizeSelected={!productSearch.trim()}
                    onToggle={(code) => toggleSelection("selectedProductCodes", code)}
                  />
                </div>
              )}

              <p className="text-sm text-slate-400">
                {productCount} produto(s) selecionado(s).
              </p>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid gap-6">
              <div>
                <p className="text-3xl font-semibold tracking-tight text-slate-900">Público</p>
                <p className="mt-1 text-sm text-slate-500">Escolha quais clientes podem resgatar.</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <ChoiceCard
                  title="Todos"
                  description="Toda a base de clientes"
                  active={form.audienceMode === "all"}
                  icon={<Globe className="h-6 w-6" />}
                  onClick={() => setAudienceMode("all")}
                  compact
                />
                <ChoiceCard
                  title="Grupo"
                  description="Um grupo ja cadastrado"
                  active={form.audienceMode === "group"}
                  icon={<UsersRound className="h-6 w-6" />}
                  onClick={() => setAudienceMode("group")}
                  compact
                />
                <ChoiceCard
                  title="Avulsos"
                  description="Escolher clientes"
                  active={form.audienceMode === "individual"}
                  icon={<UserRoundPlus className="h-6 w-6" />}
                  onClick={() => setAudienceMode("individual")}
                  compact
                />
                <ChoiceCard
                  title="Clientes novos"
                  description="Novos cadastros"
                  active={form.audienceMode === "firstPurchase"}
                  icon={<Sparkles className="h-6 w-6" />}
                  onClick={() => setAudienceMode("firstPurchase")}
                  compact
                />
              </div>

              {form.audienceMode === "group" ? (
                <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
                  <SearchField
                    placeholder="Buscar grupos de clientes..."
                    value={customerGroupSearch}
                    onChange={setCustomerGroupSearch}
                  />
                  <SelectableList
                    items={customerGroups}
                    selectedCodes={form.selectedCustomerGroupCodes}
                    emptyMessage="Nenhum grupo de clientes encontrado."
                    loading={customerGroupsLoading}
                    prioritizeSelected={!customerGroupSearch.trim()}
                    onToggle={(code) => toggleSelection("selectedCustomerGroupCodes", code)}
                  />
                </div>
              ) : null}

              {form.audienceMode === "individual" ? (
                <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
                  <SearchField
                    placeholder="Buscar clientes..."
                    value={customerSearch}
                    onChange={setCustomerSearch}
                  />
                  <SelectableList
                    items={customerSelectableItems}
                    selectedCodes={form.selectedCustomerCodes}
                    helperByCode={customerHelperByCode}
                    emptyMessage="Nenhum cliente encontrado."
                    loading={customersLoading}
                    prioritizeSelected={!customerSearch.trim()}
                    onToggle={(code) => toggleSelection("selectedCustomerCodes", code)}
                  />
                </div>
              ) : null}

              {form.audienceMode === "firstPurchase" ? (
                <div className="grid gap-4 rounded-[24px] border border-violet-100 bg-violet-50/70 px-5 py-5">
                  <button
                    type="button"
                    onClick={toggleNewCustomerFirstPurchaseOnly}
                    className={[
                      "flex items-start justify-between gap-4 rounded-[20px] border px-4 py-3 text-left transition",
                      form.newCustomerFirstPurchaseOnly
                        ? "border-violet-300 bg-violet-100/80 text-violet-950"
                        : "border-violet-200 bg-white/80 text-slate-700 hover:border-violet-300",
                    ].join(" ")}
                  >
                    <div className="grid gap-1">
                      <span className="text-sm font-semibold text-slate-900">Somente primeira compra</span>
                      <span className="text-xs text-slate-500">
                        Quando marcado, o voucher fica disponivel apenas para clientes sem movimentacao.
                      </span>
                    </div>
                    <span
                      className={[
                        "relative mt-0.5 inline-flex h-6 w-11 rounded-full transition",
                        form.newCustomerFirstPurchaseOnly ? "bg-violet-500" : "bg-slate-300",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "absolute top-0.5 h-5 w-5 rounded-full bg-white transition",
                          form.newCustomerFirstPurchaseOnly ? "left-5" : "left-0.5",
                        ].join(" ")}
                      />
                    </span>
                  </button>

                  <label className="grid gap-2 text-sm text-slate-700">
                    <span className="font-medium text-slate-900">Considerar cliente novo por quantos dias após o cadastro?</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={form.newCustomerDays}
                      disabled={form.newCustomerFirstPurchaseOnly}
                      onChange={(event) => updateField("newCustomerDays", event.target.value)}
                      className={[
                        "w-full rounded-[20px] border px-4 py-3 outline-none transition",
                        form.newCustomerFirstPurchaseOnly
                          ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                          : "border-violet-200 bg-white text-slate-900 focus:border-violet-400",
                      ].join(" ")}
                      placeholder="Ex.: 30"
                    />
                    <span className="text-xs text-slate-500">
                      {form.newCustomerFirstPurchaseOnly
                        ? "Campo desabilitado porque o voucher podera ser usado durante toda a validade, desde que seja a primeira compra."
                        : "O cliente sera considerado novo por essa quantidade de dias apos o cadastro."}
                    </span>
                  </label>
                </div>
              ) : null}

              <p className="text-sm text-slate-400">
                {form.audienceMode === "all"
                  ? "Promocao liberada para toda a base."
                  : form.audienceMode === "firstPurchase"
                    ? form.newCustomerFirstPurchaseOnly
                      ? "Promocao liberada apenas para a primeira compra do cliente."
                      : `Promocao liberada para clientes considerados novos por ${form.newCustomerDays || "0"} dia(s) apos o cadastro.`
                  : `${customerCount} cliente(s) selecionado(s).`}
              </p>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="grid gap-6">
              <div>
                <p className="text-3xl font-semibold tracking-tight text-slate-900">Filiais</p>
                <p className="mt-1 text-sm text-slate-500">Escolha as filiais participantes da campanha.</p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={selectAllBranches}
                  disabled={branchesLoading || branchItems.length === 0}
                  className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-medium text-violet-700 transition hover:border-violet-300 hover:bg-violet-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  Selecionar todas filiais
                </button>
                <button
                  type="button"
                  onClick={clearBranches}
                  disabled={form.selectedBranchIds.length === 0}
                  className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  Limpar seleção
                </button>
              </div>

              <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
                <SearchField
                  placeholder="Buscar filiais..."
                  value={branchSearch}
                  onChange={setBranchSearch}
                />
                <SelectableList
                  items={branchItems}
                  selectedCodes={form.selectedBranchIds}
                  helperByCode={branchHelperByCode}
                  emptyMessage="Nenhuma filial encontrada."
                  loading={branchesLoading}
                  onToggle={(code) => toggleSelection("selectedBranchIds", code)}
                />
              </div>

              <p className="text-sm text-slate-400">
                {branchCount === 0
                  ? "Selecione ao menos uma filial para liberar a promocao no PDV."
                  : `${branchCount} filial(is) participante(s).`}
              </p>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="grid gap-6">
              <div>
                <p className="text-3xl font-semibold tracking-tight text-slate-900">Pagamento</p>
                <p className="mt-1 text-sm text-slate-500">Defina em quais formas de pagamento a campanha pode ser aplicada.</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <ChoiceCard
                  title="Todas as formas"
                  description="Liberar a campanha em qualquer pagamento"
                  active={form.paymentMode === "all"}
                  icon={<Wallet className="h-6 w-6" />}
                  onClick={() => updateField("paymentMode", "all")}
                />
                <ChoiceCard
                  title="Formas especificas"
                  description="Escolher formas de pagamento"
                  active={form.paymentMode === "selected"}
                  icon={<BadgePercent className="h-6 w-6" />}
                  onClick={() => updateField("paymentMode", "selected")}
                />
              </div>

              {form.paymentMode === "selected" ? (
                <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
                  <SearchField
                    placeholder="Buscar formas de pagamento..."
                    value={paymentSearch}
                    onChange={setPaymentSearch}
                  />
                  <SelectableList
                    items={paymentSelectableItems}
                    selectedCodes={form.selectedPaymentFormCodes}
                    helperByCode={paymentHelperByCode}
                    emptyMessage="Nenhuma forma de pagamento encontrada."
                    loading={paymentsLoading}
                    onToggle={(code) => toggleSelection("selectedPaymentFormCodes", code)}
                  />
                </div>
              ) : (
                <div className="rounded-[24px] border border-slate-200 bg-white px-5 py-6 text-sm text-slate-500">
                  Todas as formas de pagamento ativas podem usar essa campanha.
                </div>
              )}

              <p className="text-sm text-slate-400">
                {paymentCount} forma(s) de pagamento elegivel(is).
              </p>
            </div>
          ) : null}

          {step === 5 ? (
            <div className="grid gap-6">
              <div>
                <p className="text-3xl font-semibold tracking-tight text-slate-900">Regras</p>
                <p className="mt-1 text-sm text-slate-500">Configure o período, os limites e as condições finais da promoção.</p>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <Field label="Início">
                  <ModernDateInput value={form.startDate} onChange={(value) => updateField("startDate", value)} />
                </Field>

                <Field label="Término">
                  <ModernDateInput value={form.endDate} onChange={(value) => updateField("endDate", value)} />
                </Field>

                <Field label="Hora inicial (opcional)">
                  <ModernDateInput type="time" value={form.startTime} onChange={(value) => updateField("startTime", value)} />
                </Field>

                <Field label="Hora final (opcional)">
                  <ModernDateInput type="time" value={form.endTime} onChange={(value) => updateField("endTime", value)} />
                </Field>
              </div>

              <div className="grid gap-3">
                <div>
                  <p className="text-base font-semibold text-slate-900">Dias da semana</p>
                  <p className="mt-1 text-sm text-slate-400">
                    Selecione os dias em que a campanha roda no PDV.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {weekdayOptions.map((weekday) => {
                    const selected = form.activeWeekdays.includes(weekday.value);
                    return (
                      <button
                        key={weekday.value}
                        type="button"
                        onClick={() => toggleWeekday(weekday.value)}
                        className={[
                          "rounded-full border px-4 py-2 text-sm font-semibold transition",
                          selected
                            ? "border-violet-200 bg-violet-100 text-violet-700"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                        ].join(" ")}
                      >
                        {weekday.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-sm text-slate-400">
                  {form.activeWeekdays.length === 0
                    ? "Selecione ao menos um dia para continuar."
                    : `${form.activeWeekdays.length} dia(s) liberado(s) para uso no PDV.`}
                </p>
              </div>

              <div className="rounded-[24px] border border-fuchsia-100 bg-fuchsia-50/60 px-5 py-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold text-slate-900">Somente no aniversário</p>
                    <p className="text-sm text-slate-500">Valida apenas no dia do aniversário do cliente.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateField("birthdayOnly", !form.birthdayOnly)}
                    className={[
                      "relative inline-flex h-7 w-12 rounded-full transition",
                      form.birthdayOnly ? "bg-violet-600" : "bg-slate-200",
                    ].join(" ")}
                    aria-pressed={form.birthdayOnly}
                  >
                    <span
                      className={[
                        "absolute top-1 h-5 w-5 rounded-full bg-white shadow transition",
                        form.birthdayOnly ? "left-6" : "left-1",
                      ].join(" ")}
                    />
                  </button>
                </div>
              </div>

              <div className="rounded-[24px] border border-amber-100 bg-amber-50/50 p-5">
                <div>
                  <p className="text-base font-semibold text-amber-900">Limites de segurança</p>
                  <p className="mt-1 text-sm text-amber-800/70">Defina os limites máximos para controlar o uso da regra.</p>
                </div>

                <div className="mt-5 grid gap-5 md:grid-cols-2">
                  <Field label="Desconto máx./dia (R$)">
                    <input
                      className="saas-input rounded-[18px] border-amber-100 bg-white"
                      placeholder="Ex: 50"
                      value={form.maxDiscountPerDay}
                      onChange={(event) => updateField("maxDiscountPerDay", event.target.value)}
                    />
                  </Field>

                  <Field label="Volume máx./dia">
                    <input
                      className="saas-input rounded-[18px] border-amber-100 bg-white"
                      placeholder="Ex: 100 L"
                      value={form.maxVolumePerDay}
                      onChange={(event) => updateField("maxVolumePerDay", event.target.value)}
                    />
                  </Field>

                  <Field label="Qtd. máx. por item">
                    <input
                      className="saas-input rounded-[18px] border-amber-100 bg-white"
                      placeholder="Ex: 20"
                      value={form.maxQuantityPerItem}
                      onChange={(event) => updateField("maxQuantityPerItem", event.target.value)}
                    />
                  </Field>

                  <Field label="Resgates por cliente">
                    <input
                      className="saas-input rounded-[18px] border-amber-100 bg-white"
                      placeholder="Ex: 1"
                      value={form.redemptionsPerCustomer}
                      onChange={(event) => updateField("redemptionsPerCustomer", event.target.value)}
                    />
                  </Field>

                  <Field label="Máx. compras / semana">
                    <input
                      className="saas-input rounded-[18px] border-amber-100 bg-white"
                      placeholder="Ex: 3"
                      value={form.maxPurchasesPerWeek}
                      onChange={(event) => updateField("maxPurchasesPerWeek", event.target.value)}
                    />
                  </Field>

                  <Field label="Máx. compras / mês">
                    <input
                      className="saas-input rounded-[18px] border-amber-100 bg-white"
                      placeholder="Ex: 10"
                      value={form.maxPurchasesPerMonth}
                      onChange={(event) => updateField("maxPurchasesPerMonth", event.target.value)}
                    />
                  </Field>

                </div>
              </div>

              <Field label="Status">
                <CompactComboBox
                  value={form.status}
                  options={[...promotionStatusOptions]}
                  onChange={(value) => updateField("status", value as PromotionPayload["status"])}
                />
              </Field>
            </div>
          ) : null}

          {step === 6 ? (
            <div className="grid gap-4">
              <div>
                <p className="text-[2rem] font-semibold tracking-tight text-slate-900">Resumo</p>
                <p className="mt-1 text-sm text-slate-500">Revise todas as condições selecionadas antes de salvar a promoção.</p>
              </div>

              <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 bg-[linear-gradient(135deg,rgba(139,92,246,0.10),rgba(255,255,255,0.95))] px-5 py-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">Regra pronta para publicação</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <p className="text-xl font-semibold tracking-tight text-slate-950">{form.name || "Campanha sem nome"}</p>
                        <span className="rounded-full border border-violet-200 bg-white/85 px-3 py-1 text-xs font-semibold text-violet-700">
                          {statusSummaryLabel}
                        </span>
                      </div>
                      <p className="mt-2 max-w-3xl text-sm text-slate-600">
                        {form.description.trim() || "Resumo centralizado com as regras de aplicação, elegibilidade e limites da promoção."}
                      </p>
                    </div>

                    <div className="grid gap-2 rounded-[22px] border border-white/80 bg-white/85 px-4 py-3 text-sm text-slate-600 shadow-sm sm:grid-cols-2 xl:min-w-[18rem]">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Voucher</p>
                        <p className="mt-1 font-semibold text-slate-900">{form.voucherCode || "Não gerado"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Desconto</p>
                        <p className="mt-1 font-semibold text-slate-900">{discountSummaryLabel}</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-[20px] border border-slate-200/80 bg-white/90 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Produtos</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{productScopeLabel}</p>
                    </div>
                    <div className="rounded-[20px] border border-slate-200/80 bg-white/90 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Público</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{audienceScopeLabel}</p>
                    </div>
                    <div className="rounded-[20px] border border-slate-200/80 bg-white/90 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Filiais</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{branchScopeLabel}</p>
                    </div>
                    <div className="rounded-[20px] border border-slate-200/80 bg-white/90 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Pagamento</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{paymentScopeLabel}</p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-px bg-slate-200 xl:grid-cols-2">
                  <SummarySection
                    title="Início"
                    description="Identificação e mecânica principal da promoção."
                    icon={<BadgePercent className="h-5 w-5" />}
                  >
                    <SummaryRow label="Campanha" value={form.name || "Não informado"} emphasize />
                    <SummaryRow label="Voucher" value={form.voucherCode || "Não gerado"} />
                    <SummaryRow label="Desconto" value={discountSummaryLabel} emphasize />
                    <SummaryRow label="Descrição" value={form.description.trim() || "Sem descrição"} />
                  </SummarySection>

                  <SummarySection
                    title="Abrangência"
                    description="Quem recebe a promoção e onde ela pode ser usada."
                    icon={<UsersRound className="h-5 w-5" />}
                  >
                    <SummaryRow
                      label="Produtos"
                      value={form.productMode === "group" ? `Grupo: ${productsSummaryLabel}` : productsSummaryLabel}
                    />
                    <SummaryRow
                      label="Público"
                      value={form.audienceMode === "group" ? `Grupo: ${audienceSummaryLabel}` : audienceSummaryLabel}
                    />
                    <SummaryRow label="Filiais" value={branchesSummaryLabel} />
                    <SummaryRow label="Pagamento" value={paymentsSummaryLabel} />
                  </SummarySection>

                  <SummarySection
                    title="Vigência"
                    description="Janela de ativação e recorrência da regra."
                    icon={<CalendarRange className="h-5 w-5" />}
                  >
                    <SummaryRow label="Vigência" value={rulesPeriodLabel} emphasize />
                    <SummaryRow label="Horário" value={rulesTimeLabel} />
                    <SummaryRow label="Dias" value={rulesWeekdayLabel} />
                    <SummaryRow label="Aniversário" value={form.birthdayOnly ? "Sim" : "Não"} />
                  </SummarySection>

                  <SummarySection
                    title="Limites"
                    description="Proteções e limites operacionais configurados."
                    icon={<ClipboardList className="h-5 w-5" />}
                  >
                    <SummaryRow label="Desc. máx./dia" value={`R$ ${form.maxDiscountPerDay || "0"}`} />
                    <SummaryRow label="Volume máx./dia" value={form.maxVolumePerDay || "Não definido"} />
                    <SummaryRow label="Qtd. por item" value={form.maxQuantityPerItem || "Não definido"} />
                    <SummaryRow label="Resgates" value={form.redemptionsPerCustomer || "Não definido"} />
                    <SummaryRow label="Compras/sem." value={form.maxPurchasesPerWeek || "Não definido"} />
                    <SummaryRow label="Compras/mês" value={form.maxPurchasesPerMonth || "Não definido"} />
                    <SummaryRow label="Status" value={statusSummaryLabel} />
                  </SummarySection>
                </div>
              </div>
            </div>
          ) : null}

            <div className="mt-auto pt-6">
              {error || submitError ? (
                <div className="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error || submitError}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-slate-200/80 px-6 py-5">
          <div className="flex flex-col-reverse gap-4 md:grid md:grid-cols-[9rem_minmax(0,1fr)_8.5rem_12.5rem] md:items-center md:gap-3">
          <div className="md:justify-self-start">
            {step > 0 ? (
              <button
                type="button"
                onClick={handlePrevious}
                className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-base font-medium text-slate-700 transition hover:bg-white"
              >
                <ChevronLeft className="h-4 w-4" />
                Voltar
              </button>
            ) : <div className="hidden h-10 md:block" />}
          </div>

          <div className="hidden md:block" />
          <div className="flex items-center justify-end md:justify-self-end">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex w-[8.5rem] items-center justify-center rounded-full px-4 py-2.5 text-base font-medium text-slate-700 transition hover:bg-white"
            >
              Cancelar
            </button>
          </div>
          <div className="flex items-center justify-end md:justify-self-end">
            {step < 6 ? (
              <button
                type="button"
                onClick={handleNext}
                className="inline-flex w-[12.5rem] items-center justify-center gap-2 rounded-full bg-violet-600 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-700"
              >
                Avançar
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                className="inline-flex w-[12.5rem] items-center justify-center gap-2 rounded-full bg-violet-600 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-700"
              >
                {isEditing ? "Salvar promoção" : "Publicar promoção"}
                <Check className="h-4 w-4" />
              </button>
            )}
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
