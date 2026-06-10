# PROCESSBASE
## Vstupný dokument — technická špecifikácia

> **Účel:** Tento dokument popisuje aktuálny stav implementácie a slúži ako podklad pre ďalší vývoj. Nové požiadavky sú zaznamenané v sekcii 7 s prioritou, popisom a akceptačnými kritériami.

Posledná aktualizácia: 10. júna 2026

---

## 1. Architektúra

| Aplikácia | Adresár | Technológia | Port | Účel |
|-----------|---------|-------------|------|------|
| **Platforma** | `process-platform-angular/` | Angular 18 + Express 5 (TypeScript) | 4200 / 3000 | Hlavná aplikácia pre firmy |
| **Backoffice** | `process-platform-backoffice/` | Angular 18 | 4300 | Admin aplikácia prevádzkovateľa |
| Databáza | Docker | PostgreSQL 16 + Prisma 7 | 5432 | Zdieľaná oboma aplikáciami |
| *(archív)* Prototyp | `process-platform/` | Vite + Express + SQLite | 5173/3000 | Pôvodný MVP, už sa nerozvíja |
| *(archív)* Legacy | koreňový adresár | PHP + MySQL | — | Pôvodný systém, už sa nerozvíja |

- Backoffice nemá vlastný backend — volá API platformy cez `/api/backoffice/*` (dev proxy → port 3000)
- Prisma klient sa generuje do `process-platform-angular/generated/` (nie je v gite)
- GitHub: https://github.com/janvierik-png/processbase

### Spustenie (vývoj)

```powershell
# 1. PostgreSQL
docker compose up -d postgres

# 2. Platforma
npm.cmd run dev          # → http://localhost:4200, API http://localhost:3000

# 3. Backoffice (voliteľné)
cd process-platform-backoffice
npm.cmd run dev          # → http://localhost:4300

# Po zmene schema.prisma:
npm.cmd run db:generate
npm.cmd run db:migrate
```

---

## 2. Implementované — Platforma (port 4200)

### 2.1 Landing page a autentifikácia
- Verejná úvodná stránka s cenovými plánmi (Starter / Business / Enterprise — len vizuál)
- **Registrácia firmy:** názov + meno ownera + email + heslo → `User` (scrypt hash), `Organization`, auto-login
- **Login:** email + heslo, overenie DB, chybové hlásenia
- **Prijatie pozvánky:** URL `/?invite=TOKEN` → formulár (meno + heslo) → pridanie do org, auto-login
- Session v localStorage (`ngCurrentUser`, `ngCurrentOrganization`)
- Route guard: `/app/*` vyžaduje prihlásenie

### 2.2 Procesy (`/app/processes`)
- Stromová štruktúra procesov a skupín (vytváranie, premenovanie, mazanie)
- **BPMN editor** (bpmn-js) s Camunda 7 properties panelom
- Popis procesu, riziká, ISO väzby, stavy: Návrh / Na schválenie / Schválené / Archív
- **Revízie:** pomenovaná verzia s BPMN XML do DB (UI na historickú revíziu chýba)
- Prílohy k procesu (upload, mazanie), Camunda 7 deploy, história deploymentov
- Optimistic updates

### 2.3 Dokumenty (`/app/documents`)
- Prehľad všetkých príloh organizácie, mazanie

### 2.4 Nastavenia firmy (`/app/settings`)
- Zmena názvu spoločnosti
- **Pozvánky:** email + rola, token (platnosť 14 dní), tlačidlo „Kopírovať link"
- Zoznam používateľov + stav pozvánok (pending / accepted / expired)
- Prehľad rolí a oprávnení (statický)

### 2.5 Jazyky
- Prepínač SK / EN v hlavičke, preklady z DB, fallback na defaulty + localStorage cache

---

## 3. Implementované — Backoffice (port 4300)

