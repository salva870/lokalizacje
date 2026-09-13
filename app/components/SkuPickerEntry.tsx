"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { searchSkuSuggestions, type SkuSuggestion } from "@/lib/skuLookup";
import type { StockRow } from "@/lib/stockViews";
import type { LocationType } from "@/lib/types";

type SkuPickerEntryProps = {
  stock: StockRow[];
  locationTypes?: Map<string, LocationType>;
  locationCode?: string;
  excludeDamaged?: boolean;
  tone?: "rose" | "amber" | "indigo";
  disabled?: boolean;
  emptyLocationHint?: string;
  onPick: (sku: string) => void;
  /** Enter bez wyboru z listy — np. podglad po wpisanym kodzie. */
  onSubmitQuery?: (query: string) => void;
};

export function SkuPickerEntry({
  stock,
  locationTypes,
  locationCode = "",
  excludeDamaged = false,
  tone = "rose",
  disabled = false,
  emptyLocationHint,
  onPick,
  onSubmitQuery,
}: SkuPickerEntryProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const blurTimerRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const locationRequired = Boolean(emptyLocationHint);
  const locationReady = !locationRequired || Boolean(locationCode.trim());
  const inputDisabled = disabled || !locationReady;

  const suggestions = useMemo(() => {
    if (!locationReady || query.trim().length < 1) return [];
    return searchSkuSuggestions(stock, query, {
      locationCode: locationCode.trim() || undefined,
      excludeDamaged,
      locationTypes,
      limit: 12,
    });
  }, [excludeDamaged, locationCode, locationReady, locationTypes, query, stock]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [suggestions]);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current != null) window.clearTimeout(blurTimerRef.current);
    };
  }, []);

  const borderClass =
    tone === "amber" ? "border-amber-200" : tone === "indigo" ? "border-indigo-200" : "border-rose-200";
  const labelClass =
    tone === "amber" ? "text-amber-800" : tone === "indigo" ? "text-indigo-800" : "text-rose-800";
  const listBorderClass =
    tone === "amber" ? "border-amber-200" : tone === "indigo" ? "border-indigo-200" : "border-rose-200";
  const highlightClass =
    tone === "amber" ? "bg-amber-100" : tone === "indigo" ? "bg-indigo-100" : "bg-rose-100";
  const emptyHintBorderClass =
    tone === "amber"
      ? "border-amber-200 bg-amber-50/60 text-amber-800"
      : tone === "indigo"
        ? "border-indigo-200 bg-indigo-50/60 text-indigo-800"
        : "border-rose-200 bg-rose-50/60 text-rose-800";

  function pickSuggestion(suggestion: SkuSuggestion) {
    onPick(suggestion.sku);
    setQuery("");
    setOpen(false);
  }

  function handleFocus() {
    if (blurTimerRef.current != null) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    if (suggestions.length > 0) setOpen(true);
  }

  function handleBlur() {
    blurTimerRef.current = window.setTimeout(() => setOpen(false), 150);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) {
      if (event.key === "ArrowDown" && suggestions.length > 0) {
        setOpen(true);
        event.preventDefault();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((prev) => (prev + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const picked = suggestions[highlightIndex];
      if (picked) {
        pickSuggestion(picked);
        return;
      }
      const raw = query.trim();
      if (raw && onSubmitQuery) {
        onSubmitQuery(raw);
        setQuery("");
        setOpen(false);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && locationReady && query.trim().length > 0;

  return (
    <div ref={rootRef} className="relative mt-3 space-y-2">
      <p className={`text-xs font-medium uppercase tracking-wide ${labelClass}`}>Wpisz recznie</p>
      <p className={`text-xs ${labelClass}`}>
        Zacznij wpisywac kod — wybierz konkretny SKU z listy (bez bledow w rozmiarze).
      </p>
      {!locationReady && emptyLocationHint ? (
        <p className={`rounded-xl border border-dashed px-3 py-2 text-xs ${emptyHintBorderClass}`}>
          {emptyLocationHint}
        </p>
      ) : null}
      <input
        type="text"
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        disabled={inputDisabled}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder="np. S-T-034 lub S-T-034-134"
        className={`w-full rounded-xl border bg-white px-3 py-2.5 font-mono text-sm text-blue-950 disabled:opacity-45 ${borderClass}`}
      />
      {showList ? (
        <ul
          className={`absolute z-20 max-h-56 w-full overflow-y-auto rounded-xl border bg-white shadow-lg ${listBorderClass}`}
          role="listbox"
        >
          {suggestions.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-slate-600">Brak dopasowanych SKU na stanie.</li>
          ) : (
            suggestions.map((suggestion, index) => (
              <li key={suggestion.sku} role="option" aria-selected={index === highlightIndex}>
                <button
                  type="button"
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left ${
                    index === highlightIndex ? highlightClass : "hover:bg-slate-50"
                  }`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pickSuggestion(suggestion)}
                >
                  <span className="font-mono text-sm font-semibold text-blue-950">{suggestion.sku}</span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-600">
                    {suggestion.qty} szt.
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
