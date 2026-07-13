import { useMemo, useState, type ReactNode } from "react";
import { CirclePercent, CreditCard, Package, Tag, Users, X } from "lucide-react";
import type { CreateDiscountCodeInput } from "../../shared/discount";
import type { ReferenceOption } from "../../shared/referenceData";
import { useReferenceData } from "@/hooks/useReferenceData";

type DiscountFormProps = {
  submitting: boolean;
  onSubmit: (input: CreateDiscountCodeInput) => Promise<void>;
};

type SelectedLookup = {
  code: string;
  name: string;
  value: string;
};

type FormState = {
  productSearch: string;
  products: SelectedLookup[];
  productGroupSearch: string;
  productGroups: SelectedLookup[];
  customerSearch: string;
  customers: SelectedLookup[];
  customerGroupSearch: string;
  customerGroups: SelectedLookup[];
  paymentFormSearch: string;
  paymentForms: SelectedLookup[];
  discountPercent: string;
  validFrom: string;
  validUntil: string;
};

const initialState: FormState = {
  productSearch: "",
  products: [],
  productGroupSearch: "",
  productGroups: [],
  customerSearch: "",
  customers: [],
  customerGroupSearch: "",
  customerGroups: [],
  paymentFormSearch: "",
  paymentForms: [],
  discountPercent: "",
  validFrom: "",
  validUntil: "",
};

function buildPayload(form: FormState): CreateDiscountCodeInput {
  return {
    productCodes: form.products.map((item) => item.value),
    productGroupCodes: form.productGroups.map((item) => item.value),
    customerCodes: form.customers.map((item) => item.value),
    customerGroupCodes: form.customerGroups.map((item) => item.value),
    paymentFormCodes: form.paymentForms.map((item) => item.value),
    discountPercent: Number(form.discountPercent),
    validFrom: form.validFrom ? new Date(form.validFrom).toISOString() : null,
    validUntil: form.validUntil ? new Date(form.validUntil).toISOString() : null,
  };
}

function toSelectedLookup(option: ReferenceOption): SelectedLookup {
  return {
    code: option.code,
    name: option.name,
    value: option.value ?? option.code,
  };
}

type SearchPickFieldProps = {
  label: string;
  icon: ReactNode;
  search: string;
  onSearchChange: (value: string) => void;
  selectedItems: SelectedLookup[];
  options: ReferenceOption[];
  loading: boolean;
  onAdd: (option: ReferenceOption) => void;
  onRemove: (value: string) => void;
  onClear: () => void;
  emptyText: string;
  noMoreMatchesText: string;
  noMatchesText: string;
  summaryText: string;
  basePlaceholder: string;
  filledPlaceholder: string;
};

