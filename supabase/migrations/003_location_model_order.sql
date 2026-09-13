-- Migracja: kolejnosc modeli na lokalizacji (uruchom na istniejacej bazie).
CREATE TABLE IF NOT EXISTS public.location_model_order (
  location_code text NOT NULL REFERENCES public.locations (code) ON DELETE CASCADE,
  model text NOT NULL,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NULL REFERENCES public.operators (id),
  PRIMARY KEY (location_code, model)
);

CREATE INDEX IF NOT EXISTS location_model_order_location_sort_idx
  ON public.location_model_order (location_code, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.location_model_order TO service_role;
ALTER TABLE public.location_model_order ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
