-- Lokalizacja uszkodzonych — poza picklista i domyslnymi sumami stanu.

ALTER TABLE public.locations DROP CONSTRAINT IF EXISTS locations_location_type_check;
ALTER TABLE public.locations ADD CONSTRAINT locations_location_type_check CHECK (
  location_type IN (
    'DISPLAY', 'WYSTAWA', 'BUFFER', 'RESERVED',
    'BACKROOM_BOX', 'BACKROOM_SHELF', 'INACTIVE', 'DAMAGED'
  )
);

INSERT INTO public.locations (code, name, parent_zone, location_type, is_active, barcode_value, sort_order)
VALUES ('USZKODZONE', 'Uszkodzone', 'ZAPLECZE', 'DAMAGED', true, 'LOC-USZKODZONE', 50)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  parent_zone = EXCLUDED.parent_zone,
  location_type = EXCLUDED.location_type,
  is_active = EXCLUDED.is_active,
  barcode_value = EXCLUDED.barcode_value,
  sort_order = EXCLUDED.sort_order;
