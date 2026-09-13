# Raport z audytu bezpieczeństwa — loc.divotikids.pl

Data: 2026-04-22
Status: wstepny audyt + lista napraw

## Krytyczne

1. Pusty `AUTH_SECRET` w kontenerze (mozliwosc falszowania JWT i cookie trust)
2. Brak twardych naglowkow bezpieczenstwa HTTP na vhoscie `loc.divotikids.pl`
3. Brak ochrony CSRF dla endpointow zmieniajacych stan

## Wysokie

4. Domyslne konto admina / reset hasla z repo
5. Login rate-limit tylko in-memory (reset po restarcie)
6. `loc_device_trust` zbyt dlugi TTL i brak powiazania z kontem
7. Szczegoly bledow Supabase zwracane do klienta

## Srednie

8. Brak uniewazniania JWT (logout usuwa tylko cookie)
9. Zbyt agresywne cache dla HTML (`s-maxage`)
10. Fingerprinting (`X-Powered-By`, `Server`)
11. Fallback `ilike` dla loginu (potencjalne edge-case LIKE)
12. Brak dopracowanej CSP pod skaner (camera/canvas/blob)

## Niskie / Info

- `robots.txt` i `X-Robots-Tag` sa poprawne
- `/admin` renderuje shell przed przekierowaniem (brak wycieku danych API)
- Ostrzezenie nginx `proxy_headers_hash`
- Porzadki artefaktow (`deploy.tgz`, backupi `.env`)

## Plan napraw (priorytet)

1. Ustawic silny `AUTH_SECRET`, wymusic fail-fast w kodzie
2. Dodac naglowki bezpieczenstwa w nginx + `server_tokens off`
3. Dodac walidacje `Origin/Referer` dla POST/PATCH/DELETE
4. Ustawic `Cache-Control: no-store` dla stron aplikacji
5. Ograniczyc i zwiazac `loc_device_trust` z userem
6. Przeniesc throttle do wspoldzielonego store (Redis/Supabase)
7. Zredukowac szczegoly bledow zwracanych klientowi

## Co wdrozone od razu po audycie

- Dodany fail-fast dla `AUTH_SECRET` (`lib/authSecret.ts`)
- Dodany Origin/Referer check (`lib/csrf.ts`) i podpiecie pod mutacje API
- `next.config.ts`: `poweredByHeader: false` oraz `Cache-Control: no-store` dla `/`, `/login`, `/admin`
- Porzadki plikow: usuniety `deploy.tgz`, usuniety backup `.env.bak.`, dodany `.dockerignore`
- `supabase/reset-admin-password.sql` zastapiony bezpiecznym szablonem (bez hasha)

