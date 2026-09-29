# Process Base — audit stavu aplikácie

Vypracované: 28. 9. 2026 · commit `69af831` · autor: Claude

**Stavy zistení:** `overené behom` · `potvrdené v kóde` · `čiastočné` · `nenájdené` · `neoveriteľné bez prístupu`

> **Obmedzenie tohto auditu:** Docker stack v čase auditu nebežal, preto sú zistenia
> podložené **čítaním kódu, schémy a migrácií**, nie behom aplikácie. Body označené
> `potvrdené v kóde` sú doložené konkrétnym súborom a riadkom; runtime overenie
> (najmä test izolácie firiem) je pripravené a čaká na spustenie prostredia.

---

## 1. Zhrnutie stavu

Process Base je **funkčný prototyp procesnej knižnice**, nie produkčne nasaditeľný SaaS.

**Čo aplikácia dnes reálne dokáže** (`potvrdené v kóde`, väčšina overená behom v predchádzajúcich session):
registrácia firmy, prihlásenie, pozvánky s expiráciou, strom procesov s drag-and-drop,
BPMN editor aj jednoduchý flowchart, revízie, dokumentácia v Markdowne, prílohy s
priradením pracovným pozíciám, organizačné zložky a pracovné pozície, ISO väzby s
automatickou detekciou, audit log zmien procesu, dvojjazyčné UI, backoffice s vlastným
prihlásením.

**Pre koho je použiteľná:** pre jednu dôveryhodnú firmu v uzavretom prostredí, prípadne
ako demo. **Nie je použiteľná ako viacnájomný SaaS na verejnom internete.**

### Tri najväčšie riziká

| # | Riziko | Závažnosť |
|---|---|---|
| 1 | **Platformové API nemá žiadnu autentifikáciu.** Ktokoľvek na sieti môže bez prihlásenia čítať a meniť dáta ľubovoľnej firmy. | Kritická |
| 2 | **Neexistuje izolácia firiem.** 18 endpointov pracuje s priamym identifikátorom objektu a ani jeden neoveruje, komu objekt patrí. | Kritická |
| 3 | **Žiadne testy, žiadne CI.** Každá zmena sa overuje ručne; regresia sa zistí až v prevádzke. | Vysoká |

---

## 2. Mapa architektúry

| Vrstva | Technológia | Umiestnenie |
|---|---|---|
| Platforma (frontend) | Angular 18, standalone komponenty, signals | `process-platform-angular/src/app` |
| Platforma (API) | Express 5, TypeScript, `tsx watch` | `process-platform-angular/server/index.ts` |
| Backoffice | Angular 18, samostatná aplikácia | `process-platform-backoffice/` |
| Databáza | PostgreSQL 16 + Prisma 7 | `process-platform-angular/prisma/schema.prisma` |
| Prevádzka | Docker Compose (4 kontajnery) | `process-platform-angular/docker-compose.yml` |
| Archív | Vite prototyp (PHP legacy odstránený 28. 9. 2026) | `process-platform/` |

**Tok dát:** Angular → relatívne `/api/*` → dev proxy (`proxy.conf.mjs`) → Express `:3000` → Prisma → PostgreSQL.

**Autentifikácia:**
- Platforma: **žiadna na serveri.** Klient si po prihlásení uloží používateľa a `organizationId`
  do `localStorage` (`auth.service.ts:50`) a posiela `organizationId` v URL. Server ho prijme bez overenia.
- Backoffice: HMAC-SHA256 token, 12 h platnosť, guard na `/api/backoffice/*` (`server/index.ts:1508`).

**Úložisko:** prílohy sa ukladajú ako base64 `data:` URL priamo do stĺpca `Attachment.storagePath`
v databáze. Žiadne súborové ani objektové úložisko.

**Email:** `nenájdené` — v kóde nie je žiadny SMTP klient ani odosielanie (`grep nodemailer|smtp|sendMail` = 0).
Pozvánky sa doručujú ručným skopírovaním odkazu.

