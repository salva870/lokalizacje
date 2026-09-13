-- Use this only as a template; do not store plaintext/hash passwords in repo.
-- Recommended: run `npm run supabase:reset-admin -- admin "NEW_STRONG_PASSWORD"` with env vars set.

-- Example manual flow (replace hash generated locally by bcrypt):
-- UPDATE operators
-- SET password_hash = '<bcrypt_hash>', is_active = true
-- WHERE lower(btrim(login)) = 'admin';
-- Reset hasła dla wiersza z loginem admin (bez rozróżniania wielkości liter, ignoruje spacje na brzegach).
-- Po wykonaniu w SQL Editor sprawdź wynik SELECT: hash_len powinno być 60. Jeśli jest mniejsze — kolumna
-- password_hash jest za krótka (np. VARCHAR(32)); zmień na TEXT lub VARCHAR(72).

UPDATE operators
SET
  password_hash = '$2b$10$rIESkSgnoSDOOEJgkNv5iOXtTLajHAa0RxFm6exLdLr0R1EwWVFOe',
  is_active = true
WHERE lower(btrim(login)) = 'admin';

SELECT
  login,
  char_length(password_hash) AS hash_len,
  is_active
FROM operators
WHERE lower(btrim(login)) = 'admin';