- **Dashboard:** počty organizácií, používateľov, procesov, prekladov
- **Organizácie:** tabuľka všetkých firiem (slug, jazyk, počty, dátum)
- **Preklady:** CRUD globálnych prekladov SK/EN, import predvolených, editácia kliknutím
- **Integrácie:** prehľad Camunda 7 a dokumentového úložiska (read-only)
- Bez prihlásenia — určené len pre lokálny vývoj

---

## 4. API endpointy (Express, port 3000)

### Auth a organizácie

| Metóda | Endpoint | Popis |
|--------|----------|-------|
| POST | `/api/register` | Registrácia firmy + ownera |
| POST | `/api/login` | Prihlásenie |
| PATCH | `/api/organizations/:id` | Zmena názvu organizácie |
| GET | `/api/organizations/:id/users` | Členovia organizácie |
| GET/POST | `/api/organizations/:id/invitations` | Pozvánky |
| GET | `/api/invitations/:token` | Detail pozvánky |
| POST | `/api/invitations/:token/accept` | Prijatie pozvánky |

### Procesy

| Metóda | Endpoint | Popis |
|--------|----------|-------|
| GET | `/api/organizations/:id/processes` | Strom procesov |
| POST | `/api/organizations/:id/processes` | Nový proces |
| PATCH | `/api/processes/:id` | Úprava procesu (BPMN XML) |
| DELETE | `/api/processes/:id` | Vymazanie |
| POST | `/api/processes/:id/revisions` | Uloženie revízie |
| GET/POST | `/api/processes/:id/documents` | Prílohy procesu |
| GET | `/api/organizations/:id/documents` | Všetky prílohy |
| DELETE | `/api/documents/:id` | Vymazanie prílohy |
| POST | `/api/processes/:id/camunda7/deploy` | Deploy do Camunda 7 |

### Preklady a backoffice

| Metóda | Endpoint | Popis |
|--------|----------|-------|
| GET | `/api/translations` | Globálny slovník |
| GET | `/api/backoffice/stats` | Štatistiky platformy |
| GET | `/api/backoffice/organizations` | Všetky organizácie |
| GET/PUT/DELETE | `/api/backoffice/translations` | CRUD prekladov |
| POST | `/api/backoffice/translations/import` | Bulk import prekladov |

---

## 5. Databázový model (Prisma)

- `Organization` → `OrganizationUser` (rola, isOwner) → `User`
- `ProcessNode`: strom cez parentId, typ GROUP/PROCESS, BPMN XML, ISO väzby, stav
- `ProcessRevision` (verzie BPMN + SVG), `Attachment`, `Invitation` (token, exspirácia, stav)
- `ApprovalRequest` / `ApprovalStep`, `IsoTemplate`, `Translation`, `CamundaDeployment`

**Mapovanie rolí (frontend ↔ DB):**

| Frontend | DB rola |
|----------|---------|
| owner | OWNER |
| admin | ADMIN |
| quality | MANAGER |
| approver | MODELER |
| iso | AUDITOR |

---

## 6. Známe obmedzenia / technický dlh

| # | Problém | Závažnosť |
|---|---------|-----------|
| 1 | API nemá autorizáciu — žiadne session/JWT tokeny. Pred produkciou nutné. | **KRITICKÁ** |
| 2 | Backoffice nemá login — ktokoľvek s URL má admin prístup. | **KRITICKÁ** |
| 3 | Pozvánkové emaily sa neposielajú — manuálne kopírovanie linku. | Stredná |
| 4 | Schvaľovací workflow má DB model, ale chýba UI aj API. | Stredná |
| 5 | ISO šablóny (`IsoTemplate`) majú DB model, ale nepoužívajú sa. | Nízka |
| 6 | PDF/DOCX export chýba v Angular verzii. | Stredná |
| 7 | Prílohy uložené ako dataURL v DB — nevhodné pre väčšie súbory. | Stredná |
| 8 | Per-org preklady sa nepoužívajú — všetky sú globálne. | Nízka |
| 9 | Camunda 7 vyžaduje bežiacu inštanciu na porte 8080. | Nízka |
| 10 | Žiadne automatizované testy. | Stredná |
| 11 | UI na historickú revíziu a drag-and-drop strom chýba v Angular verzii. | Stredná |