**Nasadenie:** `docker compose` lokálne; produkčne `ng serve` (dev server) za doménou
`processbase.klomproject.sk`. Žiadny CI/CD (`.github/` neexistuje).

---

## 3. Matica funkcií

| Oblasť | Požadovaný stav | Aktuálny stav | Dôkaz | Medzera | Priorita |
|---|---|---|---|---|---|
| Registrácia firmy | Funkčná + overenie emailu | Registrácia funguje, **overenie emailu chýba** | `server/index.ts` register; `emailVerified` = 0 výskytov | Overenie emailu, obmedzenie pokusov | P1 |
| Prihlásenie | Bezpečné heslá, relácie | Heslá **scrypt + salt + timingSafeEqual** — v poriadku; relácia len v `localStorage` | `index.ts:701-710` | Serverová relácia, token, odhlásenie | P1 |
| Zabudnuté heslo | Reset cez token | `nenájdené` | `resetToken`, `forgot` = 0 výskytov | Celý tok | P2 |
| Pozvánky | Token, expirácia, odmietnutie neplatných | **Funguje** — 14 dní, expirácia sa kontroluje | `index.ts:936, 957, 977` | Doručenie emailom | P2 |
| 2FA pre správcov | Vyžadované | `nenájdené` | — | Celé | P3 |
| Multi-tenancy | Firma A nevidí dáta firmy B | **Neexistuje** | 18 objektových endpointov, 0 kontrol organizácie | Autentifikácia + scoping | **P0** |
| Autorizácia na objekt | Kontrola vlastníctva | **Neexistuje** | ako vyššie | — | **P0** |
| Rate limiting | Ochrana prihlásenia a API | `nenájdené` | `rate-limit` = 0 | Celé | P1 |
| Bezpečnostné hlavičky | helmet / CSP / HSTS | `nenájdené` | `helmet` = 0 | Celé | P1 |
| CSRF | Ochrana | Neaplikovateľné dnes (žiadne cookies), **stane sa relevantným** po zavedení relácií | `cors({origin:true})` `index.ts:17` | Po zavedení cookies | P1 |
| Úložisko — limity | Kvóta v GB na firmu | **Iba limit na súbor (100 MB)**, žiadna kvóta | `MAX_UPLOAD_BYTES`; `quota` = 0 | Meranie a vynucovanie GB | P1 |
| Úložisko — bezpečnosť | Privátne úložisko, antivírus | base64 v DB, **žiadny sken** | `Attachment.storagePath` | Externé úložisko, skener | P2 |
| Org jednotky | Strom bez cyklov | `OrgUnit` existuje, ale je **plochý — nemá `parentId`** | `schema.prisma` OrgUnit | Hierarchia | P1 |
| Profil práce | Znovupoužiteľný opis | `nenájdené` | — | Celá entita | P2 |
| Pracovné miesto | Pozícia + nadriadenosť | `OrgPosition` existuje, **bez nadriadenosti** | `schema.prisma` | `reportsToId` | P2 |
| Osoba (adresár) | Oddelená od účtu | **Neexistuje** — iba `User` s loginom | `schema.prisma` | Celá entita | P1 |
| Obsadenie miesta | S obdobím platnosti, história | `UserPosition` má len `assignedAt` | `schema.prisma` | `validFrom`/`validTo` | P1 |
| Zodpovednosť za proces | S rolou (vlastník/vykonávateľ) | `ProcessPosition` **bez roly** | `schema.prisma` | Pole `role` | P1 |
| Verzia popisu práce | Návrh/publikované | `nenájdené` | — | Celá entita | P3 |
| Backoffice | Agregáty bez obsahu zákazníka | Prihlásenie funguje; **vidí len počty** | `index.ts:1508+` | Spotreba GB, stav mailov | P2 |
| Cookies / súhlas | Súhlas pred marketingom | `nenájdené` | žiadny consent kód | Celé + právne texty | P3 |
| Testy / CI | Automatizované | **Žiadne** | `.github/` neexistuje, 0 spec súborov | Celé | P1 |
| On-premise | Inštalačný balík | Docker Compose existuje ako základ | `docker-compose.yml` | Konfigurácia, licencie, upgrade | P3 |

