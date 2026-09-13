-- Domyslne lokalizacje i konto administratora.
-- Haslo startowe: ustaw przez scripts/reset-admin-password.mjs po pierwszym deployu.

INSERT INTO public.operators (id, login, role, password_hash, is_active)
VALUES (
  'u-admin-1',
  'admin',
  'ADMIN',
  '$2b$10$rIESkSgnoSDOOEJgkNv5iOXtTLajHAa0RxFm6exLdLr0R1EwWVFOe',
  true
)
ON CONFLICT (id) DO UPDATE SET
  login = EXCLUDED.login,
  role = EXCLUDED.role,
  password_hash = EXCLUDED.password_hash,
  is_active = EXCLUDED.is_active;

INSERT INTO public.locations (code, name, parent_zone, location_type, is_active, barcode_value)
VALUES
  ('W1', 'Wieszak 1', 'SKLEP', 'DISPLAY', true, 'LOC-W1'),
  ('W2', 'Wieszak 2', 'SKLEP', 'DISPLAY', true, 'LOC-W2'),
  ('TMP', 'Tymczasowe', 'SKLEP', 'BUFFER', true, 'LOC-TMP'),
  ('SPRZEDAZ', 'Sprzedaz/Rezerwacja', 'SKLEP', 'RESERVED', true, 'LOC-SPRZEDAZ'),
  ('KARTON_1', 'Karton 1', 'ZAPLECZE', 'BACKROOM_BOX', true, 'LOC-KARTON_1'),
  ('USZKODZONE', 'Uszkodzone', 'ZAPLECZE', 'DAMAGED', true, 'LOC-USZKODZONE')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  parent_zone = EXCLUDED.parent_zone,
  location_type = EXCLUDED.location_type,
  is_active = EXCLUDED.is_active,
  barcode_value = EXCLUDED.barcode_value;
