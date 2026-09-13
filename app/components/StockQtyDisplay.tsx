"use client";

type StockQtyDisplayProps = {
  qty: number;
  damagedQty?: number;
  className?: string;
  suffix?: string;
  compact?: boolean;
};

export function DamagedStockIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
      aria-hidden
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

/** Sprzedawalny stan + opcjonalnie uszkodzony (ikona zamiast dlugiego tekstu). */
export function StockQtyDisplay({
  qty,
  damagedQty = 0,
  className = "",
  suffix = " szt.",
  compact = false,
}: StockQtyDisplayProps) {
  const damaged = Math.max(0, damagedQty);
  if (damaged <= 0) {
    return (
      <span className={`tabular-nums ${className}`}>
        {qty}
        {suffix}
      </span>
    );
  }

  return (
    <span className={`inline-flex flex-wrap items-center gap-1 tabular-nums ${className}`}>
      <span>
        {qty}
        {suffix}
      </span>
      <span className="text-inherit opacity-70">+</span>
      <span
        className={`inline-flex items-center gap-0.5 rounded-md bg-amber-100 px-1 text-amber-950 ${compact ? "py-0" : "py-0.5"}`}
        title={`${damaged} uszkodzonych`}
        aria-label={`${damaged} uszkodzonych`}
      >
        <DamagedStockIcon className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
        <span className={`font-semibold ${compact ? "text-[10px]" : "text-xs"}`}>{damaged}</span>
      </span>
    </span>
  );
}
