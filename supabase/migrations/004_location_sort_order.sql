-- Kolejność lokalizacji do zbierania (picklista).
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS locations_sort_order_idx
  ON public.locations (sort_order, code);

UPDATE public.locations loc
SET sort_order = ranked.rn * 10
FROM (
  SELECT code, ROW_NUMBER() OVER (ORDER BY code) - 1 AS rn
  FROM public.locations
) ranked
WHERE loc.code = ranked.code
  AND loc.sort_order = 0;
