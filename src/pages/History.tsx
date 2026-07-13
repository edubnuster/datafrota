import { useEffect } from "react";
import DiscountHistoryTable from "@/components/DiscountHistoryTable";
import { useDiscountStore } from "@/hooks/useDiscountStore";

export default function History() {
  const { items, loading, loadCodes, cancelCode } = useDiscountStore();

  useEffect(() => {
    void loadCodes();
  }, [loadCodes]);

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-6xl">
        <DiscountHistoryTable items={items} loading={loading} onCancel={cancelCode} />
      </div>
    </main>
  );
}
