"use client";

import { useMemo } from "react";
import type { ReplenishmentRouteSuggestion } from "@/lib/replenishmentRoutes";

type ReplenishmentRoutePlanCardProps = {
  route: ReplenishmentRouteSuggestion;
  onDismiss?: () => void;
};

export function ReplenishmentRoutePlanCard({ route, onDismiss }: ReplenishmentRoutePlanCardProps) {
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { model: string; totalQty: number; lines: Array<{ size: string; sku: string; qty: number }> }
    >();
    const order: string[] = [];
    for (const transfer of route.transfers) {
      const model = transfer.model.trim().toUpperCase();
      let group = map.get(model);
      if (!group) {
        group = { model, totalQty: 0, lines: [] };
        map.set(model, group);
        order.push(model);
      }
      group.totalQty += transfer.qty;
      const existing = group.lines.find((line) => line.sku === transfer.sku);
      if (existing) {
        existing.qty += transfer.qty;
      } else {
        group.lines.push({
          size: transfer.size || transfer.sku,
          sku: transfer.sku,
          qty: transfer.qty,
        });
      }
    }
    for (const group of map.values()) {
      group.lines.sort((a, b) => a.size.localeCompare(b.size, undefined, { numeric: true }));
    }
    return order.map((model) => map.get(model)!);
  }, [route.transfers]);

  return (
    <div className="rounded-2xl border-2 border-teal-300 bg-teal-50/80 p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">Plan uzupelnienia ekspozycji</p>
          <p className="mt-1 font-mono text-sm font-bold text-teal-950">
            <span className="text-teal-800">Z</span> {route.fromLocationCode}
            {route.fromLocationName ? (
              <span className="font-sans font-normal text-teal-900"> ({route.fromLocationName})</span>
            ) : null}
            <span className="mx-1.5 font-sans text-teal-700">→</span>
            <span className="text-teal-800">DO</span> {route.toLocationCode}
            {route.toLocationName ? (
              <span className="font-sans font-normal text-teal-900"> ({route.toLocationName})</span>
            ) : null}
          </p>
          <p className="mt-1 text-xs text-teal-900">
            Razem <strong>{route.totalQty}</strong> szt. w <strong>{route.lineCount}</strong> pozycjach — przenies
            ponizej lub skanuj produkty.
          </p>
        </div>
        {onDismiss ? (
          <button
            type="button"
            className="shrink-0 rounded-lg border border-teal-300 bg-white px-2 py-1 text-[11px] font-semibold text-teal-900"
            onClick={onDismiss}
          >
            Ukryj plan
          </button>
        ) : null}
      </div>
      <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto">
        {groups.map((group) => (
          <li key={group.model} className="overflow-hidden rounded-xl border border-teal-200/90 bg-white">
            <p className="border-b border-teal-100 bg-teal-100/60 px-2.5 py-1.5 font-mono text-xs font-bold text-teal-950">
              {group.model}
              <span className="ml-2 font-sans font-semibold text-teal-800">({group.totalQty} szt.)</span>
            </p>
            <ul className="divide-y divide-teal-50 px-2.5 py-1 text-xs text-teal-950">
              {group.lines.map((line) => (
                <li key={line.sku} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                  <span>
                    rozmiar <span className="font-mono font-semibold">{line.size}</span>
                    <span className="ml-1 font-mono text-[10px] text-teal-700">{line.sku}</span>
                  </span>
                  <span className="font-bold tabular-nums">{line.qty} szt.</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
