-- Historia sprzedazy: sesje, pozycje, zalaczniki (zdjecia produktow bez SKU)

CREATE TABLE IF NOT EXISTS public.sale_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  operator_id text NOT NULL REFERENCES public.operators (id),
  note text NULL
);

CREATE TABLE IF NOT EXISTS public.sale_items (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.sale_sessions (id) ON DELETE CASCADE,
  sku text NULL,
  qty integer NOT NULL CHECK (qty > 0),
  from_location_code text NULL REFERENCES public.locations (code),
  movement_id bigint NULL REFERENCES public.stock_movements (id),
  note text NULL,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS sale_items_session_idx ON public.sale_items (session_id);

CREATE TABLE IF NOT EXISTS public.sale_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sale_sessions (id) ON DELETE CASCADE,
  item_id bigint NULL REFERENCES public.sale_items (id) ON DELETE SET NULL,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  original_name text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sale_sessions_created_idx ON public.sale_sessions (created_at DESC);
CREATE INDEX IF NOT EXISTS sale_attachments_session_idx ON public.sale_attachments (session_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_attachments TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.sale_items_id_seq TO service_role;

ALTER TABLE public.sale_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sale_sessions_no_client ON public.sale_sessions;
CREATE POLICY sale_sessions_no_client ON public.sale_sessions FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS sale_items_no_client ON public.sale_items;
CREATE POLICY sale_items_no_client ON public.sale_items FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS sale_attachments_no_client ON public.sale_attachments;
CREATE POLICY sale_attachments_no_client ON public.sale_attachments FOR ALL TO anon USING (false) WITH CHECK (false);
