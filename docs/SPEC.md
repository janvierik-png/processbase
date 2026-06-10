# Processbase — vstupný dokument

> **Účel:** Tento dokument popisuje aktuálny stav implementácie a slúži ako podklad pre ďalší vývoj.
> Nové požiadavky dopisuj do sekcie **„Plánované požiadavky"** na konci — pri každej uveď prioritu,
> popis a akceptačné kritériá. Claude tento dokument spracuje a implementuje po celkoch.

Posledná aktualizácia: 2026-06-10

---

## 1. Architektúra

| Aplikácia | Adresár | Technológia | Port | Účel |
|-----------|---------|-------------|------|------|
| **Platforma** | `process-platform-angular/` | Angular 18 + Express 5 (TypeScript) | 4200 (FE) / 3000 (API) | Hlavná aplikácia pre firmy |
| **Backoffice** | `process-platform-backoffice/` | Angular 18 | 4300 | Admin aplikácia prevádzkovateľa platformy |
| Databáza | Docker | PostgreSQL 16 + Prisma 7 | 5432 | Zdieľaná oboma aplikáciami |
| *(archív)* Prototyp | `process-platform/` | Vite + Express + SQLite | 5173/3000 | Pôvodný MVP, už sa nerozvíja |
| *(archív)* Legacy | koreňový adresár | PHP + MySQL | — | Pôvodný systém, už sa nerozvíja |

- Backoffice nemá vlastný backend — volá API platformy cez endpointy `/api/backoffice/*` (dev proxy `/api` → port 3000)
- Prisma klient sa generuje do `process-platform-angular/generated/` (nie je v gite)
- GitHub: https://github.com/janvierik-png/processbase

### Spustenie (vývoj)

```powershell
# 1. PostgreSQL (vyžaduje Docker Desktop)
cd F:\Projekty\procesy\process-platform-angular
docker compose up -d postgres

# 2. Platforma — API + Angular naraz
npm.cmd run dev          # → http://localhost:4200, API http://localhost:3000

# 3. Backoffice (voliteľné, v ďalšom termináli)
cd F:\Projekty\procesy\process-platform-backoffice
npm.cmd run dev          # → http://localhost:4300

# Po zmene prisma/schema.prisma:
npm.cmd run db:generate
npm.cmd run db:migrate
```

---

## 2. Implementované — Platforma (4200)

### 2.1 Landing page a autentifikácia
- Verejná úvodná stránka s popisom produktu a cenovými plánmi (Starter / Business / Enterprise — len vizuál, bez fakturácie)
- **Registrácia firmy**: názov firmy + meno ownera + email + heslo → vytvorí `User` (heslo hashované scrypt), `Organization` a owner väzbu v PostgreSQL, auto-login
- **Login**: email + heslo, overenie proti DB, chybové hlášky
- **Prijatie pozvánky**: URL `/?invite=TOKEN` zobrazí formulár (meno + heslo) → vytvorí používateľa, pridá ho do organizácie, auto-login
- Session sa drží v localStorage (`ngCurrentUser`, `ngCurrentOrganization`) — refresh neodhlási
- Route guard: `/app/*` vyžaduje prihlásenie

### 2.2 Procesy (`/app/processes`)
- Stromová štruktúra procesov a skupín (vytváranie, premenovanie, mazanie)
- **BPMN editor** (bpmn-js) s Camunda 7 properties panelom
- Nový proces vzniká s prázdnym BPMN XML
- Popis procesu, riziká, ISO väzby, stavy (Návrh / Na schválenie / Schválené / Archív)
- **Revízie**: uloženie pomenovanej verzie s BPMN XML do DB (zoznam revízií sa ukladá; UI na otvorenie historickej revízie zatiaľ chýba — viď known issues)
- Prílohy k procesu (upload, mazanie)
- Camunda 7 deploy cez backend (`POST /api/processes/:id/camunda7/deploy`), história deploymentov v DB
- Optimistic updates — zmeny sa prejavia okamžite lokálne a synchronizujú do DB

### 2.3 Dokumenty (`/app/documents`)
- Prehľad všetkých príloh organizácie, mazanie

### 2.4 Nastavenia firmy (`/app/settings`)
- Zmena názvu spoločnosti (ukladá sa do DB)
- **Pozvánky**: email + rola → vytvorí pozvánku s tokenom (platnosť 14 dní), tlačidlo „Kopírovať link"
- Zoznam používateľov organizácie (z DB) a stav pozvánok (pending / accepted / expired)
- Prehľad rolí a ich oprávnení (statický)

### 2.5 Setup / Backoffice tab (`/app/backoffice`)
- Správa prekladov (zapisuje do DB cez backoffice API)
- Integrácie a system setup — zatiaľ len vizuálne panely

### 2.6 Jazyky
- Prepínač SK / EN v hlavičke
- Preklady sa načítavajú z DB (`GET /api/translations`), fallback na vstavané defaulty + localStorage cache

---

## 3. Implementované — Backoffice (4300)

