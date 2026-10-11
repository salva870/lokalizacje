-- Docelowa liczba sztuk na rozmiar na ekspozycji w sklepie (per model).
CREATE TABLE IF NOT EXISTS public.model_shop_display_target (
  model text PRIMARY KEY,
  target_qty integer NOT NULL DEFAULT 2
    CHECK (target_qty >= 0 AND target_qty <= 99),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.model_shop_display_target TO service_role;
ALTER TABLE public.model_shop_display_target ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS model_shop_display_target_no_client ON public.model_shop_display_target;
CREATE POLICY model_shop_display_target_no_client ON public.model_shop_display_target
  FOR ALL TO anon USING (false) WITH CHECK (false);

NOTIFY pgrst, 'reload schema';
