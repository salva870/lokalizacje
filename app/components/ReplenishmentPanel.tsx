"use client";

import { useMemo, useState } from "react";
import { DEFAULT_MODEL_SHOP_DISPLAY_TARGET, type ReplenishmentTransfer } from "@/lib/replenishment";
import { groupQueueByModel } from "@/lib/skuModel";

export type ReplenishmentLineStatus = "pending" | "picked" | "done";

export type ReplenishmentLineState = ReplenishmentTransfer & {
  status: ReplenishmentLineStatus;
};

type ReplenishmentPanelProps = {
  lines: ReplenishmentLineState[];
  modelTargets: Array<{ model: string; targetQty: number }>;
  loading?: boolean;
  busyId?: string | null;
  onRefresh: () => void;
  onMarkPicked: (id: string) => void;
  onConfirmMove: (line: ReplenishmentTransfer) => void;
  onSaveModelTarget: (model: string, targetQty: number) => Promise<void>;
  onOpenLocationPreview?: (locationCode: string, models: string[]) => void;
};

function statusLabel(status: ReplenishmentLineStatus): string {
  if (status === "pending") return "Do pobrania";
  if (status === "picked") return "W drodze — powies";
  return "Zrobione";
}

export function ReplenishmentPanel({
  lines,
  modelTargets,
  loading = false,
  busyId = null,
  onRefresh,
  onMarkPicked,
  onConfirmMove,
  onSaveModelTarget,
  onOpenLocationPreview,
}: ReplenishmentPanelProps) {
  const pendingCount = lines.filter((line) => line.status !== "done").length;
  const doneCount = lines.filter((line) => line.status === "done").length;
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [editQty, setEditQty] = useState(String(DEFAULT_MODEL_SHOP_DISPLAY_TARGET));
  const [targetBusy, setTargetBusy] = useState(false);

  const activeLines = useMemo(() => lines.filter((line) => line.status !== "done"), [lines]);
  const groups = useMemo(
    () => groupQueueByModel(activeLines.map((line) => ({ sku: line.sku, qty: line.qty }))),
    [activeLines],
  );
  async function submitModelTarget(model: string) {
    const parsed = Math.floor(Number(editQty));
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 99) return;
    setTargetBusy(true);
    try {
      await onSaveModelTarget(model, parsed);
      setEditingModel(null);
    } finally {
      setTargetBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-violet-900">
          {loading
            ? "Ladowanie planu…"
            : lines.length === 0
              ? "Brak pozycji do uzupelnienia (sklep na stanie docelowym lub brak towaru na zapleczu)."
              : `${pendingCount} do zrobienia · ${doneCount} zakonczonych`}
        </p>
        <button
          type="button"
          className="shrink-0 rounded-xl border border-violet-300 bg-white px-3 py-2 text-xs font-semibold text-violet-900 hover:bg-violet-50"
          onClick={onRefresh}
          disabled={loading}
        >
          Odswiez plan
        </button>
      </div>

      {modelTargets.length > 0 ? (
        <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-2 text-xs text-violet-950">
          <p className="font-semibold uppercase tracking-wide text-violet-800">Docelowa ekspozycja (na rozmiar)</p>
          <ul className="mt-2 space-y-1">
            {modelTargets.map((entry) => (
              <li key={entry.model} className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono font-semibold">{entry.model}</span>
                {editingModel === entry.model ? (
                  <span className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={99}
                      className="w-14 rounded border border-violet-300 px-1 py-0.5 text-center font-mono"
                      value={editQty}
                      onChange={(event) => setEditQty(event.target.value)}
                    />
                    <button
                      type="button"
                      className="rounded border border-violet-400 px-2 py-0.5 font-semibold"
                      disabled={targetBusy}
                      onClick={() => void submitModelTarget(entry.model)}
                    >
                      OK
                    </button>
                    <button
                      type="button"
                      className="rounded border border-violet-200 px-2 py-0.5"
                      onClick={() => setEditingModel(null)}
                    >
                      Anuluj
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="font-semibold text-violet-800 underline underline-offset-2"
                    onClick={() => {
                      setEditingModel(entry.model);
                      setEditQty(String(entry.targetQty));
                    }}
                  >
                    {entry.targetQty} szt. / rozmiar
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {activeLines.length === 0 && !loading ? (
        <p className="text-sm text-violet-800">Wszystkie zaplanowane przeniesienia zostaly zakonczone lub plan jest pusty.</p>
      ) : null}

      {groups.length > 0 ? (
        <ul className="max-h-[28rem] space-y-2 overflow-y-auto rounded-xl border border-violet-100 p-2 text-sm">
          {groups.map((group) => (
            <li key={group.model} className="overflow-hidden rounded-xl border border-violet-200/80 bg-violet-50/40">
              <p className="border-b border-violet-200/80 bg-violet-100/70 px-3 py-2 font-mono text-sm font-bold text-violet-950">
                {group.model}
              </p>
              <ul className="space-y-2 p-2">
                {group.lines.flatMap((sizeLine) => {
                  const matching = activeLines.filter((line) => line.sku === sizeLine.sku);
                  return matching.map((line) => (
                    <li
                      key={line.id}
                      className="rounded-lg border border-violet-100 bg-white px-2.5 py-2.5 shadow-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-mono text-xs font-semibold text-violet-950">
                            {line.size ? `rozmiar ${line.size}` : line.sku}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-violet-900">
                            Pobierz <strong>{line.qty}</strong> szt. z{" "}
                            <span className="font-mono font-semibold">{line.fromLocationCode}</span>
                            {line.fromLocationName ? ` (${line.fromLocationName})` : ""} → powies na{" "}
                            <span className="font-mono font-semibold">{line.toLocationCode}</span>
                            {line.toLocationName ? ` (${line.toLocationName})` : ""}
                          </p>
                          <p className="mt-0.5 text-[10px] text-violet-700">
                            Na wieszaku: {line.currentShopQty}/{line.targetQty} szt. · {statusLabel(line.status)}
                          </p>
                        </div>
                        {onOpenLocationPreview ? (
                          <button
                            type="button"
                            className="text-[10px] font-semibold text-indigo-700 underline"
                            onClick={() => onOpenLocationPreview(line.toLocationCode, [line.model])}
                          >
                            Podglad
                          </button>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {line.status === "pending" ? (
                          <button
                            type="button"
                            className="rounded-lg border border-violet-400 bg-violet-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                            disabled={busyId === line.id}
                            onClick={() => onMarkPicked(line.id)}
                          >
                            Potwierdz pobranie z zaplecza
                          </button>
                        ) : null}
                        {line.status === "picked" ? (
                          <button
                            type="button"
                            className="rounded-lg border border-emerald-500 bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                            disabled={busyId === line.id}
                            onClick={() => onConfirmMove(line)}
                          >
                            {busyId === line.id ? "Zapisuję…" : "Zatwierdz powieszenie (przenies)"}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ));
                })}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}

      {doneCount > 0 ? (
        <details className="rounded-xl border border-violet-100 bg-white p-2 text-xs text-violet-800">
          <summary className="cursor-pointer font-semibold">Zakonczone ({doneCount})</summary>
          <ul className="mt-2 space-y-1">
            {lines
              .filter((line) => line.status === "done")
              .map((line) => (
                <li key={line.id} className="font-mono">
                  {line.sku}: {line.qty} szt. {line.fromLocationCode} → {line.toLocationCode}
                </li>
              ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
