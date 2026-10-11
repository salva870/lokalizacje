"use client";

import type { DuplicateAddRisk } from "@/lib/addDuplicateGuard";

type Props = {
  open: boolean;
  locationCode: string;
  risks: DuplicateAddRisk[];
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function AddDuplicateConfirmModal({
  open,
  locationCode,
  risks,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  if (!open || risks.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-red-950/70 p-3 sm:items-center">
      <div className="w-full max-w-md rounded-3xl border-2 border-red-600 bg-white p-5 shadow-xl">
        <p className="text-center text-sm font-black uppercase tracking-wide text-red-700">Uwaga</p>
        <h2 className="mt-1 text-center text-xl font-extrabold text-red-700">Błąd — ryzyko podwojenia stanu</h2>
        <p className="mt-3 text-sm leading-relaxed text-red-950">
          Na lokalizacji <span className="font-mono font-bold">{locationCode}</span> dodajesz dokładnie tyle samo sztuk
          <strong> tego samego kodu produktu</strong>, ile już tam jest. To często oznacza przypadkowe{" "}
          <strong>podwojenie</strong> stanu (np. drugi raz ta sama partia skanów).
        </p>
        <ul className="mt-3 space-y-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-950">
          {risks.map((risk) => (
            <li key={risk.sku}>
              <span className="font-mono font-semibold">{risk.sku}</span>
              <span className="text-red-800"> (model {risk.model})</span>: jest <strong>{risk.existingQty}</strong> szt.,
              dodajesz <strong>{risk.addingQty}</strong> szt.
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm font-medium text-red-900">Kontynuować tylko jeśli jesteś pewien, że to zamierzone.</p>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            className="flex-1 rounded-2xl border-2 border-red-300 bg-white py-3 text-sm font-bold text-red-800"
            disabled={busy}
            onClick={onCancel}
          >
            Anuluj
          </button>
          <button
            type="button"
            className="flex-1 rounded-2xl bg-red-700 py-3 text-sm font-bold text-white disabled:opacity-50"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Zapisuję…" : "Tak, dodaj mimo to"}
          </button>
        </div>
      </div>
    </div>
  );
}