- **Dashboard**: počty organizácií, používateľov, procesov a prekladov
- **Organizácie**: tabuľka všetkých registrovaných firiem (slug, jazyk, počty používateľov a procesov, dátum vzniku)
- **Preklady**: CRUD globálnych prekladov platformy (SK/EN), import predvolených prekladov, editácia kliknutím
- **Integrácie**: prehľad Camunda 7 konfigurácie a dokumentového úložiska (zatiaľ read-only)
- Bez prihlásenia — určené len pre lokálny vývoj (viď known issues)

---

## 4. API endpointy (Express, port 3000)

### Auth a organizácie
| Metóda | Endpoint | Popis |
|--------|----------|-------|
| POST | `/api/register` | Registrácia firmy + ownera |
| POST | `/api/login` | Prihlásenie |
| PATCH | `/api/organizations/:id` | Zmena názvu organizácie |
| GET | `/api/organizations/:id/users` | Členovia organizácie |
| GET | `/api/organizations/:id/invitations` | Pozvánky organizácie |
| POST | `/api/organizations/:id/invitations` | Vytvorenie pozvánky |
| GET | `/api/invitations/:token` | Detail pozvánky (pre accept formulár) |
| POST | `/api/invitations/:token/accept` | Prijatie pozvánky |

### Procesy
| Metóda | Endpoint | Popis |
|--------|----------|-------|
| GET | `/api/organizations/:id/processes` | Strom procesov |
| POST | `/api/organizations/:id/processes` | Nový proces / skupina |
| PATCH | `/api/processes/:id` | Úprava procesu (vrátane BPMN XML) |
| DELETE | `/api/processes/:id` | Vymazanie |
| POST | `/api/processes/:id/revisions` | Uloženie revízie |
| GET/POST | `/api/processes/:id/documents` | Prílohy procesu |
| GET | `/api/organizations/:id/documents` | Všetky prílohy organizácie |
| DELETE | `/api/documents/:id` | Vymazanie prílohy |
| POST | `/api/processes/:id/camunda7/deploy` | Deploy do Camunda 7 |

### Preklady a backoffice
| Metóda | Endpoint | Popis |
|--------|----------|-------|
| GET | `/api/translations` | Globálny slovník pre platformu |
| GET | `/api/backoffice/stats` | Štatistiky platformy |
| GET | `/api/backoffice/organizations` | Všetky organizácie |
| GET/PUT/DELETE | `/api/backoffice/translations` | CRUD prekladov |
| POST | `/api/backoffice/translations/import` | Bulk import prekladov |

---

## 5. Databázový model (Prisma)

`Organization` → `OrganizationUser` (rola, isOwner) → `User`
`ProcessNode` (strom cez parentId, typ GROUP/PROCESS, BPMN XML, ISO väzby, stav)
`ProcessRevision` (verzie BPMN + SVG), `Attachment`, `Invitation` (token, expirácia, stav)
`ApprovalRequest`/`ApprovalStep`, `IsoTemplate`, `Translation` (globálne aj per-organizácia), `CamundaDeployment`

Mapovanie rolí frontend ↔ DB: owner→OWNER, admin→ADMIN, quality→MANAGER, approver→MODELER, iso→AUDITOR

---

## 6. Známe obmedzenia / technický dlh

1. **API nemá autorizáciu** — žiadne session/JWT tokeny; endpointy dôverujú klientovi (ktokoľvek môže volať API s cudzím org ID). Pred produkciou nutné.
2. **Backoffice nemá login** — ktokoľvek s URL má plný admin prístup.
3. Pozvánkové emaily sa **neposielajú** — owner musí link skopírovať a poslať manuálne.
4. Schvaľovací workflow (`ApprovalRequest`/`ApprovalStep`) má DB model, ale **nemá UI ani API**.
5. ISO šablóny (`IsoTemplate`) majú DB model, ale nepoužívajú sa.
6. PDF/DOCX export procesnej dokumentácie existuje len v starom prototype, v Angular verzii **chýba**.
7. Prílohy sa ukladajú ako dataURL v DB (stĺpec `storagePath`) — pre väčšie súbory nevhodné.
8. Per-organizácia preklady (model to podporuje) sa zatiaľ nepoužívajú — všetky preklady sú globálne.
9. Camunda 7 integrácia je otestovaná len na úrovni API, vyžaduje bežiacu Camundu na porte 8080.
10. Žiadne automatizované testy.
11. UI na **otvorenie historickej revízie** a drag-and-drop presúvanie v strome existovali v starom prototype, v Angular verzii zatiaľ chýbajú.

---

## 7. Plánované požiadavky

> **Sem dopisuj nové požiadavky.** Formát pre každú:
>
> ### P1: Názov funkcie
> - **Priorita:** P1 (kritická) / P2 (dôležitá) / P3 (nice-to-have)
> - **Kde:** platforma / backoffice / API
> - **Popis:** čo má funkcia robiť, pre koho (rola)
> - **Akceptačné kritériá:** ako overíme, že je hotová
> - **Závislosti:** (ak závisí od inej požiadavky)

### P?: (príklad — vymaž a nahraď vlastnými)
- **Priorita:** P2
- **Kde:** platforma
- **Popis:** Owner môže deaktivovať používateľa organizácie.
- **Akceptačné kritériá:** Deaktivovaný používateľ sa nevie prihlásiť; v zozname je označený ako neaktívny.
- **Závislosti:** —
