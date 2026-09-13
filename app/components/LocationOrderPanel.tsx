"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { zoneLabels } from "@/lib/locationMeta";
import type { Location, Zone } from "@/lib/types";

type LocationOrderPanelProps = {
  locations: Array<Pick<Location, "code" | "name" | "parentZone" | "sortOrder">>;
  onSaved?: (items: Location[]) => void;
  onClose?: () => void;
  embedded?: boolean;
};

export function LocationOrderPanel({ locations, onSaved, onClose, embedded = false }: LocationOrderPanelProps) {
  const [codes, setCodes] = useState(() => locations.map((loc) => loc.code));
  const [dragCode, setDragCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setCodes(locations.map((loc) => loc.code));
  }, [locations]);

  const locationMap = useMemo(() => new Map(locations.map((loc) => [loc.code, loc])), [locations]);

  const ordered = useMemo(
    () => codes.map((code) => locationMap.get(code)).filter((loc): loc is NonNullable<typeof loc> => Boolean(loc)),
    [codes, locationMap],
  );

  const move = useCallback((fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= codes.length || fromIndex === toIndex) return;
    setCodes((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, [codes.length]);

  const save = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/location-order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(data.error ?? "Nie udalo sie zapisac kolejnosci.");
        return;
      }
      setMessage("Zapisano kolejnosc lokalizacji (picklista uzyje jej przy sortowaniu).");
      onSaved?.(data.items ?? []);
    } catch {
      setMessage("Nie udalo sie zapisac kolejnosci.");
    } finally {
      setBusy(false);
    }
  }, [codes, onSaved]);

  const body = (
    <>
      <p className="text-sm text-blue-700">
        Przeciagnij lokalizacje w kolejnosci zbierania na pickliscie (np. najpierw wieszaki sklepu, potem zaplecze).
      </p>
      {message ? <p className="mt-2 rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-800">{message}</p> : null}
      <ul className="mt-3 space-y-2">
        {ordered.map((location, index) => (
          <li
            key={location.code}
            draggable
            onDragStart={() => setDragCode(location.code)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (!dragCode || dragCode === location.code) return;
              const fromIndex = codes.indexOf(dragCode);
              move(fromIndex, index);
              setDragCode(null);
            }}
            className="flex items-center gap-2 rounded-xl border border-dashed border-blue-300 bg-blue-50/70 px-3 py-2"
          >
            <span className="cursor-grab text-blue-400" aria-hidden>
              ⠿
            </span>
            <span className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-blue-800">
              {index + 1}/{ordered.length}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-blue-900">{location.code}</p>
              <p className="truncate text-xs text-blue-700">
                {location.name} · {zoneLabel(location.parentZone)}
              </p>
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                className="rounded border border-blue-200 bg-white px-1.5 py-0.5 text-xs text-blue-800 disabled:opacity-40"
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="rounded border border-blue-200 bg-white px-1.5 py-0.5 text-xs text-blue-800 disabled:opacity-40"
                disabled={index === ordered.length - 1}
                onClick={() => move(index, index + 1)}
              >
                ↓
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="mt-4 w-full rounded-2xl bg-blue-800 py-3 text-sm font-semibold text-white disabled:opacity-50"
        disabled={busy || ordered.length === 0}
        onClick={() => void save()}
      >
        {busy ? "Zapisywanie…" : "Zapisz kolejnosc"}
      </button>
    </>
  );

  if (embedded) {
    return <div>{body}</div>;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-blue-950/55 p-3 sm:items-center">
      <div className="flex max-h-[min(92vh,860px)] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-blue-100 px-4 pb-3 pt-4">
          <div>
            <h2 className="text-lg font-semibold text-blue-900">Kolejnosc lokalizacji</h2>
            <p className="mt-1 text-sm text-blue-700">Do sortowania zbierania na pickliscie.</p>
          </div>
          {onClose ? (
            <button type="button" className="rounded-xl border border-blue-200 px-3 py-2 text-sm text-blue-900" onClick={onClose}>
              Zamknij
            </button>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">{body}</div>
      </div>
    </div>
  );
}

function zoneLabel(zone: Zone | undefined): string {
  if (!zone) return "Strefa: ?";
  return zoneLabels[zone] ?? zone;
}