function SearchPickField({
  label,
  icon,
  search,
  onSearchChange,
  selectedItems,
  options,
  loading,
  onAdd,
  onRemove,
  onClear,
  emptyText,
  noMoreMatchesText,
  noMatchesText,
  summaryText,
  basePlaceholder,
  filledPlaceholder,
}: SearchPickFieldProps) {
  const selectedValueSet = useMemo(
    () => new Set(selectedItems.map((item) => item.value)),
    [selectedItems],
  );

  const filteredOptions = useMemo(
    () => options.filter((option) => !selectedValueSet.has(option.value ?? option.code)),
    [options, selectedValueSet],
  );

  return (
    <label className="grid min-w-0 gap-2 text-sm text-slate-300">
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>

      <div className="rounded-2xl border border-slate-700 bg-slate-900 px-3 py-3 transition focus-within:border-cyan-400">
        <div className="flex flex-wrap gap-2">
          {selectedItems.map((item) => (
            <span
              key={item.value}
              className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-100"
            >
              {item.code} - {item.name}
              <button
                type="button"
                onClick={() => onRemove(item.value)}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-cyan-100/80 transition hover:bg-cyan-400/20 hover:text-white"
                aria-label={`Remover ${label} ${item.code}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}

          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={selectedItems.length > 0 ? filledPlaceholder : basePlaceholder}
            className="min-w-[220px] flex-1 bg-transparent px-2 py-1 text-white outline-none placeholder:text-slate-500"
          />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-2">
        <div className="mb-2 flex items-center justify-between gap-2 px-2">
          <span className="text-xs text-slate-400">
            {loading
              ? `Buscando ${label.toLowerCase()}...`
              : filteredOptions.length > 0
                ? "Clique para adicionar"
                : selectedItems.length > 0
                  ? noMoreMatchesText
                  : noMatchesText}
          </span>

          {selectedItems.length > 0 ? (
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-slate-400 transition hover:text-white"
            >
              Limpar selecionado
            </button>
          ) : null}
        </div>

        <div className="max-h-40 overflow-y-auto">
          {filteredOptions.slice(0, 12).map((option) => (
            <button
              key={option.value ?? option.code}
              type="button"
              onClick={() => onAdd(option)}
              className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-slate-800"
            >
              <span>
                {option.code} - {option.name}
              </span>
              <span className="text-xs text-cyan-300">Adicionar</span>
            </button>
          ))}
        </div>
      </div>

      <span className="text-xs text-slate-500">{selectedItems.length > 0 ? summaryText : emptyText}</span>
    </label>
  );
}

export default function DiscountForm({ submitting, onSubmit }: DiscountFormProps) {
  const [form, setForm] = useState<FormState>(initialState);
  const { items: productOptions, loading: loadingProducts } = useReferenceData("products", form.productSearch);
  const { items: productGroupOptions, loading: loadingProductGroups } = useReferenceData(
    "product-groups",
    form.productGroupSearch,
  );
  const { items: customerOptions, loading: loadingCustomers } = useReferenceData("customers", form.customerSearch);
  const { items: customerGroupOptions, loading: loadingCustomerGroups } = useReferenceData(
    "customer-groups",
    form.customerGroupSearch,
  );
  const { items: paymentFormOptions, loading: loadingPaymentForms } = useReferenceData(
    "payment-forms",
    form.paymentFormSearch,
  );

  const scopeHint = useMemo(() => {
    if (form.products.length > 0) {
      return "O desconto sera aplicado somente aos produtos informados.";
    }

    if (form.productGroups.length > 0) {
      return "O desconto sera aplicado aos grupos de produto informados.";
    }

    return "Sem produto ou grupo informado, o desconto valerá para todos os produtos.";
  }, [form.products, form.productGroups]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit(buildPayload(form));
  }

  function updateField<Key extends keyof FormState>(field: Key, value: FormState[Key]) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function addUniqueItem(items: SelectedLookup[], option: ReferenceOption): SelectedLookup[] {
    const selected = toSelectedLookup(option);
    if (items.some((item) => item.value === selected.value)) {
      return items;
    }

    return [...items, selected];
  }

  function addProduct(option: ReferenceOption) {
    setForm((current) => ({
      ...current,
      productSearch: "",
      products: addUniqueItem(current.products, option),
      productGroupSearch: "",
      productGroups: [],
    }));
  }

  function removeProduct(value: string) {
    setForm((current) => ({
      ...current,
      products: current.products.filter((item) => item.value !== value),
    }));
  }

  function clearProduct() {
    setForm((current) => ({
      ...current,
      productSearch: "",
      products: [],
    }));
  }

  function addProductGroup(option: ReferenceOption) {
    setForm((current) => ({
      ...current,
      productGroupSearch: "",
      productGroups: addUniqueItem(current.productGroups, option),
      productSearch: "",
      products: [],
    }));
  }

  function removeProductGroup(value: string) {
    setForm((current) => ({
      ...current,
      productGroups: current.productGroups.filter((item) => item.value !== value),
    }));
  }

  function clearProductGroup() {
    setForm((current) => ({
      ...current,
      productGroupSearch: "",
      productGroups: [],
    }));
  }

  function addCustomer(option: ReferenceOption) {
    setForm((current) => ({
      ...current,
      customerSearch: "",
      customers: addUniqueItem(current.customers, option),
      customerGroupSearch: "",
      customerGroups: [],
    }));
  }

  function removeCustomer(value: string) {
    setForm((current) => ({
      ...current,
      customers: current.customers.filter((item) => item.value !== value),
    }));
  }

  function clearCustomer() {
    setForm((current) => ({
      ...current,
      customerSearch: "",
      customers: [],
    }));
  }

  function addCustomerGroup(option: ReferenceOption) {
    setForm((current) => ({
      ...current,
      customerGroupSearch: "",
      customerGroups: addUniqueItem(current.customerGroups, option),
      customerSearch: "",
      customers: [],
    }));
  }

  function removeCustomerGroup(value: string) {
    setForm((current) => ({
      ...current,
      customerGroups: current.customerGroups.filter((item) => item.value !== value),
    }));
  }

  function clearCustomerGroup() {
    setForm((current) => ({
      ...current,
      customerGroupSearch: "",
      customerGroups: [],
    }));
  }

  function addPaymentForm(option: { code: string; name: string; value?: string }) {
    const resolvedValue = option.value ?? option.code;

    setForm((current) => {
      if (current.paymentForms.some((item) => item.value === resolvedValue)) {
        return { ...current, paymentFormSearch: "" };
      }

      return {
        ...current,
        paymentFormSearch: "",
        paymentForms: [
          ...current.paymentForms,
            toSelectedLookup(option),
        ],
      };
    });
  }

  function removePaymentForm(value: string) {
    setForm((current) => ({
      ...current,
      paymentForms: current.paymentForms.filter((item) => item.value !== value),
    }));
  }

  function clearPaymentForms() {
    setForm((current) => ({
      ...current,
      paymentFormSearch: "",
      paymentForms: [],
    }));
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-5 rounded-3xl border border-slate-800 bg-slate-950/85 p-6 shadow-2xl shadow-slate-950/40"
    >
      <div className="grid gap-2">
        <p className="text-sm uppercase tracking-[0.28em] text-cyan-300">Gerador provisório</p>
        <h2 className="text-2xl font-semibold text-white">Parâmetros do desconto</h2>
        <p className="text-sm text-slate-400">
          O campo obrigatório é apenas o percentual. Produto, grupo, cliente, forma de pagamento e validade são
          opcionais.
        </p>
      </div>

      <div className="grid gap-5">
        <div className="grid gap-4 md:grid-cols-2 md:items-stretch">
          <SearchPickField
            label="Código do produto"
            icon={<Package className="h-4 w-4 text-cyan-300" />}
            search={form.productSearch}
            onSearchChange={(value) => updateField("productSearch", value)}
            selectedItems={form.products}
            options={productOptions}
            loading={loadingProducts}
            onAdd={addProduct}
            onRemove={removeProduct}
            onClear={clearProduct}
            emptyText="Pesquise e clique nos produtos desejados para adicionar."
            noMoreMatchesText="Nenhum outro produto encontrado para este filtro."
            noMatchesText="Nenhum produto encontrado para este filtro."
            summaryText={`${form.products.length} produto(s) selecionado(s).`}
            basePlaceholder="Digite codigo ou nome do produto"
            filledPlaceholder="Pesquisar e adicionar outro produto"
          />

          <SearchPickField
            label="Grupo de produto"
            icon={<Tag className="h-4 w-4 text-cyan-300" />}
            search={form.productGroupSearch}
            onSearchChange={(value) => updateField("productGroupSearch", value)}
            selectedItems={form.productGroups}
            options={productGroupOptions}
            loading={loadingProductGroups}
            onAdd={addProductGroup}
            onRemove={removeProductGroup}
            onClear={clearProductGroup}
            emptyText="Pesquise e clique nos grupos de produto desejados para adicionar."
            noMoreMatchesText="Nenhum outro grupo de produto encontrado para este filtro."
            noMatchesText="Nenhum grupo de produto encontrado para este filtro."
            summaryText={`${form.productGroups.length} grupo(s) de produto selecionado(s).`}
            basePlaceholder="Digite codigo ou nome do grupo de produto"
            filledPlaceholder="Pesquisar e adicionar outro grupo de produto"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <SearchPickField
            label="Cliente específico"
            icon={<Users className="h-4 w-4 text-cyan-300" />}
            search={form.customerSearch}
            onSearchChange={(value) => updateField("customerSearch", value)}
            selectedItems={form.customers}
            options={customerOptions}
            loading={loadingCustomers}
            onAdd={addCustomer}
            onRemove={removeCustomer}
            onClear={clearCustomer}
            emptyText="Pesquise e clique nos clientes desejados para adicionar."
            noMoreMatchesText="Nenhum outro cliente encontrado para este filtro."
            noMatchesText="Nenhum cliente encontrado para este filtro."
            summaryText={`${form.customers.length} cliente(s) selecionado(s).`}
            basePlaceholder="Digite codigo ou nome do cliente"
            filledPlaceholder="Pesquisar e adicionar outro cliente"
          />

          <SearchPickField
            label="Grupo de cliente"
            icon={<Users className="h-4 w-4 text-cyan-300" />}
            search={form.customerGroupSearch}
            onSearchChange={(value) => updateField("customerGroupSearch", value)}
            selectedItems={form.customerGroups}
            options={customerGroupOptions}
            loading={loadingCustomerGroups}
            onAdd={addCustomerGroup}
            onRemove={removeCustomerGroup}
            onClear={clearCustomerGroup}
            emptyText="Pesquise e clique nos grupos de cliente desejados para adicionar."
            noMoreMatchesText="Nenhum outro grupo de cliente encontrado para este filtro."
            noMatchesText="Nenhum grupo de cliente encontrado para este filtro."
            summaryText={`${form.customerGroups.length} grupo(s) de cliente selecionado(s).`}
            basePlaceholder="Digite codigo ou nome do grupo de cliente"
            filledPlaceholder="Pesquisar e adicionar outro grupo de cliente"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <SearchPickField
            label="Formas de pagamento"
            icon={<CreditCard className="h-4 w-4 text-cyan-300" />}
            search={form.paymentFormSearch}
            onSearchChange={(value) => updateField("paymentFormSearch", value)}
            selectedItems={form.paymentForms}
            options={paymentFormOptions}
            loading={loadingPaymentForms}
            onAdd={addPaymentForm}
            onRemove={removePaymentForm}
            onClear={clearPaymentForms}
            emptyText="Pesquise e clique nas formas desejadas para adicionar."
            noMoreMatchesText="Nenhuma outra forma encontrada para este filtro."
            noMatchesText="Nenhuma forma encontrada para este filtro."
            summaryText={`${form.paymentForms.length} forma(s) de pagamento selecionada(s) e visiveis acima.`}
            basePlaceholder="Digite codigo ou nome e clique para adicionar"
            filledPlaceholder="Pesquisar e adicionar outra forma"
          />

          <label className="grid min-w-0 grid-rows-[auto_1fr_auto] gap-2 self-stretch text-sm text-slate-300">
            <span className="flex items-center gap-2">
              <CirclePercent className="h-4 w-4 text-emerald-300" />
              Percentual de desconto *
            </span>
            <input
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              required
              value={form.discountPercent}
              onChange={(event) => updateField("discountPercent", event.target.value)}
              placeholder="Ex.: 10"
              className="h-full min-h-[144px] w-full min-w-0 rounded-2xl border border-emerald-700/60 bg-slate-900 px-4 py-3 text-white outline-none transition focus:border-emerald-400"
            />
            <span className="text-xs text-slate-500">Informe o percentual que sera aplicado ao voucher.</span>
          </label>

        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid min-w-0 gap-2 text-sm text-slate-300">
            <span>Início da validade</span>
            <input
              type="datetime-local"
              value={form.validFrom}
              onChange={(event) => updateField("validFrom", event.target.value)}
              className="w-full min-w-0 rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-white outline-none transition focus:border-cyan-400"
            />
          </label>

          <label className="grid min-w-0 gap-2 text-sm text-slate-300">
            <span>Fim da validade</span>
            <input
              type="datetime-local"
              value={form.validUntil}
              onChange={(event) => updateField("validUntil", event.target.value)}
              className="w-full min-w-0 rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-white outline-none transition focus:border-cyan-400"
            />
          </label>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm text-slate-400">
        Os produtos sao escolhidos pelo codigo/nome, mas o voucher salva os `grid` da tabela
        `produto` para comparar com o item do caixa.
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm text-slate-400">
          Os clientes especificos sao escolhidos pelo codigo/nome, mas o voucher salva os `grid` da tabela
          `pessoa` para comparar com `caixa_venda.pessoa`.
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm text-slate-400">
          As formas de pagamento sao escolhidas pelo codigo/nome, mas o voucher salva os `grid`
          da tabela `forma_pgto` para validar a venda no caixa.
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm text-slate-300">
        {scopeHint}
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex items-center justify-center rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
      >
        {submitting ? "Gerando código..." : "Gerar código de desconto"}
      </button>
    </form>
  );
}
