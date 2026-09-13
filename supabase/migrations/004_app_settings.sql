-- Uniewaznianie wszystkich sesji (wylogowanie wszystkich urzadzen).
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.app_settings (key, value)
VALUES ('session_generation', '2')
ON CONFLICT (key) DO UPDATE
SET value = GREATEST(COALESCE(NULLIF(public.app_settings.value, '')::integer, 0), 2)::text,
    updated_at = now();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_settings_no_client ON public.app_settings;
CREATE POLICY app_settings_no_client ON public.app_settings FOR ALL TO anon USING (false) WITH CHECK (false);

NOTIFY pgrst, 'reload schema';
