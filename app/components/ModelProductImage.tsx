"use client";

import { useEffect, useState } from "react";
import { productImageRedirectUrl } from "@/lib/productImage";

type ModelProductImageProps = {
  model: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  enableFullscreen?: boolean;
};

const sizeClasses = {
  sm: "h-16 w-14",
  md: "h-24 w-20",
  lg: "h-[min(72vh,36rem)] w-full max-w-lg",
};

export function ModelProductImage({
  model,
  size = "md",
  className = "",
  enableFullscreen = true,
}: ModelProductImageProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const src = productImageRedirectUrl(model);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [fullscreen]);

  const boxClass = `${sizeClasses[size]} ${className}`.trim();

  if (!src) return null;

  return (
    <>
      <button
        type="button"
        className={`relative shrink-0 overflow-hidden rounded-xl border border-blue-200/90 bg-blue-50/80 shadow-sm transition active:scale-[0.98] ${
          enableFullscreen ? "cursor-zoom-in hover:ring-2 hover:ring-indigo-400/60" : "cursor-default"
        } ${boxClass}`}
        onClick={() => enableFullscreen && setFullscreen(true)}
        disabled={!enableFullscreen}
        aria-label={`Powieksz zdjecie modelu ${model}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={`Zdjecie produktu ${model}`}
          className="h-full w-full object-cover object-top"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      </button>

      {fullscreen ? (
        <div
          className="fixed inset-0 z-[90] flex flex-col bg-black/95"
          role="dialog"
          aria-modal
          aria-label={`Zdjecie modelu ${model}`}
        >
          <div
            className="flex shrink-0 items-center justify-between gap-3 px-4 py-3"
            style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
          >
            <p className="truncate font-mono text-sm font-semibold text-white">{model}</p>
            <button
              type="button"
              className="rounded-xl bg-white/15 px-4 py-2 text-sm font-semibold text-white"
              onClick={() => setFullscreen(false)}
            >
              Zamknij
            </button>
          </div>
          <button
            type="button"
            className="flex min-h-0 flex-1 items-center justify-center p-4"
            onClick={() => setFullscreen(false)}
            aria-label="Zamknij podglad"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={`Zdjecie produktu ${model}`}
              className="max-h-full max-w-full object-contain"
              referrerPolicy="no-referrer"
              onClick={(event) => event.stopPropagation()}
            />
          </button>
        </div>
      ) : null}
    </>
  );
}
