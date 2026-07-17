import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock3, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type ModernDateInputProps = {
  className?: string;
  variant?: "light" | "dark";
  type?: "date" | "datetime-local" | "time";
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

type PopoverPosition = {
  top: number;
  left: number;
  width: number;
  placement: "top" | "bottom";
  ready: boolean;
};

const weekdayLabels = ["D", "S", "T", "Q", "Q", "S", "S"];
const monthFormatter = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const timeFormatter = new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" });
const hourOptions = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const minuteOptions = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"));

function toCalendarDate(baseDate: Date) {
  return new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
}

function parseValue(value: string, type: "date" | "datetime-local" | "time"): Date | null {
  if (!value) {
    return null;
  }

  if (type === "date") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) {
      return null;
    }

    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  if (type === "time") {
    const match = value.match(/^(\d{2}):(\d{2})$/);
    if (!match) {
      return null;
    }

    const [, hour, minute] = match;
    const baseDate = new Date();
    baseDate.setHours(Number(hour), Number(minute), 0, 0);
    return baseDate;
  }

  const localMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (localMatch) {
    const [, year, month, day, hour, minute] = localMatch;
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateValue(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatDateTimeValue(date: Date) {
  return `${formatDateValue(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatTimeValue(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatOutput(date: Date, type: "date" | "datetime-local" | "time") {
  if (type === "date") {
    return formatDateValue(date);
  }

  if (type === "time") {
    return formatTimeValue(date);
  }

  return formatDateTimeValue(date);
}

function buildCalendarDays(visibleMonth: Date) {
  const firstDayOfMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
  const startOffset = firstDayOfMonth.getDay();
  const startDate = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1 - startOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    return date;
  });
}

export default function ModernDateInput({
  className,
  variant = "light",
  type = "date",
  value,
  onChange,
  disabled = false,
}: ModernDateInputProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const parsedValue = useMemo(() => parseValue(value, type), [type, value]);
  const [popoverPosition, setPopoverPosition] = useState<PopoverPosition>({
    top: 0,
    left: 0,
    width: 0,
    placement: "bottom",
    ready: false,
  });
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => {
    const referenceDate = parseValue(value, type) ?? new Date();
    return new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  });

  const calendarDays = useMemo(() => (type === "time" ? [] : buildCalendarDays(visibleMonth)), [type, visibleMonth]);
  const hasCalendar = type !== "time";
  const hasTime = type !== "date";
  const selectedHour = parsedValue ? String(parsedValue.getHours()).padStart(2, "0") : "00";
  const selectedMinute = parsedValue ? String(parsedValue.getMinutes()).padStart(2, "0") : "00";

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node) || !rootRef.current) {
        return;
      }

      const clickedTrigger = rootRef.current.contains(target);
      const clickedPopover = popoverRef.current?.contains(target) ?? false;

      if (!clickedTrigger && !clickedPopover) {
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

  useEffect(() => {
    if (!open) {
      return;
    }

    const referenceDate = parsedValue ?? new Date();
    setVisibleMonth(new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1));
  }, [open, parsedValue]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !popoverRef.current) {
      return;
    }

    const margin = 12;
    const gap = 10;

    function updatePopoverPosition() {
      if (!triggerRef.current || !popoverRef.current) {
        return;
      }

      const triggerRect = triggerRef.current.getBoundingClientRect();
      const popoverRect = popoverRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const spaceBelow = viewportHeight - triggerRect.bottom - margin;
      const spaceAbove = triggerRect.top - margin;
      const shouldOpenAbove = spaceBelow < popoverRect.height + gap && spaceAbove > spaceBelow;

      const unclampedLeft = triggerRect.left;
      const maxLeft = Math.max(margin, viewportWidth - popoverRect.width - margin);
      const left = Math.min(Math.max(unclampedLeft, margin), maxLeft);
      const top = shouldOpenAbove
        ? Math.max(margin, triggerRect.top - popoverRect.height - gap)
        : Math.min(viewportHeight - popoverRect.height - margin, triggerRect.bottom + gap);

      setPopoverPosition({
        top,
        left,
        width: popoverRect.width,
        placement: shouldOpenAbove ? "top" : "bottom",
        ready: true,
      });
    }

    updatePopoverPosition();
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);

    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [calendarDays, hasTime, open, parsedValue, visibleMonth]);

  function applyDate(nextDate: Date) {
    const result = new Date(nextDate);

    if (type === "datetime-local" && parsedValue) {
      result.setHours(parsedValue.getHours(), parsedValue.getMinutes(), 0, 0);
    } else if (type === "date") {
      result.setHours(0, 0, 0, 0);
    }

    onChange(formatOutput(result, type));
  }

  function handleDaySelect(day: Date) {
    const baseDate = toCalendarDate(day);
    applyDate(baseDate);

    if (!hasTime) {
      setOpen(false);
    }
  }

  function handleTimeChange(part: "hour" | "minute", nextValue: string) {
    const baseDate = parsedValue ? new Date(parsedValue) : new Date();

    if (part === "hour") {
      baseDate.setHours(Number(nextValue));
    } else {
      baseDate.setMinutes(Number(nextValue));
    }

    baseDate.setSeconds(0, 0);
    onChange(formatOutput(baseDate, type));
  }

  function handleToday() {
    const now = new Date();
    const nextDate = hasTime ? now : toCalendarDate(now);

    onChange(formatOutput(nextDate, type));
    setVisibleMonth(new Date(now.getFullYear(), now.getMonth(), 1));

    if (!hasTime) {
      setOpen(false);
    }
  }

  const triggerLabel = parsedValue
    ? type === "datetime-local"
      ? dateTimeFormatter.format(parsedValue)
      : type === "time"
        ? timeFormatter.format(parsedValue)
        : dateFormatter.format(parsedValue)
    : type === "datetime-local"
      ? "Selecione data e hora"
      : type === "time"
        ? "Selecione um horário"
        : "Selecione uma data";

  const today = new Date();
  const popoverWidthClass = hasCalendar ? (hasTime ? "w-[23rem]" : "w-[20rem]") : "w-[20rem]";
  const popoverContent = (
    <div
      ref={popoverRef}
      className={cn(
        "fixed z-[120] overflow-hidden rounded-[28px] border shadow-[0_32px_80px_-32px_rgba(15,23,42,0.45)] backdrop-blur-xl",
        popoverWidthClass,
        !popoverPosition.ready && "opacity-0",
        variant === "dark"
          ? "border-slate-700 bg-slate-950/95 text-white"
          : "border-white/70 bg-white/95 text-slate-900",
      )}
      style={{
        top: `${popoverPosition.top}px`,
        left: `${popoverPosition.left}px`,
      }}
      role="dialog"
      aria-label={type === "datetime-local" ? "Selecionar data e hora" : type === "time" ? "Selecionar horario" : "Selecionar data"}
    >
      {hasCalendar ? (
        <div
          className={cn(
            "border-b px-4 py-4",
            variant === "dark" ? "border-slate-800 bg-slate-900/80" : "border-slate-100 bg-slate-50/85",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-full border transition",
                variant === "dark"
                  ? "border-slate-700 text-slate-300 hover:border-cyan-400 hover:text-cyan-300"
                  : "border-slate-200 text-slate-600 hover:border-violet-300 hover:text-violet-600",
              )}
              aria-label="Mes anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <div className="text-center">
              <p className={cn("text-sm font-semibold capitalize", variant === "dark" ? "text-white" : "text-slate-900")}>
                {monthFormatter.format(visibleMonth)}
              </p>
              <p className={cn("text-xs", variant === "dark" ? "text-slate-500" : "text-slate-400")}>
                {hasTime ? "Selecione a data e ajuste o horario" : "Selecione o dia desejado"}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-full border transition",
                variant === "dark"
                  ? "border-slate-700 text-slate-300 hover:border-cyan-400 hover:text-cyan-300"
                  : "border-slate-200 text-slate-600 hover:border-violet-300 hover:text-violet-600",
              )}
              aria-label="Proximo mes"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "border-b px-4 py-4",
            variant === "dark" ? "border-slate-800 bg-slate-900/80" : "border-slate-100 bg-slate-50/85",
          )}
        >
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border",
                variant === "dark"
                  ? "border-cyan-400/20 bg-cyan-400/10 text-cyan-300"
                  : "border-violet-200 bg-violet-50 text-violet-600",
              )}
            >
              <Clock3 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className={cn("text-sm font-semibold", variant === "dark" ? "text-white" : "text-slate-900")}>Selecione o horário</p>
              <p className={cn("text-xs", variant === "dark" ? "text-slate-500" : "text-slate-400")}>
                Ajuste horas e minutos com o mesmo estilo do campo de data.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="px-4 py-4">
        {hasCalendar ? (
          <>
            <div className="mb-3 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              {weekdayLabels.map((day, index) => (
                <span key={`${day}-${index}`}>{day}</span>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1.5">
              {calendarDays.map((day) => {
                const currentMonth = day.getMonth() === visibleMonth.getMonth();
                const selected = parsedValue
                  ? day.getDate() === parsedValue.getDate() &&
                    day.getMonth() === parsedValue.getMonth() &&
                    day.getFullYear() === parsedValue.getFullYear()
                  : false;
                const isToday =
                  day.getDate() === today.getDate() &&
                  day.getMonth() === today.getMonth() &&
                  day.getFullYear() === today.getFullYear();

                return (
                  <button
                    key={`${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`}
                    type="button"
                    onClick={() => handleDaySelect(day)}
                    className={cn(
                      "inline-flex h-10 items-center justify-center rounded-2xl text-sm font-medium transition",
                      selected
                        ? variant === "dark"
                          ? "bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-500/20"
                          : "bg-violet-600 text-white shadow-lg shadow-violet-500/20"
                        : currentMonth
                          ? variant === "dark"
                            ? "text-slate-100 hover:bg-slate-800"
                            : "text-slate-900 hover:bg-violet-50"
                          : "text-slate-400 hover:bg-slate-100/70",
                      isToday && !selected && (variant === "dark" ? "border border-cyan-400/40" : "border border-violet-200"),
                    )}
                    aria-pressed={selected}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>
          </>
        ) : null}

        {hasTime ? (
          <div
            className={cn(
              hasCalendar ? "mt-4 rounded-2xl border p-3" : "rounded-2xl border p-3",
              variant === "dark" ? "border-slate-800 bg-slate-900/80" : "border-slate-100 bg-slate-50/80",
            )}
          >
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
              <Clock3 className="h-3.5 w-3.5" />
              Horario
            </div>

            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <select
                value={selectedHour}
                onChange={(event) => handleTimeChange("hour", event.target.value)}
                className={cn(
                  "rounded-xl border px-3 py-2 text-sm font-medium outline-none transition",
                  variant === "dark"
                    ? "border-slate-700 bg-slate-950 text-white focus:border-cyan-400"
                    : "border-slate-200 bg-white text-slate-900 focus:border-violet-400",
                )}
              >
                {hourOptions.map((hour) => (
                  <option key={hour} value={hour}>
                    {hour}
                  </option>
                ))}
              </select>

              <span className={cn("text-sm font-semibold", variant === "dark" ? "text-slate-500" : "text-slate-400")}>:</span>

              <select
                value={selectedMinute}
                onChange={(event) => handleTimeChange("minute", event.target.value)}
                className={cn(
                  "rounded-xl border px-3 py-2 text-sm font-medium outline-none transition",
                  variant === "dark"
                    ? "border-slate-700 bg-slate-950 text-white focus:border-cyan-400"
                    : "border-slate-200 bg-white text-slate-900 focus:border-violet-400",
                )}
              >
                {minuteOptions.map((minute) => (
                  <option key={minute} value={minute}>
                    {minute}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}
      </div>

      <div
        className={cn(
          "flex items-center justify-between gap-2 border-t px-4 py-3",
          variant === "dark" ? "border-slate-800 bg-slate-900/70" : "border-slate-100 bg-slate-50/70",
        )}
      >
        <button
          type="button"
          onClick={() => {
            onChange("");
            setOpen(false);
          }}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition",
            variant === "dark" ? "text-slate-400 hover:bg-slate-800 hover:text-white" : "text-slate-500 hover:bg-slate-200/70 hover:text-slate-900",
          )}
        >
          <X className="h-3.5 w-3.5" />
          Limpar
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToday}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-semibold transition",
              variant === "dark" ? "text-cyan-300 hover:bg-slate-800" : "text-violet-600 hover:bg-violet-50",
            )}
          >
            {hasTime ? "Agora" : "Hoje"}
          </button>

          <button
            type="button"
            onClick={() => setOpen(false)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-semibold transition",
              variant === "dark" ? "bg-cyan-400 text-slate-950 hover:bg-cyan-300" : "bg-violet-600 text-white hover:bg-violet-700",
            )}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className={cn("relative", className)} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left shadow-sm transition",
          variant === "dark"
            ? "border-slate-700 bg-slate-900 text-white hover:border-cyan-400/70"
            : "border-slate-200 bg-white text-slate-900 hover:border-violet-300 hover:bg-slate-50/80",
          open &&
            (variant === "dark"
              ? "border-cyan-400 shadow-[0_0_0_4px_rgba(34,211,238,0.14)]"
              : "border-violet-500 shadow-[0_0_0_4px_rgba(139,92,246,0.14)]"),
          disabled && "cursor-not-allowed opacity-70",
        )}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
              variant === "dark"
                ? "border-cyan-400/20 bg-cyan-400/10 text-cyan-300"
                : "border-violet-200 bg-violet-50 text-violet-600",
            )}
          >
            {hasTime ? <Clock3 className="h-4 w-4" /> : <CalendarDays className="h-4 w-4" />}
          </span>
          <span className="grid min-w-0 gap-0.5">
            <span
              className={cn(
                "text-[11px] font-semibold uppercase tracking-[0.18em]",
                variant === "dark" ? "text-slate-500" : "text-slate-400",
              )}
            >
              {type === "datetime-local" ? "Data e hora" : type === "time" ? "Hora" : "Data"}
            </span>
            <span
              className={cn(
                "truncate text-sm font-medium",
                parsedValue ? (variant === "dark" ? "text-white" : "text-slate-900") : "text-slate-400",
              )}
            >
              {triggerLabel}
            </span>
          </span>
        </span>

        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 transition-transform",
            variant === "dark" ? "text-slate-400" : "text-slate-500",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? createPortal(popoverContent, document.body) : null}
    </div>
  );
}
