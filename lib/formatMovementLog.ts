import { parseSkuModel } from "@/lib/skuModel";
import type { MovementType, StockMovement } from "@/lib/types";

const movementTypeLabels: Record<MovementType, string> = {
  ADD: "Dodaj stan",
  REMOVE: "Zdejmij stan",
  MOVE: "Przenies",
  RESTORE_FROM_TMP: "Przywroc z TMP",
  MOVE_TO_SALE: "Sprzedaz",
  SALE_FINALIZE: "Finalizacja sprzedazy",
};

export function movementTypeLabel(type: MovementType): string {
  return movementTypeLabels[type] ?? type;
}

export function formatMovementRoute(movement: StockMovement): string {
  const from = movement.fromLocationCode?.trim();
  const to = movement.toLocationCode?.trim();
  switch (movement.movementType) {
    case "ADD":
      return to ? `→ ${to}` : "—";
    case "REMOVE":
      return from ? `${from} →` : "—";
    case "MOVE":
      return from && to ? `${from} → ${to}` : from || to || "—";
    case "MOVE_TO_SALE":
    case "SALE_FINALIZE":
      return from ? `${from} → sprzedaż` : "sprzedaż";
    case "RESTORE_FROM_TMP":
      return "sugestia (bez zmiany stanu)";
    default:
      return [from, to].filter(Boolean).join(" → ") || "—";
  }
}

export function formatMovementTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" });
}

export function movementSizeLabel(sku: string): string {
  const { size } = parseSkuModel(sku);
  return size || "—";
}