---

## 7. Plánované požiadavky

### Prehľad

| # | Názov | Oblasť | Priorita |
|---|-------|--------|---------|
| R1 | Organizačná štruktúra a pracovné pozície | Platforma / API / DB | **P1** |
| R2 | Prepracovaný procesný strom (len procesy, drag-and-drop) | Platforma / API | **P1** |
| R3 | Karta procesu — rozšírený formulár a detailná stránka | Platforma | **P1** |
| R4 | ISO normy v Backoffice — upload PDF a generovanie štruktúry | Backoffice / API / DB | P2 |
| R5 | Auto-detekcia ISO normy a bodu z procesov | API / Platforma | P2 |
| R6 | Zobrazenie procesov podľa ISO štruktúry | Platforma | P2 |
| R7 | Audit log zmien procesov + verzie + detailná stránka procesu | Platforma / API / DB | **P1** |
| R8 | Automatický preklad do druhého jazyka | Platforma / API | P2 |
| R9 | Backoffice login formulár (admin účet) | Backoffice / API | **P1** |
| R10 | Odstránenie Backoffice sekcie z platformy (4200) | Platforma | P2 |
| R11 | Validácia registračného formulára voči DB | Platforma / API | **P1** |

---

### R1: Organizačná štruktúra a pracovné pozície
- **Priorita:** P1 — Kritická
- **Kde:** Platforma (`/app/settings`), API, Databáza
- **Popis:** Owner/admin môže v nastaveniach firmy spravovať organizačnú štruktúru: vytvárať a premenovávať pracovné pozície (nie systémové roly), priraďovať ich jednotlivým používateľom. Pracovné pozície sú samostatný DB model naviazaný na organizáciu a používateľa. Sekcia nahrádza doterajší odkaz na backoffice v nastaveniach.
- **Akceptačné kritériá:**
  - Existuje CRUD pre pracovné pozície v `/app/settings/positions`
  - Pozícia sa dá priradiť používateľovi (viacnásobné priradenie)
  - Priradenie je uložené v DB (tabuľky `OrgPosition` a `UserPosition`)
  - Selektor pozícií je dostupný vo formulári procesu (R3)
  - Pozície sú viditeľné v zozname používateľov
- **Závislosti:** —
- **Technické detaily:**
  - DB: nová tabuľka `OrgPosition { id, organizationId, name, description, createdAt }`
  - DB: nová tabuľka `UserPosition { userId, positionId, assignedAt }`
  - API: `GET/POST/PATCH/DELETE /api/organizations/:id/positions`
  - API: `POST/DELETE /api/users/:id/positions`

---

### R2: Prepracovaný procesný strom
- **Priorita:** P1 — Kritická
- **Kde:** Platforma (`/app/processes`), API
- **Popis:** Procesný strom bude zobrazovať len procesy (žiadne skupiny). Každý proces môže byť nadradený inému procesu — hierarchia sa definuje nadriadeným procesom. Drag-and-drop presunutie procesu pod iný proces prepíše nadradený proces v DB aj v karte procesu. Panel so stromom sa dá rozšíriť, zúžiť a úplne skryť (responzívne).
- **Akceptačné kritériá:**
  - V strome sa zobrazujú len uzly typu `PROCESS`
  - Drag-and-drop funguje a ukladá `parentProcessId` do DB
  - Karta procesu zobrazuje správny nadradený proces po presunutí
  - Panel strom má tri stavy: široký / úzky / skrytý; stav sa zachováva v localStorage
- **Závislosti:** R3 (parentProcessId sa zobrazuje v karte)
- **Technické detaily:**
  - Zrušiť typ GROUP z UI (DB model možno zachovať pre spätnú kompatibilitu)
  - Upraviť `PATCH /api/processes/:id` na aktualizáciu `parentId` pri drag-and-drop
  - Responzívny panel: min-width 220px, max-width 400px, resizable + toggle tlačidlo

---

