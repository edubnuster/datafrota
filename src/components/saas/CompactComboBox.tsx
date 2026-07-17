import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type ComboOption = {
  value: string;
  label: string;
  description?: string;
};

type CompactComboBoxProps = {
  value: string;
  options: ComboOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
};

export default function CompactComboBox({
  value,
  options,
  onChange,
  placeholder = "Selecione",
  className,
}: CompactComboBoxProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node) || !rootRef.current) {
        return;
      }

      if (!rootRef.current.contains(target)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div className={cn("relative", className)} ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "saas-input flex items-center justify-between gap-3 text-left",
          open && "border-violet-500 bg-white shadow-[0_0_0_4px_rgba(139,92,246,0.14)]",
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="min-w-0 truncate text-sm text-slate-900">
          {selectedOption?.label ?? placeholder}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-slate-500 transition-transform",
            open && "rotate-180 text-violet-600",
          )}
        />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.45rem)] z-50 overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_24px_60px_-24px_rgba(15,23,42,0.35)]">
          <div className="max-h-64 overflow-y-auto py-1">
            {options.map((option) => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 border-b border-slate-100 px-4 py-2.5 text-left transition last:border-b-0",
                    selected ? "bg-violet-50/70" : "bg-white hover:bg-slate-50",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                      selected
                        ? "border-violet-600 bg-violet-600 text-white"
                        : "border-slate-300 bg-white text-white",
                    )}
                  >
                    <Check className="h-3 w-3" />
                  </span>
                  <span className="grid min-w-0 gap-px">
                    <span className="truncate text-sm font-semibold leading-5 text-slate-900">
                      {option.label}
                    </span>
                    {option.description ? (
                      <span className="text-xs leading-4 text-slate-400">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