---

## 4. Bezpečnosť a súkromie

### B1 — Platformové API bez autentifikácie · **Kritická** · `potvrdené v kóde`

Z 57 endpointov v `server/index.ts` má guard iba vetva `/api/backoffice/*` (riadok 1508).
Všetkých ostatných ~50 endpointov je verejných. Jediná zmienka o identite používateľa je
hlavička `x-user-id` na riadku 342, ktorá sa používa len na zápis autora do audit logu —
a je plne pod kontrolou klienta.

**Dopad:** ktokoľvek s dostupnosťou na API môže bez prihlásenia čítať a meniť procesy,
dokumenty, pozície a nastavenia ľubovoľnej firmy, vrátane zápisu falošného autora do auditu.
Keďže aplikácia beží na verejnej doméne, ide o bezprostredné riziko.

**Oprava:** serverová relácia (token), `requireAuth` middleware nad `/api/*` s výnimkou
verejných tokov, odvodenie `organizationId` z relácie namiesto URL.

### B2 — Žiadna izolácia firiem · **Kritická** · `overené behom`

> **Výsledok testu z 28. 9. 2026** (`process-platform-angular/scripts/tenant-isolation-test.mjs`,
> lokálny Docker): **0 z 8 kontrol prešlo.** Anonymný volajúci bez akéhokoľvek prihlásenia
> prečítal procesy, dokumenty, pozície aj používateľov cudzej firmy — a `PATCH`-om jej
> **prepísal názov procesu**. Nejde teda len o čítanie, ale aj o zápis.


18 endpointov prijíma priamy identifikátor objektu (`/api/processes/:id`,
`/api/documents/:id`, `/api/positions/:id`, `/api/units/:id`). Ani jeden neoveruje, do
ktorej organizácie objekt patrí — dotazy sú `findUnique({ where: { id } })` bez podmienky
na organizáciu.

**Dopad:** aj po zavedení prihlásenia by prihlásený používateľ firmy A mohol uhádnutím či
získaním UUID čítať a mazať objekty firmy B.

**Oprava:** každý objektový dotaz rozšíriť o `organizationId` z relácie; pri nezhode vrátiť 404
(nie 403 — neprezrádzať existenciu).

### B3 — Šifrovací kľúč s verejne známou zálohou · **Vysoká** · `potvrdené v kóde`

`SETTINGS_ENCRYPTION_KEY` nie je v `docker-compose.yml` nastavený, preto sa použije
fallback `'dev-settings-encryption-key'` (`index.ts:1240`) — hodnota je v zdrojáku na GitHube.
Ním sa šifrujú API kľúče prekladača.

**Dopad:** ktokoľvek s prístupom k databáze a repozitáru dešifruje uložené kľúče.
**Pozor pri oprave:** po zmene premennej sa staré kľúče už nedajú dešifrovať a treba ich zadať znova.

### B4 — Chýbajúce prevádzkové ochrany · **Stredná** · `potvrdené v kóde`

Bez `helmet` (bezpečnostné hlavičky), bez rate limitingu (prihlásenie sa dá skúšať neobmedzene),
`cors({ origin: true })` odráža ľubovoľný pôvod (`index.ts:17`).

### B5 — Prílohy bez skenovania a bez oddeleného úložiska · **Stredná** · `potvrdené v kóde`

Súbory do 100 MB sa ukladajú ako base64 do databázy. Žiadny antivírusový sken, žiadne
oddelené privátne úložisko. Pri sťahovaní sa `Content-Type` preberá z hodnoty, ktorú
poslal klient pri nahratí.

### B6 — Backoffice: verejné tajomstvo tokenov a známe heslo admina · **Kritická** · `overené behom` (lokálne)

