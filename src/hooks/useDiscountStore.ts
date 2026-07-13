import { create } from "zustand";
import type {
  CreateDiscountCodeInput,
  DiscountAuthorization,
  ResolveDiscountCodeResponse,
} from "../../shared/discount";
import {
  cancelDiscountCode as cancelDiscountCodeRequest,
  createDiscountCode as createDiscountCodeRequest,
  fetchDiscountCodes,
  resolveDiscountCode as resolveDiscountCodeRequest,
} from "@/utils/api";

type DiscountStore = {
  items: DiscountAuthorization[];
  loading: boolean;
  submitting: boolean;
  message: string | null;
  error: string | null;
  lastCreated: DiscountAuthorization | null;
  lastResolved: ResolveDiscountCodeResponse | null;
  loadCodes: () => Promise<void>;
  createCode: (input: CreateDiscountCodeInput) => Promise<void>;
  cancelCode: (shortCode: string) => Promise<void>;
  resolveCode: (shortCode: string) => Promise<void>;
  clearFeedback: () => void;
};

export const useDiscountStore = create<DiscountStore>((set, get) => ({
  items: [],
  loading: false,
  submitting: false,
  message: null,
  error: null,
  lastCreated: null,
  lastResolved: null,

  async loadCodes() {
    set({ loading: true, error: null });

    try {
      const items = await fetchDiscountCodes();
      set({ items, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Nao foi possivel carregar o historico.",
      });
    }
  },

  async createCode(input) {
    set({ submitting: true, error: null, message: null });

    try {
      const created = await createDiscountCodeRequest(input);
      set((state) => ({
        submitting: false,
        lastCreated: created,
        message: `Codigo ${created.shortCode} gerado com sucesso.`,
        items: [created, ...state.items.filter((item) => item.shortCode !== created.shortCode)],
      }));
    } catch (error) {
      set({
        submitting: false,
        error: error instanceof Error ? error.message : "Nao foi possivel gerar o codigo.",
      });
    }
  },

  async cancelCode(shortCode) {
    set({ error: null, message: null });

    try {
      const updated = await cancelDiscountCodeRequest(shortCode);
      set((state) => ({
        items: state.items.map((item) => (item.shortCode === shortCode ? updated : item)),
        message: `Codigo ${shortCode} cancelado com sucesso.`,
        lastCreated:
          state.lastCreated?.shortCode === shortCode ? updated : state.lastCreated,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Nao foi possivel cancelar o codigo.",
      });
    }
  },

  async resolveCode(shortCode) {
    set({ submitting: true, error: null, message: null, lastResolved: null });

    try {
      const resolved = await resolveDiscountCodeRequest(shortCode);
      set({
        submitting: false,
        lastResolved: resolved,
        message: resolved.found ? `Codigo ${shortCode.toUpperCase()} localizado.` : null,
        error: resolved.found ? null : null,
      });
    } catch (error) {
      set({
        submitting: false,
        error: error instanceof Error ? error.message : "Nao foi possivel consultar o codigo.",
      });
    }
  },

  clearFeedback() {
    const currentItems = get().items;
    set({
      items: currentItems,
      message: null,
      error: null,
    });
  },
}));
