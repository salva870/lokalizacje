-- Nowy typ lokalizacji WYSTAWA (wystawa w sklepie) + rozszerzenie CHECK constraint.
ALTER TABLE public.locations DROP CONSTRAINT IF EXISTS locations_location_type_check;
ALTER TABLE public.locations ADD CONSTRAINT locations_location_type_check CHECK (
  location_type IN (
    'DISPLAY', 'WYSTAWA', 'BUFFER', 'RESERVED',
    'BACKROOM_BOX', 'BACKROOM_SHELF', 'INACTIVE'
  )
);

NOTIFY pgrst, 'reload schema';