Tokeny backoffice sa podpisovali tajomstvom so zálohou `dev-backoffice-secret-change-me` v zdrojáku.
Token podpísaný touto hodnotou lokálne prešiel na `/api/backoffice/admins` (200) — kto pozná
repozitár, získa plný prístup do backoffice vrátane zakladania adminov. Seed navyše pri každom
štarte API zakladal admina `jano` s heslom zo zdrojáku a login backoffice nemal limit pokusov.
Na produkcii to **nebolo overované** (bez súhlasu sa na produkčný systém nesiaha); ak tam
`BACKOFFICE_JWT_SECRET` nie je nastavené, platí to isté.

**Oprava (#19):** tajomstvá bez záložných hodnôt (premenná prostredia alebo náhodne vygenerované
do `storage/secrets.json`), seed zakladá admina len ak žiadny neexistuje a bez hesla v kóde,
zmena vlastného hesla v backoffice, limit pokusov aj pre backoffice a pozvánky.

### B7 — Roly vo firme sa na serveri nekontrolovali · **Kritická** · `overené behom`

Klient zobrazoval maticu rolí (`src/app/core/data/default-data.ts`), ale API ju nevynucovalo.
Test `scripts/permissions-test.mjs` proti pôvodnému kódu: **9/25** — schvaľovateľ (rola len na
čítanie) proces zmazal (204), pozval nového **vlastníka** (201), zmenil API kľúč prekladu a videl
tokeny všetkých pozvánok (mohol tak prijať pozvánku určenú pre admina). Admin mohol cez pozvánku
vytvoriť účet vlastníka.

**Oprava:** pravidlá oprávnení nad všetkými zapisujúcimi volaniami (fail-closed — nový endpoint
bez pravidla sa odmietne), rola sa číta z členstva pri každej požiadavke, rolu vlastníka prideľuje
len vlastník, zoznam pozvánok len s oprávnením pozývať. UI skrýva nedostupné akcie. Test 25/25.

### Realistické tvrdenie o prístupe prevádzkovateľa

> **Prevádzkovateľ má dnes technicky plný prístup k obsahu procesov aj k osobným údajom.**

Obsah je v databáze v čitateľnej podobe, prílohy tiež (base64 nie je šifrovanie). Šifrovaný
je jediný údaj — API kľúč prekladača — a to kľúčom, ktorý je verejne známy (B3).
Zálohy, logy ani podpora nie sú nijako oddelené.

**Produkt preto nesmie sľubovať, že prevádzkovateľ nevidí obsah.** Ak má byť také tvrdenie
pravdivé, vyžaduje šifrovanie na strane klienta a správu kľúčov mimo prevádzkovateľa — to je
zásadná architektonická zmena, nie doplnok.

---

## 5. Čo viem implementovať

| Úloha | Výstup | Závislosti | Zložitosť | Riziko migrácie | Stav |
|---|---|---|---|---|---|
| Serverové relácie + `requireAuth` | Token, middleware, odhlásenie | — | M | žiadne (len nové stĺpce) | **teraz** |
| Izolácia firiem na všetkých endpointoch | `organizationId` z relácie, scoping dotazov | relácie | L | žiadne | **teraz** |
| Testy izolácie A↔B | Skript s reprodukovateľným výsledkom | relácie | S | žiadne | **teraz** |
| Rate limiting + helmet | Middleware | — | S | žiadne | **teraz** |
| Šifrovací kľúč do env | Zmena compose + dokumentácia | — | S | staré kľúče treba zadať znova | **teraz** |
| Meranie úložiska na firmu | Stĺpec + prepočet + vynucovanie kvóty | — | M | prepočet existujúcich príloh | **teraz** |
| Org strom (`parentId`) + role zodpovednosti | Migrácia + API + UI | — | M | žiadne | **teraz** |
| Entita Osoba + obsadenie s obdobím | Migrácia + API + UI | org strom | L | prevod `UserPosition` | **teraz** |
| Overenie emailu, reset hesla | Tokeny + šablóny | **SMTP poskytovateľ, doména, DNS** | M | žiadne | po dodaní vstupu |
| Antivírusový sken príloh | Integrácia skenera | externá služba | M | žiadne | po dodaní vstupu |
| Cookies a súhlasy | Banner + evidencia | **právne texty** | M | žiadne | po dodaní vstupu |
| Produkčné nasadenie (TLS, proxy, zálohy) | Reprodukovateľný postup | **prístup na server** | L | — | po dodaní vstupu |
| On-premise balík | Inštalátor, licencie | pilotný zákazník | L | — | neskôr |