### R3: Karta procesu — rozšírený formulár a detailná stránka
- **Priorita:** P1 — Kritická
- **Kde:** Platforma (`/app/processes/:id`)
- **Popis:** Primárne sa po kliknutí na proces otvorí karta s popisom a dokumentáciou (nie BPMN diagram). Diagram je skrytý a zobrazí sa na kliknutie. Formulár procesu sa rozširuje o: nadradený proces (selektor), podriadené procesy (read-only zoznam), súvisiace procesy (multi-select), priradené pracovné pozície (multi-select z R1). Každý proces má vlastnú URL `/app/processes/:id`.
- **Akceptačné kritériá:**
  - Otvorenie procesu zobrazí kartu (popis, metadata) — diagram je zbalený
  - Tlačidlo „Zobraziť diagram" rozbalí BPMN panel
  - Formulár obsahuje fieldy: nadradený proces, súvisiace procesy, pracovné pozície
  - URL `/app/processes/:id` je funkčná a otvorí správny proces aj po refresh
- **Závislosti:** R1 (selektor pozícií), R2 (parentId)
- **Technické detaily:**
  - Pridať `descriptionText` (rich-text alebo textarea) do DB a formulára
  - API: rozšíriť response `GET /api/processes/:id` o `relatedProcesses` a `positions`
  - Routa `/app/processes/:id` cez Angular Router s lazy-load

---

### R4: ISO normy v Backoffice — upload PDF a generovanie štruktúry
- **Priorita:** P2 — Dôležitá
- **Kde:** Backoffice (`/backoffice/iso`), API, Databáza
- **Popis:** Operátor platformy môže v backoffice nahrať ISO normu (PDF alebo manuálny vstup). Systém spracuje PDF a vygeneruje hierarchickú štruktúru kapitol/bodov normy uloženú do DB (tabuľka `IsoTemplate`). Vygenerovaná štruktúra je editovateľná v Backoffice.
- **Akceptačné kritériá:**
  - V Backoffice existuje sekcia ISO normy s možnosťou uploadu PDF
  - Po nahraní systém extrahuje kapitoly a body (aspoň úrovne 1 a 2)
  - Štruktúra je uložená v DB a zobrazená v editovateľnej tabuľke
  - Norma má názov, verziu a jazyk
- **Závislosti:** Vyžaduje knižnicu na extrakciu textu z PDF (napr. `pdf-parse`) na backende
- **Technické detaily:**
  - DB: rozšíriť `IsoTemplate` o `{ name, version, language, sourcePdfUrl, structure: JSON }`
  - API: `POST /api/backoffice/iso` (multipart upload), `GET/PATCH/DELETE /api/backoffice/iso/:id`
  - Backoffice UI: upload formulár + stromový editor štruktúry

---

