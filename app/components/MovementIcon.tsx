import type { ReactNode } from "react";
import type { MovementType } from "@/lib/types";

export type OperationMode = MovementType | "RECONCILE" | "PREVIEW";

type MovementVisual = {
  label: string;
  hint: string;
  icon: ReactNode;
  idleClass: string;
  activeClass: string;
  iconIdleClass: string;
  iconActiveClass: string;
};

const svgProps = { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const movementVisuals: Record<MovementType, MovementVisual> = {
  ADD: {
    label: "Dodaj stan",
    hint: "Dodawanie do lokalizacji",
    icon: (
      <svg {...svgProps} aria-hidden>
        <path d="M12 5v14M5 12h14" />
        <rect x="3" y="3" width="18" height="18" rx="4" />
      </svg>
    ),
    idleClass: "border-emerald-200/90 bg-gradient-to-br from-emerald-50/90 to-white",
    activeClass: "border-emerald-600 bg-gradient-to-br from-emerald-100 to-white ring-2 ring-emerald-400/50 shadow-md",
    iconIdleClass: "bg-emerald-100 text-emerald-700",
    iconActiveClass: "bg-emerald-600 text-white shadow-sm",
  },
  REMOVE: {
    label: "Zdejmij stan",
    hint: "Zdejmowanie z lokalizacji",
    icon: (
      <svg {...svgProps} aria-hidden>
        <path d="M5 12h14" />
        <rect x="3" y="3" width="18" height="18" rx="4" />
      </svg>
    ),
    idleClass: "border-orange-200/90 bg-gradient-to-br from-orange-50/90 to-white",
    activeClass: "border-orange-500 bg-gradient-to-br from-orange-100 to-white ring-2 ring-orange-400/50 shadow-md",
    iconIdleClass: "bg-orange-100 text-orange-700",
    iconActiveClass: "bg-orange-500 text-white shadow-sm",
  },
  MOVE: {
    label: "Przenies",
    hint: "Przeniesienie miedzy lokalizacjami",
    icon: (
      <svg {...svgProps} aria-hidden>
        <path d="M7 7h10M7 7l3-3M7 7l3 3M17 17H7M17 17l-3 3M17 17l-3-3" />
      </svg>
    ),
    idleClass: "border-blue-200/90 bg-gradient-to-br from-blue-50/90 to-white",
    activeClass: "border-blue-700 bg-gradient-to-br from-blue-100 to-white ring-2 ring-blue-400/60 shadow-md",
    iconIdleClass: "bg-blue-100 text-blue-700",
    iconActiveClass: "bg-blue-700 text-white shadow-sm",
  },
  RESTORE_FROM_TMP: {
    label: "Przywroc z TMP",
    hint: "Wskazowka gdzie odlozyc po przymierzaniu (bez zmiany stanu)",
    icon: (
      <svg {...svgProps} aria-hidden>
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 4v5h5" />
      </svg>
    ),
    idleClass: "border-cyan-200/90 bg-gradient-to-br from-cyan-50/90 to-white",
    activeClass: "border-cyan-600 bg-gradient-to-br from-cyan-100 to-white ring-2 ring-cyan-400/50 shadow-md",
    iconIdleClass: "bg-cyan-100 text-cyan-700",
    iconActiveClass: "bg-cyan-600 text-white shadow-sm",
  },
  MOVE_TO_SALE: {
    label: "Sprzedaz",
    hint: "Zdejmuje ze stanu i zapisuje w logu",
    icon: (
      <svg {...svgProps} aria-hidden>
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
        <path d="M3 6h18M16 10a4 4 0 0 1-8 0" />
      </svg>
    ),
    idleClass: "border-amber-200/90 bg-gradient-to-br from-amber-50/90 to-white",
    activeClass: "border-amber-600 bg-gradient-to-br from-amber-100 to-white ring-2 ring-amber-400/50 shadow-md",
    iconIdleClass: "bg-amber-100 text-amber-700",
    iconActiveClass: "bg-amber-600 text-white shadow-sm",
  },
  SALE_FINALIZE: {
    label: "Finalizuj sprzedaz",
    hint: "Finalizacja sprzedazy",
    icon: (
      <svg {...svgProps} aria-hidden>
        <path d="M20 6 9 17l-5-5" />
        <circle cx="12" cy="12" r="10" />
      </svg>
    ),
    idleClass: "border-violet-200/90 bg-gradient-to-br from-violet-50/90 to-white",
    activeClass: "border-violet-600 bg-gradient-to-br from-violet-100 to-white ring-2 ring-violet-400/50 shadow-md",
    iconIdleClass: "bg-violet-100 text-violet-700",
    iconActiveClass: "bg-violet-600 text-white shadow-sm",
  },
};

export const operationVisuals: Record<OperationMode, MovementVisual> = {
  ...movementVisuals,
  RECONCILE: {
    label: "Aktualizuj stan",
    hint: "Nadpisuje caly stan i kolejnosc na lokalizacji",
    icon: (
      <svg {...svgProps} aria-hidden>
        <path d="M4 7h16M4 12h10M4 17h14" />
        <path d="M16 10v6l3-3-3-3" />
      </svg>
    ),
    idleClass: "border-teal-200/90 bg-gradient-to-br from-teal-50/90 to-white",
    activeClass: "border-teal-600 bg-gradient-to-br from-teal-100 to-white ring-2 ring-teal-400/50 shadow-md",
    iconIdleClass: "bg-teal-100 text-teal-700",
    iconActiveClass: "bg-teal-600 text-white shadow-sm",
  },
  PREVIEW: {
    label: "Podglad",
    hint: "Stan lokalizacji ze zdjeciami modeli",
    icon: (
      <svg {...svgProps} aria-hidden>
        <path d="M2 7v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7" />
        <path d="M16 3H8L6 7h12l-2-4Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
    idleClass: "border-indigo-200/90 bg-gradient-to-br from-indigo-50/90 to-white",
    activeClass: "border-indigo-600 bg-gradient-to-br from-indigo-100 to-white ring-2 ring-indigo-400/50 shadow-md",
    iconIdleClass: "bg-indigo-100 text-indigo-700",
    iconActiveClass: "bg-indigo-600 text-white shadow-sm",
  },
};

type MovementIconProps = {
  type: OperationMode;
  active?: boolean;
  size?: "sm" | "md";
};

export function MovementIcon({ type, active = false, size = "md" }: MovementIconProps) {
  const visual = operationVisuals[type];
  const box = size === "sm" ? "h-9 w-9 rounded-xl [&>svg]:h-4 [&>svg]:w-4" : "h-11 w-11 rounded-2xl [&>svg]:h-5 [&>svg]:w-5";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center transition ${box} ${active ? visual.iconActiveClass : visual.iconIdleClass}`}
      aria-hidden
    >
      {visual.icon}
    </span>
  );
}