**Kroky vlastníka služby (nedajú sa spraviť v kóde):** SMTP poskytovateľ + SPF/DKIM/DMARC,
právne texty (GDPR, podmienky, cookies), platobná brána, prístupy na produkčný server,
rozhodnutie o cenových pásmach v GB.

---

## 6. Plán prvej etapy

**Rozsah:** *Autentifikácia a izolácia firiem.* Rieši obe kritické riziká; všetko ostatné
(kvóty, org modul, backoffice metriky) na nej stojí a bez nej nemá zmysel.

| # | Úloha | Akceptačné kritérium |
|---|---|---|
| 1 | Tabuľka relácií + vydanie tokenu pri prihlásení/registrácii | Prihlásenie vráti token; token má expiráciu |
| 2 | `requireAuth` nad `/api/*`, výnimky: register, login, prijatie pozvánky | Volanie bez tokenu vráti 401 |
| 3 | `organizationId` sa berie **z relácie**, nie z URL | Podvrhnutie cudzieho `organizationId` v URL neprejde |
| 4 | Scoping všetkých 18 objektových endpointov | Prístup k cudziemu objektu vráti 404 |
| 5 | Odhlásenie a zneplatnenie relácie | Po odhlásení token nefunguje |
| 6 | Rate limiting na prihlásenie + helmet | Opakované zlyhané prihlásenie sa zablokuje |
| 7 | Overovací skript izolácie | Firma A nedostane ani jeden objekt firmy B |

**Plán overenia:** skript založí dve firmy so syntetickými údajmi a pre každý objektový
endpoint skúsi krížový prístup. Očakávaný výsledok: 401 bez tokenu, 404 s cudzím tokenom.
Výstup skriptu sa priloží ako dôkaz.

**Čo v tejto etape zámerne nie je:** overenie emailu (chýba SMTP), 2FA, kvóty, org modul.

---

## 7. Vykonané zmeny

Každá zmena je overená na lokálnom Dockeri a naviazaná na GitHub issue (`Fixes #N` v commite).
**Na produkciu (Hetzner) sa nenasadzuje priebežne** — až po kompletnej revízii.

