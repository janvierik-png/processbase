# PROCESSBASE
## Vstupný dokument — technická špecifikácia

> **Účel:** Tento dokument popisuje aktuálny stav implementácie a slúži ako podklad pre ďalší vývoj. Nové požiadavky zapisuj do sekcie 7 s prioritou, popisom a akceptačnými kritériami.

Posledná aktualizácia: 11. júna 2026 — **implementované R1–R11 zo SPEC v2.1**

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
# 1. PostgreSQL (vyžaduje bežiaci Docker Desktop!)
cd F:\Projekty\procesy\process-platform-angular
docker compose up -d postgres

# 2. Platforma — API + Angular naraz
npm.cmd run dev          # → http://localhost:4200, API http://localhost:3000

# 3. Backoffice
cd ..\process-platform-backoffice
npm.cmd run dev          # → http://localhost:4300  (login: jano / Test123)

# Po zmene schema.prisma:
npm.cmd run db:generate
npm.cmd run db:migrate

# Seed (demo data + backoffice admin jano/Test123):
npm.cmd run db:seed
```

---

## 2. Implementované — Platforma (port 4200)

### 2.1 Landing page a autentifikácia
- Verejná úvodná stránka s cenovými plánmi (Starter / Business / Enterprise — len vizuál)
- **Registrácia firmy:** názov + meno ownera + email + heslo → `User` (scrypt hash), `Organization`, auto-login
- **R11 — realtime validácia registrácie:** debounced (500 ms) kontrola obsadenosti emailu a názvu firmy cez `/api/check/*`; submit blokovaný pri chybe; duplicitný email vracia 409
- **Login:** email + heslo, overenie DB, chybové hlásenia
- **Prijatie pozvánky:** URL `/?invite=TOKEN` → formulár → pridanie do org, auto-login; pozvanie emailu, ktorý už je členom org, vracia 409
- Session v localStorage, route guard na `/app/*`

### 2.2 Procesy (`/app/processes`, `/app/processes/:id`)
- **R2 — strom len s procesmi:** skupiny sa nezobrazujú, hierarchia cez nadradený proces; **drag-and-drop** presun (ukladá `parentId`); koreňová drop zóna; panel stromu má 3 stavy (široký 320 / úzky 220 / skrytý), stav v localStorage
- **R3 — karta procesu:** každý proces má URL `/app/processes/:id`; po otvorení sa zobrazí karta (diagram zbalený); záložky **Popis | Zobraziť diagram | História**; formulár: názov, stav, nadradený proces (selektor s ochranou pred cyklom), účel, **dokumentácia** (`descriptionText`), riziká, súvisiace procesy (multi-select), pracovné pozície (multi-select), podriadené procesy (read-only)
- **R5 — ISO sugescie:** tlačidlo „Detekovať ISO" + automatická detekcia pri zmene textov; návrhy s confidence; prijatie jedným klikom
- **R6 — ISO view:** toggle v strome (viditeľný ak existuje norma); procesy zoskupené pod kapitolami noriem; nepriradené sivé v sekcii „Nepriradené"
- **R7 — audit log:** každý PATCH zapisuje diff polí do `ProcessChangeLog` (autor cez hlavičku `x-user-id`); pole „Popis zmeny" vo formulári; záložka História zobrazuje zmeny + uložené verzie s **read-only BPMN viewerom** (NavigatedViewer)
- BPMN editor (bpmn-js) s Camunda properties panelom, revízie, prílohy, Camunda 7 deploy

### 2.3 Dokumenty (`/app/documents`)
- Prehľad všetkých príloh organizácie, mazanie

### 2.4 Nastavenia (`/app/settings`)
- Zmena názvu spoločnosti; pozvánky (email + rola, token 14 dní, kopírovanie linku); zoznam používateľov **s pracovnými pozíciami**; prehľad rolí
- **R1 — `/app/settings/positions`:** CRUD pracovných pozícií (názov + popis, unikátnosť per org), priradenie pozícií používateľom (chips s odobratím), viacnásobné priradenie
- **R8 — `/app/settings/integrations`:** nastavenia automatického prekladu — provider (DeepL/Google), cieľový jazyk, API kľúč (uložený šifrovane AES-256-GCM), zapnutie/vypnutie; pri uložení procesu sa preloží názov + dokumentácia do `translations` JSON
- **R10:** tab Setup/Backoffice odstránený; `/app/backoffice` presmeruje na procesy

### 2.5 Jazyky
- Prepínač SK / EN, preklady z DB, fallback na defaulty + localStorage cache

---

## 3. Implementované — Backoffice (port 4300)

- **R9 — login:** formulár `/login`; seed admin **jano / Test123**; HMAC-SHA256 token (12 h platnosť) v localStorage; guard presmeruje neprihláseného; interceptor pridáva Bearer a pri 401 odhlási; logout v hlavičke; **všetky `/api/backoffice/*` endpointy (okrem auth) vyžadujú token**
- **Admini:** zoznam, vytvorenie, mazanie (posledný admin sa nedá vymazať)
- **R4 — ISO normy:** upload PDF → automatická extrakcia kapitol (úrovne 1–3, pdf-parse v2) do hierarchickej štruktúry; alebo prázdna norma s manuálnym vstupom; editovateľná tabuľka bodov (číslo + názov, hierarchia z číslovania); mazanie noriem
- Dashboard (počty), Organizácie (tabuľka), Preklady (CRUD + import), Integrácie (read-only)

---

## 4. API endpointy (Express, port 3000)

### Auth, organizácie, validácie
| Metóda | Endpoint | Popis |
|--------|----------|-------|
| POST | `/api/register`, `/api/login` | Registrácia / prihlásenie |
| GET | `/api/check/email`, `/api/check/org-name` | R11 — kontrola dostupnosti (`?value=`) |
| PATCH | `/api/organizations/:id` | Zmena názvu |
| GET | `/api/organizations/:id/users` | Členovia (s pozíciami) |
| GET/POST | `/api/organizations/:id/invitations` | Pozvánky (409 pri existujúcom členovi) |
| GET / POST | `/api/invitations/:token` / `.../accept` | Detail / prijatie pozvánky |
| GET/POST | `/api/organizations/:id/settings/translation` | R8 — nastavenia prekladu |

### Pozície (R1)
| Metóda | Endpoint |
|--------|----------|
| GET/POST | `/api/organizations/:id/positions` |
| PATCH/DELETE | `/api/positions/:id` |
| POST | `/api/users/:id/positions` |
| DELETE | `/api/users/:id/positions/:positionId` |

### Procesy
| Metóda | Endpoint | Popis |
|--------|----------|-------|
| GET/POST | `/api/organizations/:id/processes` | Strom / nový proces |
| GET | `/api/processes/:id` | R3 — detail (parent, deti, súvisiace, pozície) |
| PATCH | `/api/processes/:id` | Úprava + audit log + auto-preklad + ISO sugescie |
| DELETE | `/api/processes/:id` | Vymazanie |
| GET | `/api/processes/:id/history` | R7 — história zmien |
| POST | `/api/processes/:id/iso-detect` | R5 — detekcia ISO väzieb |
| POST | `/api/processes/:id/revisions` | Revízia |
| GET/POST | `/api/processes/:id/documents` | Prílohy |
| POST | `/api/processes/:id/camunda7/deploy` | Camunda 7 |
| GET | `/api/iso-norms` | R6 — verejný zoznam noriem |
| GET | `/api/translations` | Globálny slovník |

### Backoffice (všetko okrem auth vyžaduje Bearer token — R9)
| Metóda | Endpoint | Popis |
|--------|----------|-------|
| POST | `/api/backoffice/auth/login` / `logout` | Prihlásenie admina |
| GET/POST/DELETE | `/api/backoffice/admins[/:id]` | Správa adminov |
| POST/GET | `/api/backoffice/iso` | R4 — vytvorenie (PDF/manuál) / zoznam |
| GET/PATCH/DELETE | `/api/backoffice/iso/:id` | Detail / štruktúra / mazanie |
| GET | `/api/backoffice/stats`, `/organizations` | Štatistiky, organizácie |
| GET/PUT/DELETE | `/api/backoffice/translations` | CRUD prekladov |
| POST | `/api/backoffice/translations/import` | Bulk import |

---

## 5. Databázový model (Prisma)

- `Organization` (+ nastavenia prekladu: `autoTranslate`, `translationProvider`, `translationApiKeyEnc`, `translationTargetLocale`) → `OrganizationUser` → `User`
- **`OrgPosition`** / **`UserPosition`** / **`ProcessPosition`** — R1 pracovné pozície a väzby
- `ProcessNode` + `descriptionText`, `relatedProcessIds`, `isoSuggestions` (JSON), `translations` (JSON)
- **`ProcessChangeLog`** — R7 audit (`changedFields` JSON diff, `description`, `userId`)
- **`BackofficeAdmin`** — R9 admin účty
- `IsoTemplate` + `name`, `version`, `language`, `sourcePdfUrl`, `structure` (JSON hierarchia) — R4
- `ProcessRevision`, `Attachment`, `Invitation`, `ApprovalRequest`/`ApprovalStep`, `Translation`, `CamundaDeployment`

Mapovanie rolí: owner→OWNER, admin→ADMIN, quality→MANAGER, approver→MODELER, iso→AUDITOR

---

## 6. Známe obmedzenia / technický dlh

| # | Problém | Závažnosť |
|---|---------|-----------|
| 1 | **Platformové API nemá autorizáciu** (backoffice API už áno — R9). Identifikácia autora zmien cez `x-user-id` hlavičku je dôverovaná klientovi. | **KRITICKÁ** |
| 2 | Pozvánkové emaily sa neposielajú — manuálne kopírovanie linku. | Stredná |
| 3 | Schvaľovací workflow má DB model, ale chýba UI aj API. | Stredná |
| 4 | PDF/DOCX export procesnej dokumentácie chýba v Angular verzii. | Stredná |
| 5 | Prílohy uložené ako dataURL v DB — nevhodné pre väčšie súbory. | Stredná |
| 6 | Per-org preklady UI textov sa nepoužívajú — všetky sú globálne. | Nízka |
| 7 | Camunda 7 vyžaduje bežiacu inštanciu na porte 8080. | Nízka |
| 8 | Žiadne automatizované testy. | Stredná |
| 9 | Auto-preklad (R8) vyžaduje platný API kľúč — bez neho zlyhá potichu (zámerne). | Nízka |
| 10 | Preložené verzie procesov (R8) sa ukladajú do DB, ale UI ich pri prepnutí jazyka zatiaľ nezobrazuje. | Stredná |
| 11 | ISO PDF extrakcia je regex-based — pri netypických PDF treba štruktúru doladiť manuálne v editore. | Nízka |
| 12 | Zmena hesla backoffice admina po prvom prihlásení nie je implementovaná (odporúčané v R9). | Nízka |

---

## 7. Plánované požiadavky

> Implementované požiadavky R1–R11 zo SPEC v2.1 boli presunuté do sekcií 2–5 (11. júna 2026).
>
> **Sem dopisuj nové požiadavky.** Formát:
>
> ### R12: Názov funkcie
> - **Priorita:** P1 (kritická) / P2 (dôležitá) / P3 (nice-to-have)
> - **Kde:** platforma / backoffice / API
> - **Popis:** čo má funkcia robiť, pre koho (rola)
> - **Akceptačné kritériá:** ako overíme, že je hotová
> - **Závislosti:** —

---

*Processbase — interný dokument | Aktualizované: 11. júna 2026*
