"use client";

import { useState } from "react";
import { ModelChangeLogOverlay } from "@/app/components/ModelChangeLogOverlay";

type Props = {
  model: string;
  className?: string;
};

export function ModelLogButton({ model, className = "" }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={`inline-flex min-h-8 min-w-[2.75rem] items-center justify-center rounded-lg border-2 border-indigo-500 bg-indigo-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white shadow-md hover:bg-indigo-700 active:bg-indigo-800 ${className}`}
        title={`Log zmian modelu ${model}`}
        aria-label={`Log zmian modelu ${model}`}
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          setOpen(true);
        }}
      >
        Log
      </button>
      {open ? <ModelChangeLogOverlay model={model} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