| Etapa | Commit | Issues | Overenie |
|---|---|---|---|
| 1 — Autentifikácia a izolácia firiem | `b9c170f` | #1–#6 | test izolácie 15/15 (pred opravou 0/8), odhlásenie zneplatní token, 429 po 10 pokusoch o prihlásenie |
| 2 — Meranie a kvóta úložiska | `edbebeb` | #8, #9 | nahratie nad kvótu → 413 bez zápisu; spotreba = súčet skutočných veľkostí |
| 2 — Oprava sťahovania po Etape 1 | `edbebeb` | — | `<a href>`/`<iframe>` neposielali token (401) → sťahovanie cez HttpClient + blob URL |
| 2 — Súborové úložisko príloh | `aa44f2f` | #10 | `scripts/file-storage-test.mjs` 17/17, prerušený upload nezanechá súbor ani záznam |
| — Odkazované ID z cudzej firmy | `d3775b9` | #2 | firma A si mohla pripojiť proces/pozíciu/zložku firmy B a API vrátilo jej názov; pôvodný kód 17/26, oprava 26/26 |
| — Autor zmeny z relácie | `d3775b9` | B1 | audit log bral autora z hlavičky `x-user-id` od klienta |
| 3 — Strom zložiek, nadriadenosť miest | `d3775b9`, `71ba516` | #12 | cyklus → 400, po zmazaní zložky sa podriadené posunú vyššie |
| 3 — Osoby, obsadenie s platnosťou, vlastník podľa miesta | `48391f0`, `71ba516` | #13, #14, #15 | `scripts/org-module-test.mjs` 38/38 — akceptačný scenár „vlastník podľa miesta, po zmene obsadenia nový človek, audit ostáva" overený |
| — Pozvánka na existujúci účet | `48391f0` | B1 | prijatie pozvánky nevyžadovalo heslo existujúceho účtu (pôvodný kód: 200); po Etape 1 navyše nevracala token |
| 3 — Profil práce a verzie popisu | `71ba516` | #16 | návrh → publikovaná (nemenná), platná/plánovaná podľa dátumu účinnosti |
| 5 — Tajomstvá bez záložných hodnôt v kóde | `821b449` | #19, B3, B6 | podvrhnutý backoffice token: 200 → 401; kľúč zašifrovaný starým verejným kľúčom sa pri štarte presifruje (starý ho už nedešifruje) |
| 4 — Backoffice: spotreba plánu, stav služby, audit zásahov | `2626058` | #17, #18 | `scripts/backoffice-test.mjs` 19/19 — agregáty bez obsahu zákazníka (test hľadá názvy procesu/osoby/dokumentu v odpovediach), zmena plánu a prihlásenia v audite, bez hesiel |
| 5 — CI na GitHube | `b1e3afa` | #22 | prvý beh [úspešný](https://github.com/janvierik-png/processbase/actions/runs/36497855629): typy, produkčný build, testy API proti PostgreSQL 16, build backoffice |
| 5 — Overenie e-mailu a obnova hesla (bez doručovania) | `af3ae76` | #20 | `scripts/account-flows-test.mjs` 19/19 — jednorazové a expirujúce odkazy, obnova odhlási všade, odpoveď neprezradí existenciu účtu |
| 5 — Produkčné nasadenie (pripravené, nenasadené) | `f18430e` | #23 (posúdenie) | `deploy/` + [DEPLOYMENT.md](DEPLOYMENT.md); lokálne overené: SPA z API, `/api/backoffice` na verejnom porte 404, backoffice na vlastnom porte; obraz stavia a testuje CI |
| — Oprávnenia podľa roly | *(commit B7)* | B7 | `scripts/permissions-test.mjs` 25/25 (pôvodný kód 9/25) |

