# Changelog wdrożeń (serwer)

Format: data (CET) — krótki opis zmiany na produkcji.

## 2026-04-18

- **Supabase / SQL:** poprawiono usuwanie `stock_current` — skrypt nie uzywa juz `DROP MATERIALIZED VIEW` na zwyklym widoku (blad 42809); uzywane jest warunkowe `DROP VIEW` / `DROP MATERIALIZED VIEW` w zaleznosci od `pg_class.relkind`.

- **UI / nawigacja:** dodano stronę `/settings` (konto: login, rola, wylogowanie) oraz `/admin` (zarządzanie lokalizacjami na telefonie i desktopie). W nagłówku panelu głównego linki „Konto” i „Administrator” (dla roli ADMIN).
- **Naprawa:** sekcja admina nie jest już ukryta na mobile (`hidden lg:block`); formularz lokalizacji przeniesiony do `/admin`.
- **Konfiguracja:** w `/root/lokalizacje/.env` dodano szablon `SUPABASE_SERVICE_ROLE_KEY` (wartość musi pochodzić z Supabase → Settings → API → service_role). Bez tego zapis nowych lokalizacji zwracał błąd.
- **Dokumentacja:** rozszerzono README i `.env.example` o opis błędu i kroki wdrożenia klucza serwisowego.