### R5: Auto-detekcia ISO normy a bodu z procesov
- **Priorita:** P2 — Dôležitá
- **Kde:** API, Platforma
- **Popis:** Systém analyzuje názov, popis a metadáta procesu a navrhne, ku ktorej ISO norme a ktorému bodu by proces patril. Detekcia prebehne automaticky pri uložení procesu alebo na vyžiadanie (tlačidlo „Detekovať ISO"). Výsledok je sugesciya — používateľ ju môže potvrdiť alebo zmeniť.
- **Akceptačné kritériá:**
  - Pri uložení procesu API vráti pole navrhnutých ISO väzieb (`isoSuggestions`)
  - Používateľ vidí sugescie v karte procesu a môže ich prijať jedným kliknutím
  - Potvrdené väzby sa uložia do DB
- **Závislosti:** R4 (ISO štruktúra musí byť v DB)
- **Technické detaily:**
  - Jednoduchý keyword-matching ako MVP; neskôr možno nahradiť LLM klasifikátorom
  - API: `POST /api/processes/:id/iso-detect` → vracia `[{ isoTemplateId, clauseId, confidence }]`

---

### R6: Zobrazenie procesov podľa ISO štruktúry
- **Priorita:** P2 — Dôležitá
- **Kde:** Platforma (`/app/processes`)
- **Popis:** Používateľ môže prepnúť procesný strom na zobrazenie podľa ISO normy (toggle v hornej lište). V ISO mode sú procesy zoskupené pod kapitolami normy. Procesy bez ISO väzby sú sivé a označené ako „Nepriradené". Kliknutím na sivý proces sa otvorí jeho karta kde sa dá doplniť ISO väzba.
- **Akceptačné kritériá:**
  - Toggle „ISO view" v procesnom strome je viditeľný ak existuje aspoň jedna ISO norma v DB
  - V ISO mode sú kapitoly normy nadradzené procesy, reálne procesy sú listové uzly
  - Procesy bez väzby sú zobrazené sivou farbou
  - Prepnutie späť obnoví štandardný strom
- **Závislosti:** R4, R5

---

### R7: Audit log zmien procesov + verzie + detailná stránka
- **Priorita:** P1 — Kritická
- **Kde:** Platforma, API, Databáza
- **Popis:** Každá zmena procesu (úprava formulára, BPMN, stav, priradenie pozícií) sa zaznamená do audit logu s dátumom, ID používateľa a popisom zmeny. V karte procesu je záložka „História" kde sú všetky zmeny zoradené od najnovšej. Kliknutím na revíziu sa zobrazí jej obsah (BPMN, metadáta v čase revízie). Pridáva sa aj pole „Popis zmeny".
- **Akceptačné kritériá:**
  - Každé `PATCH /api/processes/:id` zapíše záznam do `ProcessChangeLog`
  - Záznam obsahuje: `userId`, `timestamp`, `changedFields` (JSON diff), `description`
  - `GET /api/processes/:id/history` vracia zoradený zoznam zmien
  - UI zobrazuje históriu v záložke a umožňuje otvoriť historickú verziu (read-only BPMN viewer)
  - Formulár procesu má textové pole „Popis zmeny" (nepovinné)
- **Závislosti:** R3 (detailná stránka procesu)
- **Technické detaily:**
  - DB: nová tabuľka `ProcessChangeLog { id, processId, userId, timestamp, changedFields: JSON, description }`
  - API: `GET /api/processes/:id/history`
  - UI: tabbed layout v karte procesu — Popis | BPMN | História

---

### R8: Automatický preklad do druhého jazyka
- **Priorita:** P2 — Dôležitá
- **Kde:** Platforma, API, Nastavenia organizácie
- **Popis:** V nastaveniach organizácie sa dá zapnúť automatický preklad obsahu procesov do druhého jazyka (napr. SK → EN). Preklad sa volá cez konfigurovateľnú prekladovú API (DeepL alebo Google Translate — API kľúč sa ukladá v nastaveniach org). Preložené polia (názov, popis procesu) sú uložené v DB vedľa originálneho jazyka.
- **Akceptačné kritériá:**
  - V `/app/settings/integrations` existuje sekcia pre nastavenie prekladu (jazyk cieľ, API kľúč, provider)
  - Po zapnutí sa pri uložení procesu automaticky preloží názov a popis
  - Preložené hodnoty sú uložené v DB
  - Používateľ vidí prekladanú verziu pri prepnutí jazyka
- **Závislosti:** R3 (popis procesu musí byť v DB)
- **Technické detaily:**
  - Konfigurovateľný provider: DeepL (preferovaný) alebo Google Translate
  - API kľúč sa ukladá zašifrovaný v DB (organizačné nastavenia)
  - API: `POST /api/organizations/:id/settings/translation`

---

### R9: Backoffice login formulár
- **Priorita:** P1 — Kritická
- **Kde:** Backoffice (port 4300), API
- **Popis:** Backoffice bude chránený prihlasovacím formulárom. Prvé konto (admin) sa vytvorí seedom — username: `jano`, heslo: `Test123` (zmena po prvom prihlásení sa odporúča). Ďalšie kontá vytvára len prihlásený admin. Session backoffice admina je oddelená od session platformy.
- **Akceptačné kritériá:**
  - Neprihlásený používateľ je presmerovaný na `/login` v rámci backoffice
  - Správne prihlasovacie údaje vydajú JWT platný pre `/api/backoffice/*` endpointy
  - Neplatný token vracia `401`
  - Logout je dostupný v hlavičke
- **Závislosti:** Súvisí s R10 — po implementácii R9 môže byť backoffice sekcia z platformy odstránená
- **Technické detaily:**
  - DB: nová tabuľka `BackofficeAdmin { id, username, passwordHash, createdAt }`
  - API: `POST /api/backoffice/auth/login`, `POST /api/backoffice/auth/logout`
  - Middleware: overenie backoffice JWT na všetkých `/api/backoffice/*` routách
  - Seed: `npm run db:seed` vytvorí admina `jano` / `Test123`

---

### R10: Odstránenie Backoffice sekcie z platformy (4200)
- **Priorita:** P2 — Dôležitá
- **Kde:** Platforma (`/app/backoffice`)
- **Popis:** Tab a routa `/app/backoffice` budú odstránené zo štandardnej používateľskej aplikácie na porte 4200. Správa prekladov a systémového setupu bude dostupná výhradne cez Backoffice na porte 4300.
- **Akceptačné kritériá:**
  - V menu platformy (4200) neexistuje odkaz na backoffice
  - Priamy prístup na `/app/backoffice` vracia 404 alebo redirect na `/app/processes`
  - Všetky funkcie sú zachované na 4300
- **Závislosti:** R9 (backoffice musí mať login pred odstránením z platformy)

---

### R11: Validácia registračného formulára voči DB
- **Priorita:** P1 — Kritická
- **Kde:** Platforma (`/register`), API
- **Popis:** Registračný formulár overuje jedinečnosť emailu a názvu firmy v reálnom čase (debounced request) aj pri odoslaní. Backend vracia prehľadné chybové hlášky. Rovnaká kontrola sa aplikuje pri pozývaní používateľov (email už existuje v organizácii).
- **Akceptačné kritériá:**
  - Pri zadávaní emailu sa po 500ms odoberie `GET /api/check/email?value=...` a zobrazí „Email už existuje" ak je obsadený
  - Rovnako pre názov firmy
  - `POST /api/register` s duplicitným emailom vracia `409` s prehľadnou hláškou
  - Formulár nedá odoslať kým sú validačné chyby
- **Závislosti:** —
- **Technické detaily:**
  - API: `GET /api/check/email?value=`, `GET /api/check/org-name?value=`
  - Frontend: `ReactiveForm` validators s `asyncValidators` volajúcimi check endpointy
  - Rovnaká logika pre pozvánky: kontrola či email už je člen org

---

## Súhrn — rozsah zmien v DB a API

| Vrstva | Nové / zmenené |
|--------|---------------|
| **DB — nové tabuľky** | `OrgPosition`, `UserPosition`, `ProcessChangeLog`, `BackofficeAdmin`; rozšírenie `IsoTemplate` |
| **DB — zmeny** | `ProcessNode`: + `descriptionText`, `isoSuggestions`, prekladové polia |
| **API — nové endpointy** | `/api/organizations/:id/positions`, `/api/users/:id/positions`, `/api/processes/:id/history`, `/api/processes/:id/iso-detect`, `/api/backoffice/iso`, `/api/backoffice/auth/*`, `/api/check/*` |
| **API — zmeny** | `PATCH /api/processes/:id`: zápis do audit logu, spustenie prekladu, aktualizácia parentId |
| **Platforma — nové stránky** | `/app/settings/positions`, `/app/processes/:id` (detail), `/app/settings/integrations` |
| **Platforma — zmeny** | Procesný strom: drag-and-drop, resize panel; Karta procesu: tabbed layout + História; `/app/backoffice`: odstrániť |
| **Backoffice — nové** | Sekcia ISO normy (upload + editor), Login formulár, správa adminov |

---

*Processbase — interný dokument | Aktualizované: 10. júna 2026*