**Stav nálezov:** B7 — opravené. B1, B2 — opravené (Etapa 1, doplnené o odkazované ID, autora zmien a pozvánky). B4 — hlavičky a rate limit doplnené, `cors`
zostáva otvorený (rieši sa pri produkčných nastaveniach). B5 — oddelené úložisko hotové,
inline zobrazenie len pre PDF; antivírus (#11) zatiaľ odložený rozhodnutím zadávateľa.
B3, B6 — opravené (#19).

**Prevádzkové dôsledky #10:**
- Súbory ležia v `UPLOAD_DIR` (predvolene `process-platform-angular/storage/uploads`, v `.gitignore`).
  **Záloha databázy už neobsahuje obsah príloh — zálohovať treba aj tento adresár.**
- Staršie prílohy (base64 v DB) sa čítajú ďalej. Presun: `scripts/migrate-attachments-to-files.ts`
  (bez `--apply` len vypíše, `--org <id>` obmedzí na jednu firmu). Lokálne overené na syntetickom
  zázname; existujúce dokumenty neboli presunuté.
- Mazanie firmy (zatiaľ len ručne v DB) nezmaže jej adresár `UPLOAD_DIR/<organizationId>`.


**Pred nasadením na produkciu (po revízii):**
1. Zálohovať databázu. Nastaviť `SETTINGS_ENCRYPTION_KEY` a `BACKOFFICE_JWT_SECRET` (min. 32 znakov),
   alebo nechať vygenerovať — potom zálohovať `storage/secrets.json`.
2. **Zmeniť heslo backoffice admina `jano`**, ak ho na produkcii vytvoril starý seed (heslo je verejne v gite).
3. Po nasadení sa odhlásia všetci používatelia aj backoffice admini (nové relácie/tajomstvo).
4. Migrácie: `prisma migrate deploy`; prílohy z DB presunúť `scripts/migrate-attachments-to-files.ts`
   (najprv suchý beh), potom zálohovať aj `storage/uploads`.
5. Ak je pred API reverzná proxy, overiť `TRUST_PROXY` (IP klienta pre limit prihlásení).
**Etapa 3 — poznámky:**
- Každý člen firmy má osobu v adresári (migrácia ich doplní aj existujúcim členom); osoby bez účtu
  sa nepočítajú ako používatelia. Migrácia prenesie `UserPosition` na obsadenia od dátumu priradenia
  a až potom tabuľku zmaže — overené na syntetickom priradení.
- „Dnes" pre obsadenia a účinnosť popisov sa určuje v časovom pásme firmy (`APP_TIMEZONE`,
  predvolene `Europe/Bratislava`), nie v UTC servera.
- Posledný deň obsadenia je vrátane — kto odchádza k dnešku, miesto ešte dnes zastáva.
- Známe obmedzenie: Prisma 7 s `@prisma/adapter-pg` pri zápise s `include` posiela v transakcii
  paralelné dotazy → `pg` hlási DeprecationWarning (prestane fungovať v `pg@9`). Nie je to v našom
  kóde; rieši sa aktualizáciou Prismy pred prechodom na `pg@9`.

**Etapa 4 — poznámky:**
- Operátor vidí na firmu: počet používateľov s prihlásením (platení), osôb len v adresári,
  procesov, dokumentov, spotrebu a kapacitu úložiska, poslednú aktivitu. Nevidí názvy procesov,
  dokumentov ani mená ľudí. Kapacitu môže zmeniť — zásah ide do auditu so starou a novou hodnotou.
- Stav služby: dostupnosť a veľkosť DB, súbory na disku vs. prílohy ešte v DB, požiadavky a 5xx od
  štartu, posledných 20 incidentov (metóda, routa, stav, typ chyby — bez obsahu). E-maily: nenakonfigurované (#20).
- Odpoveď 500 už neposiela klientovi text chyby (mohol prezradiť štruktúru DB); detail je len v logu servera.
- Metriky sú v pamäti procesu (od posledného štartu); audit je v DB (`BackofficeAuditLog`).

**Etapa 5 — e-maily (#20), stav:** tokeny (hash v DB, 48 h overenie / 1 h obnova, jednorazové,
novší odkaz zneplatní starší), stránky `/overenie-emailu`, `/zabudnute-heslo`, `/obnova-hesla`,
upozornenie na neoverený e-mail v aplikácii, heslo min. 10 znakov. **Chýba doručovanie:**
e-maily čakajú vo fronte `EmailOutbox` (backoffice ukazuje počet). Na dokončenie treba vybrať
poskytovateľa (SMTP/API), odosielaciu doménu a DNS (SPF, DKIM, DMARC); potom
`REQUIRE_EMAIL_VERIFICATION=true`. Existujúcim používateľom migrácia nastavila e-mail ako overený.

### Poznámky k rozporom medzi zadaním a skutočnosťou

- Zadanie predpokladá, že môže existovať tvrdenie „prevádzkovateľ nevidí procesy". V tejto
  architektúre **neplatí** a bez klientskeho šifrovania platiť nebude.
- Zadanie uvádza úložisko ako hlavný kapacitný parameter. V čase auditu sa **nemeralo vôbec**
  a prílohy boli base64 v databáze (1 GB príloh = 1,33 GB v DB). Od #8/#10 sa meria skutočná
  veľkosť súboru a nové prílohy idú na disk.
- Zadanie žiada, aby zamestnanci v adresári neboli platení používatelia. V čase auditu **neexistovala
  entita Osoba** — každý človek bol `User` s prihlásením. Od #13 je osoba oddelená od účtu.
