# Changelog wdrożeń (serwer)

Format: data (CET) — krótki opis zmiany na produkcji.

## 2026-09-13

- **Repozytorium:** kod produkcyjny zsynchronizowany z [github.com/salva870/lokalizacje](https://github.com/salva870/lokalizacje) (`git pull` / `git push` z `/root/lokalizacje`).
- **Dokumentacja:** mapa aplikacji VPS (w tym mag.divotikids.pl) w `/opt/dom-app/DEPLOYMENT.md`; README LOC z linkiem do GitHub.
- **Aktualizacja:** przebudowa kontenera `lokalizacje-app` po `apt upgrade` i `docker compose build`.

## 2026-09-01

- **Naprawa ADD:** operacja „Dodaj stan” nie wysyła już przypadkowej lokalizacji źródłowej z poprzednich trybów (MOVE/REMOVE); backend ignoruje `from` przy ADD.

## 2026-08-31

- **UI / dodawanie:** po zeskanowaniu jednego modelu w trybie ADD wyswietlana jest opcjonalna podpowiedz z lokalizacjami, na ktorych model juz lezy; tap ustawia lokalizacje docelowa jak po skanie. Przy wiecej niz jednym modelu w sesji podpowiedz znika.
- **Wdrozenie:** przebudowano i zrestartowano kontener `lokalizacje-app` (port 3010) z nowa wersja frontendu.
- **Naprawa logowania:** przywrócono lokalną konfigurację Supabase (`SUPABASE_URL=http://lokalizacje-rest`, klucz `service_role`) i połączenie sieciowe z PostgREST; naprawiono `await` w `signIn()`. Błąd 500 po restarcie kontenera wynikał z pustego `SUPABASE_SERVICE_ROLE_KEY` i błędnego URL chmurowego w `.env`.
- **UI:** usunięto legacy `app/page.tsx` (dropdown „Akcja”), który po przebudowie nadpisywał główny panel z kafelkami operacji.

## 2026-04-18

- **Supabase / SQL:** poprawiono usuwanie `stock_current` — skrypt nie uzywa juz `DROP MATERIALIZED VIEW` na zwyklym widoku (blad 42809); uzywane jest warunkowe `DROP VIEW` / `DROP MATERIALIZED VIEW` w zaleznosci od `pg_class.relkind`.

- **UI / nawigacja:** dodano stronę `/settings` (konto: login, rola, wylogowanie) oraz `/admin` (zarządzanie lokalizacjami na telefonie i desktopie). W nagłówku panelu głównego linki „Konto” i „Administrator” (dla roli ADMIN).
- **Naprawa:** sekcja admina nie jest już ukryta na mobile (`hidden lg:block`); formularz lokalizacji przeniesiony do `/admin`.
- **Konfiguracja:** w `/root/lokalizacje/.env` dodano szablon `SUPABASE_SERVICE_ROLE_KEY` (wartość musi pochodzić z Supabase → Settings → API → service_role). Bez tego zapis nowych lokalizacji zwracał błąd.
- **Dokumentacja:** rozszerzono README i `.env.example` o opis błędu i kroki wdrożenia klucza serwisowego.
