import { useEffect, useState } from "react";
import type { ReferenceDataType, ReferenceOption } from "../../shared/referenceData";
import { fetchReferenceData } from "@/utils/api";

export function useReferenceData(type: ReferenceDataType, search = "", selectedCodes: string[] = []) {
  const [items, setItems] = useState<ReferenceOption[]>([]);
  const [loading, setLoading] = useState(false);
  const selectedCodesKey = selectedCodes.join(",");

  useEffect(() => {
    let active = true;
    let retryTimer: number | undefined;

    async function load() {
      setLoading(true);

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const data = await fetchReferenceData(type, search, selectedCodes);
          if (active) {
            setItems(data);
            setLoading(false);
          }
          return;
        } catch {
          if (attempt < 2) {
            await new Promise<void>((resolve) => {
              retryTimer = window.setTimeout(resolve, 400 * (attempt + 1));
            });
            continue;
          }

          if (active) {
            setItems([]);
          }
        }
      }

      if (active) {
        setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
      if (retryTimer) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [type, search, selectedCodesKey]);

  return { items, loading };
}
