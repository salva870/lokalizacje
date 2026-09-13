# Lokalizacje Towaru (LOC) — dokumentacja

Aplikacja webowa do ewidencji stanów magazynowych w sklepie i na zapleczu. Integruje się z **picklistą** (`picklist.divotikids.pl`) przez API.

---

## Spis treści

1. [Strefy i typy lokalizacji](#1-strefy-i-typy-lokalizacji)
2. [Priorytet pobierania towaru (picklista)](#2-priorytet-pobierania-towaru-picklista)
3. [Operacje magazynowe](#3-operacje-magazynowe)
4. [Panel administratora](#4-panel-administratora)
5. [Integracja z picklistą](#5-integracja-z-picklistą)
6. [API integracyjne](#6-api-integracyjne)

---

## 1. Strefy i typy lokalizacji

### Strefy (`parent_zone`)

| Strefa | Opis |
|--------|------|
| **SKLEP** | Sala sprzedaży — wieszaki, wystawy |
| **ZAPLECZE** | Magazyn / zaplecze |

### Typy lokalizacji (`location_type`)

| Klucz techniczny | Domyślna nazwa | Znaczenie |
|------------------|----------------|-----------|
| `DISPLAY` | Wieszak w sklepie | Towar na wieszaku w sklepie |
| `WYSTAWA` | Wystawa | Towar na wystawie / ekspozycji |
| `BACKROOM_BOX` | Karton na zapleczu | Karton w magazynie |
| `BACKROOM_SHELF` | Półka na zapleczu | Półka w magazynie |
| `BUFFER` | Bufor tymczasowy (np. TMP) | Lokalizacja przejściowa — **nie używana przy pickliście** |
| `RESERVED` | Rezerwa / sprzedaż | Rezerwa pod zamówienie — **nie używana przy pickliście** |
| `INACTIVE` | Nieaktywna | Ukryta przy wyborze lokalizacji |

**Nazwy typów** (kolumna „Domyślna nazwa”) można edytować w panelu admina — zmieniają się etykiety w LOC i pickliście, klucze techniczne pozostają stałe.

---

## 2. Priorytet pobierania towaru (picklista)

Gdy picklista **ściąga towar ze stanu** (zaznaczenie produktu jako zebrany), wybiera lokalizację źródłową według reguł:

### Dozwolone typy (w kolejności priorytetu)

1. **Wieszak w sklepie** (`DISPLAY`)
2. **Wystawa** (`WYSTAWA`)
3. **Karton** (`BACKROOM_BOX`)
4. **Półka** (`BACKROOM_SHELF`)

Typy `BUFFER`, `RESERVED`, `INACTIVE` **nie biorą udziału** w automatycznym pobieraniu z picklisty.

### W ramach tego samego typu

Kolejność wyznacza pole **`sort_order`** lokalizacji (ustawiane w adminie: „Kolejność lokalizacji (picklista)”).

### Kiedy system pyta o lokalizację

| Sytuacja | Zachowanie |
|----------|------------|
| Towar na **2+ wieszakach w sklepie** (`DISPLAY` + `SKLEP`) | **Obowiązkowy wybór** lokalizacji w pickliście |
| Towar na **2+ lokalizacjach tego samego, najwyższego priorytetu** (np. dwie wystawy) | **Obowiązkowy wybór** |
| Towar na **1 wieszaku w sklepie + zaplecze** | **Automatycznie** ze sklepu (wieszak), **bez pytania** |
| Jedna pickowalna lokalizacja | Automatyczny wybór |

Przy auto-wyborze (sklep + zaplecze) picklista pokazuje **domyślną lokalizację** na liście. Operator może ją **ręcznie zmienić** — dotknij podkreślonej kolumny lokalizacji na wierszu produktu.

---

## 3. Operacje magazynowe

### Dodaj stan (`ADD`)

Skanowanie SKU na aktywnej lokalizacji — zwiększa stan.

### Przenieś (`MOVE`)

Przeniesienie SKU z lokalizacji **Z** do **DO**. Możliwy wybór modeli z listy bez skanowania.

### Przenieś całą lokalizację

Przenosi **cały stan** z jednej lokalizacji do drugiej.

### Uzgodnij (`RECONCILE`)

Ustawia stan na lokalizacji na wartość z kolejki skanów (inwentaryzacja).

### Sprzedaż

Przeniesienie do rezerwy / finalizacja sprzedaży — osobny przepływ z wyborem źródła przy wielu lokalizacjach.

Po zapisie ruchu magazynowego aktywna lokalizacja jest **automatycznie zamykana** (trzeba ponownie wybrać / zeskanować kod lokalizacji).

### Kolejność modeli na wieszaku

Przy **aktualizacji stanu** i **dodawaniu stanu** modele zapisywują się wg **kolejności pierwszego skanu** w sesji (np. A → C → B, nie alfabetycznie).

- Pierwszy skan nowego modelu wstawia go w hierarchię wg momentu odczytu.
- Kolejne rozmiary tego samego modelu trafiają do **istniejącej grupy** bez zmiany pozycji modelu.
- **Nowy model** przy „dodaj stan” trafia **na koniec** dotychczasowej kolejności.
- **Alfabetycznie** sortują się tylko **rozmiary wewnątrz modelu**.

Kolejność widać w panelu „Stany” → zakładka „Na lokalizacjach” (indeks np. 2/20).

Przed zapisem **aktualizacji stanu** aplikacja pokazuje warstwę potwierdzenia z:
- komunikatem o nadpisaniu lokalizacji,
- listą **nowych** SKU (nie było na lokalizacji),
- listą **brakujących** SKU (było, nie ma w skanie),
- opcjonalnie **zmianami ilości** (ten sam SKU, inna liczba sztuk).

Listy różnic są w **kolejności listy do zapisania** (nowe / zmiana ilości) lub **zapisanej kolejności modeli na wieszaku** (brakujące).

---

## 4. Panel administratora

Dostęp: `/admin` (rola **ADMIN**).

| Sekcja | Funkcja |
|--------|---------|
| Operatorzy | Tworzenie kont, reset haseł |
| Sesje | Wylogowanie wszystkich użytkowników |
| Kolejność lokalizacji | `sort_order` dla picklisty i sortowania |
| **Nazwy typów lokalizacji** | Edycja etykiet wyświetlanych w LOC i pickliście |
| Istniejące lokalizacje | Edycja nazwy, strefy, typu |
| Nowa lokalizacja | Tworzenie lokalizacji z kodem, nazwą, strefą i typem |

---

## 5. Integracja z picklistą

Picklista pobiera stany przez proxy PHP (`loc_stock.php` → `/api/integration/stock`) i zdejmuje towar przez `loc_pick.php` → `/api/integration/pick`.

Autoryzacja: nagłówek `X-Loc-Integration-Key` (wspólny klucz w `.env` obu aplikacji).

Picklista synchronizuje:

- stany per SKU i lokalizacja,
- metadane lokalizacji (typ, strefa, kolejność),
- priorytety typów i etykiety typów.

---

## 6. API integracyjne

### `POST /api/integration/stock`

**Body:** `{ "skus": ["SKU-123", ...] }` (opcjonalnie — puste = cały stan)

**Odpowiedź (fragment):**

```json
{
  "items": {
    "SKU-123": [
      {
        "locationCode": "W1",
        "qty": 2,
        "parentZone": "SKLEP",
        "locationType": "DISPLAY",
        "sortOrder": 0,
        "locationName": "Wieszak 1"
      }
    ]
  },
  "locationOrder": ["W1", "W2"],
  "pickableLocationTypes": ["DISPLAY", "WYSTAWA", "BACKROOM_BOX", "BACKROOM_SHELF"],
  "pickTypePriority": { "DISPLAY": 1, "WYSTAWA": 2, ... },
  "locationTypeLabels": { "DISPLAY": "Wieszak w sklepie", ... }
}
```

### `POST /api/integration/pick`

**Body:**

```json
{
  "action": "pick" | "unpick",
  "lines": [
    {
      "sku": "SKU-123",
      "qty": 1,
      "fromLocationCode": "W1",
      "referenceNo": "order-123"
    }
  ]
}
```

- **`pick`** — zdjęcie ze stanu (`REMOVE`). Bez `fromLocationCode` stosuje reguły priorytetu; przy niejednoznaczności zwraca **409** z kodem `LOCATION_CHOICE_REQUIRED`.
- **`unpick`** — przywrócenie stanu (`ADD`); wymaga jawnego `fromLocationCode`.

---

## Zmiany techniczne (2026-08)

- Dodany typ lokalizacji **`WYSTAWA`**
- Rozdzielone etykiety: **Wieszak w sklepie** vs **Wystawa**
- Priorytet pickowania oparty o typ lokalizacji (nie tylko `sort_order`)
- Edytowalne nazwy typów w `app_settings` (`location_type_labels`)
- Migracja SQL: `supabase/migrations/005_location_type_wystawa.sql`
