## Lokalizacje Towaru (MVP)

Mobilna aplikacja do zarzadzania lokalizacjami SKU (SKLEP, ZAPLECZE, TMP, SPRZEDAZ).

## Uruchomienie lokalne

```bash
cp .env.example .env
npm install
npm run dev
```

## Docker

```bash
docker compose up -d --build
```

## Wazne: `SUPABASE_SERVICE_ROLE_KEY` (blad przy dodawaniu lokalizacji)

Jesli widzisz komunikat **„Brak SUPABASE_SERVICE_ROLE_KEY”**, aplikacja ma ustawione `SUPABASE_URL` i `SUPABASE_ANON_KEY`, ale **nie ma klucza serwisowego** potrzebnego do zapisow w bazie (INSERT do `locations`, `stock_movements` itd.).

1. W Supabase: **Project Settings → API**.
2. W sekcji **Project API keys** skopiuj **`service_role` (secret)** — to **nie** jest ten sam klucz co „publishable” / anon.
3. Na serwerze w pliku `/root/lokalizacje/.env` ustaw jedna linie (bez cudzyslowow, bez spacji wokol `=`):

   `SUPABASE_SERVICE_ROLE_KEY=tu_wklej_service_role`

4. Przeladuj kontener: `cd /root/lokalizacje && docker compose up -d`

**Bezpieczenstwo:** tego klucza **nigdy** nie wkladaj do kodu frontendu, repozytorium publicznego ani do zmiennych `NEXT_PUBLIC_*`. Tylko backend / Docker na serwerze.

---

## Co musisz wyklikac w Supabase

1. Wejdz do projektu Supabase: `qxrmxhjzrshogtaqcasy`.
2. Otworz `SQL Editor` -> `New query`.
3. Wklej caly plik `supabase/schema.sql`.
4. Kliknij `Run` (to utworzy tabele, widoki, indeksy i RLS policies).
5. Otworz `Table editor` -> `operators` -> `Insert row`.
6. Dodaj operatora:
   - `login`: np. `admin`
   - `role`: `ADMIN`
   - `is_active`: `true`
   - `auth_user_id`: zostaw puste (na teraz).
7. Otworz `Table editor` -> `locations` -> dodaj podstawowe lokalizacje:
   - `W1`, `W2`, `TMP`, `SPRZEDAZ`, `KARTON_1` (z odpowiednimi typami).
8. W `Project Settings -> API` skopiuj:
   - `Project URL` do `SUPABASE_URL`
   - `Publishable key` do `SUPABASE_ANON_KEY`
   - `service_role (secret)` do `SUPABASE_SERVICE_ROLE_KEY` (tylko backend, nigdy frontend)

## Kontrola gotowosci

Sprawdz:

```bash
curl http://localhost:3000/api/system/readiness
```

## Endpointy eksportowe pod Power Query

- `/api/export/stock-current`
- `/api/export/locations`
- `/api/export/movements?limit=500`
- `/api/export/sku-locations`
