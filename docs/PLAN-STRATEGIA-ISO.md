# Process Base — analýza stavu a plán implementácie podľa stratégie ISO 2026

Vstup: `Process_Base_implementacna_strategia_ISO_2026.md` (v1.1, 29. 9. 2026).
Stav repozitára: commit `16ab752`, lokálny Docker. Súvisí s [AUDIT.md](AUDIT.md) (bezpečnosť, etapy 1–5)
a [DEPLOYMENT.md](DEPLOYMENT.md).

Stavy: **overené** = funguje a má test alebo overenie behom · **čiastočné** · **iba UI** =
obrazovka/tvrdenie bez reálnej funkcie · **chýba** · **nemožno overiť** = chýba prístup/infraštruktúra.

---

## 1. Zhrnutie

Bezpečná základňa je hotová a otestovaná: izolácia firiem, relácie, oprávnenia podľa rolí,
súkromné prílohy s kvótou, organizačný modul s časovým obsadením a backoffice bez obsahu
zákazníka. Chýba všetko, na čom stojí nová stratégia: **verzia procesu ako nemenný snapshot,
štruktúrované kroky, publikovanie a schvaľovanie, „Moja práca", vyhľadávanie, bezplatný
modeler bez účtu, import a ISO profil**.

Procesy dnes sú jeden meniteľný záznam (`ProcessNode`) s voľne nastaviteľným stavom
(`DRAFT/IN_REVIEW/APPROVED/ARCHIVED` bez akéhokoľvek toku) a s „revíziami", ktoré ukladajú len
BPMN XML. Proces sa dá označiť ako schválený bez schválenia a čitateľ vidí vždy rozpracovaný stav.

**Odporúčané poradie:** `FREE-01` (malý, oddelený, obchodne dôležitý, nulové riziko pre dáta) →
`CORE-01` verzovanie a publikovanie (jadro všetkého ďalšieho) → `LINK-01` → `UX-01` Moja práca →
`GOV-01` schvaľovanie. ISO vrstva až po licencovanom texte normy a odbornej revízii.

---

## 2. Stav voči dokumentu

### 2.1 Základ (etapa 0)

| Oblasť dokumentu | Stav | Dôkaz |
|---|---|---|
| AUD-01 audit | **overené** | `docs/AUDIT.md`, nálezy B1–B7 s behom proti pôvodnému kódu |
| SEC-01 izolácia firiem | **overené** | `scripts/tenant-isolation-test.mjs` 35/35 (priame ID, podstrčené ID vo väzbách, osoby, obsadenia, profily) |
| SEC-01 autentifikácia, relácie | **overené** | `server/index.ts` `resolveSession`; odhlásenie, limit pokusov, obnova hesla (`account-flows-test` 19/19) |
| SEC-01 roly a oprávnenia | **overené** | `scripts/permissions-test.mjs` 25/25 (pôvodný kód 9/25), fail-closed pravidlá |
| SEC-01 súbory | **overené** | `server/file-storage.ts`, `file-storage-test` 17/17; antivírus **chýba** (#11, odložené) |
| SEC-01 logy bez obsahu | **čiastočné** | 500 bez textu chyby, incidenty bez obsahu; `console.error(error)` v logu servera môže obsahovať detaily Prisma chýb |
| SEC-01 vyhľadávanie, export, AI | **chýba** (nie je čo chrániť) | žiadny index, export ani AI — pravidlá treba zaviesť spolu s nimi |
| Backoffice bez obsahu zákazníka | **overené** | `backoffice-test` 19/19 hľadá názvy procesov/osôb/dokumentov v odpovediach |
| Stabilné ID objektov | **overené** | UUID; ID procesu sa pri úprave nemení |
| Doménové udalosti / outbox | **čiastočné** | len `EmailOutbox` (#20); `ProcessPublished`, `ReviewDue`… chýbajú |
| Jazykové polia CZ/SK/EN | **čiastočné** | UI preklady; obsah procesu má `translations` z **automatického strojového prekladu pri uložení** — v rozpore s bodom 6.1.4 (preklad bez revízie); predvolene vypnuté |
| Účtovanie úložiska | **overené** | `storageUsage` = súčet skutočných veľkostí, kvóta pred zápisom; verzie dokumentov zatiaľ neexistujú |

### 2.2 Bezplatný BPMN modeler (FREE)

| Požiadavka | Stav | Dôkaz / poznámka |
|---|---|---|
| `bpmn-js` v aplikácii | **overené** (len po prihlásení) | `bpmn-editor.component.ts` (Modeler + Camunda properties panel), `bpmn-viewer.component.ts` |
| Verejná stránka bez účtu | **chýba** | všetko BPMN je pod `/app` (authGuard) |
| Otvoriť lokálny `.bpmn`, stiahnuť XML | **chýba** | editor ukladá len do DB cez API |
| SVG export, tlač veľkého diagramu | **chýba** | |
| Znak bpmn.io viditeľný | **overené** | v kóde nie je CSS, ktoré by skrývalo `bjs-powered-by` |
| Neoznačovať „Camunda Modeler" | **overené** | názov sa nepoužíva; landing však propaguje „Camunda 7 export/konektor" |
| Camunda 7 nasadenie | **nemožno overiť** | `POST /api/processes/:id/camunda7/deploy` existuje, lokálne nie je Camunda engine |
| Import `.bpmn` do workspace ako návrh (LINK-01) | **chýba** | |

### 2.3 Jadro procesu (CORE, DOC, ORG)

| Požiadavka | Stav | Dôkaz / poznámka |
|---|---|---|
| Procesný strom, oddelený od org stromu | **overené** | `ProcessNode.parentId`, cyklus odmietnutý (`d3775b9`) |
| Procesná karta | **čiastočné** | detail s popisom (Markdown), vzťahmi, dokumentmi, BPMN/flowchart; chýbajú záložky Prehľad/Kroky/Postup/… podľa 3.1 |
| Účel, spúšťač, výsledok, vstupy/výstupy | **čiastočné** | len `description` (účel) a voľný text; `risks` vracia API natvrdo prázdne |
| Štruktúrované kroky (`Activity`) | **chýba** | |
| Kód procesu | **chýba** | |
| Verzia ako nemenný snapshot, návrh vs. publikované | **chýba** | `ProcessRevision` = len BPMN XML; stav sa mení ľubovoľne cez PATCH |
| Účinnosť, termín revízie | **chýba** | |
| Vlastník podľa pracovného miesta | **overené** | `org-module-test` (#15): po zmene obsadenia nový človek, audit ostáva |
| RACI na úrovni kroku | **chýba** | zodpovednosti sú len na úrovni procesu (OWNER/PERFORMER) |
| Jednotky, profily, miesta, osoby, časové obsadenie | **overené** | #12–#16, `org-module-test` 38/38 |
| Historické úkony pripísané pôvodnej osobe | **čiastočné** | audit log zmien áno; schválenia a vykonanie ešte neexistujú |
| Dokumenty: súkromné, kvóta, autorizovaný download | **overené** | #8–#10 |
| Verzie dokumentov, stav, účinnosť, väzba na verziu procesu | **chýba** | príloha patrí procesu, nie verzii |
| Export dokumentov / procesov | **iba UI** | landing sľubuje „Základné exporty"; žiadny export neexistuje |

### 2.4 Portál, governance, kvalita (etapa 2–3)

| Požiadavka | Stav | Dôkaz / poznámka |
|---|---|---|
| Prehľad (na revíziu, bez vlastníka…) | **chýba** | údaje o neobsadených zodpovednostiach už API vracia (`vacantResponsibilities`) |
| Moja práca podľa obsadenia | **chýba** | prepojenie účet → osoba → miesto → proces už existuje (#13–#15) |
| Globálne vyhľadávanie | **chýba** | len filtrovanie stromu a zoznamu dokumentov v prehliadači |
| Spätná väzba / zlepšenia | **chýba** | |
| Schvaľovací tok, notifikácie | **chýba** | modely `ApprovalRequest`/`ApprovalStep` sú v schéme bez API a UI |
| ISO väzby na proces | **čiastočné** | `isoLinks`, `IsoTemplate` so štruktúrou **extrahovanou z nahratého PDF normy** v backoffice — licenčné riziko (bod 5.3); lokálne žiadna norma uložená |
| „ISO detekcia" | **čiastočné / riziko** | `computeIsoSuggestions` = zhoda slov z názvu procesu s názvami článkov, vracia `confidence`; nesmie sa prezentovať ako skóre zhody |
| Pripravenosť evidencie, dôkazy, auditný export | **chýba** | |
| Import Word/PDF/Excel | **chýba** | |
| AI | **chýba** | |
| Dopadová analýza (GRAPH) | **čiastočné** | odchod osoby vracia miesta, ktoré ostanú neobsadené; nie všeobecne |

### 2.5 Tvrdenia na webe (landing), ktoré treba upraviť

| Text | Problém |
|---|---|
| Starter 0 € „Procesy a BPMN editor, Revízie, Základné exporty" | podľa rozhodnutia je Free len modeler bez účtu; exporty neexistujú |
| Enterprise „Backoffice prístup" | backoffice je nástroj prevádzkovateľa bez prístupu k obsahu — zákazník ho nedostáva |
| „Prepojte procesy s požiadavkami ISO noriem a majte prehľad pripravený na audit" | ISO profil nie je odborne overený; formulovať ako podporu prípravy |
| „Exportujte hotové procesy a nasaďte ich rovno do Camunda 7" | funkcia nie je overená; v stratégii je Camunda samostatné rozhodnutie |
| Cenník bez limitu úložiska a editorov | stratégia: platí sa za úložisko a editorov, nie za procesy — ceny a limity určí vlastník |

---

## 3. Návrh domény a migrácií (kompatibilne so stackom)

Stack: Express 5 + Prisma 7 + PostgreSQL 16, Angular 18. Existujúce tabuľky sa **nepremenúvajú**
(`ProcessNode` ostáva trvalou identitou procesu). Nové entity dopĺňajú, nič sa nemaže bez prenosu dát.

| Konceptuálna entita | Realizácia | Etapa |
|---|---|---|
| `Process` | existujúci `ProcessNode` (+ `code`, `processKind`) = trvalé ID, strom, aktuálny návrh | CORE-01 |
| `ProcessVersion` | nová tabuľka: `processNodeId`, `revision`, `status` (DRAFT → IN_REVIEW → APPROVED → PUBLISHED → SUPERSEDED/ARCHIVED), `snapshot Json` (obsah, kroky, zodpovednosti s ID miest, BPMN XML, odkazy na verzie dokumentov), `effectiveFrom/To`, `nextReviewAt`, `changeReason`, `createdBy/reviewedBy/approvedBy/publishedBy`, časy | CORE-01 |
| `Activity` | v návrhu ako tabuľka `ProcessActivity` (poradie, názov, popis, vstupy/výstupy, rozhodnutie); v publikovanej verzii len v snapshote | CORE-01 |
| `ProcessEdge` | až pri vetvení (MODEL/QUAL); lineárny zoznam stačí | QUAL-01 |
| `ProcessResponsibility` | existujúci `ProcessPosition` + voliteľné `activityId`, rola rozšírená na RACI (`RESPONSIBLE/ACCOUNTABLE/CONSULTED/INFORMED`, OWNER = accountable procesu) | CORE-02 |
| `Document`/`DocumentVersion` | `Attachment` = verzia súboru; nová tabuľka `Document` (vlastník, stav, účinnosť), `Attachment.documentId` | DOC-02 |
| `Review/Approval` | existujúce `ApprovalRequest/ApprovalStep` naviazané na `ProcessVersion` | GOV-01 |
| `ChangeRequest/Improvement` | nová tabuľka `Improvement` (návrh, autor, proces/verzia, stav, rozhodnutie) | UX-01 / GOV-01 |
| `EvidenceRecord` | odkaz na záznam/dokument s obdobím a zdrojom; oddelený od postupu | QUAL-01 |
| `AuditEvent` | zjednotenie `ProcessChangeLog` + doménové udalosti (publikovanie, schválenie, export) | GOV-01 |
| `StandardProfile/RequirementMapping` | až s licencovaným textom; existujúce `IsoTemplate` ostáva ako „navrhované témy" | ISO-01 |

**Invarianty a ako ich zabezpečiť**

- Publikovaná verzia je nemenná → `ProcessVersion` s `PUBLISHED` sa v API nedá upraviť (409), úprava ide do návrhu.
- Účinná verzia v čase je jednoznačná → pri publikovaní sa predchádzajúcej nastaví `effectiveTo`; výber `effectiveFrom <= t < effectiveTo`; test na hranicu dňa v `APP_TIMEZONE`.
- Snapshot odkazuje na identifikovateľné verzie → v snapshote ID miest a ID príloh, meno držiteľa sa **nezapisuje** (odvodzuje sa z obsadenia v čase).
- Stav procesu sa nedá nastaviť PATCHom → `status` sa bude počítať z verzií; staré hodnoty ostanú len na čítanie.
- Migrácia existujúcich dát: každý dnešný proces dostane návrh (aktuálny obsah); nič sa automaticky nepublikuje. Dnešné `ProcessRevision` ostanú ako história BPMN.

---

## 4. Plán úloh — etapy 0 až 3

Náročnosť: **S** ≈ do 1 dňa, **M** ≈ 2–4 dni, **L** ≈ týždeň+ (jeden vývojár s testami).
Každá úloha je samostatne nasaditeľná; akceptácia = automatický test v `scripts/` + kontrola v prehliadači.

**GitHub issues:** FREE-01 #24 · FREE-02 #25 · FREE-03 #26 · CORE-01 #27 · CORE-02 #28 · CORE-03 #29 ·
CORE-04 #30 · DOC-02 #31 · SEC-01f #32 · UX-01a #33 · UX-01b #34 · UX-01c #35 · UX-01d #36 ·
GOV-01 #37 · GOV-02 #38 · LINK-01 #39 · QUAL-01 #40 · IMP-01 #41 · AI-01 #42 · GRAPH-01 #43 · ISO-01 #44
(milníky „Stratégia E1/E2/E3").

### Etapa 0 — dokončené a zvyšok

| ID | Úloha | Nár. | Stav / akceptácia |
|---|---|---|---|
| AUD-01 | Audit repozitára | — | hotové (`AUDIT.md`) |
| SEC-01a–e | Izolácia, relácie, roly, súbory, tajomstvá | — | hotové, 6 testovacích sád v CI |
| SEC-01f | Logy servera bez detailov dotazov a obsahu | S | `console.error` len typ chyby + ID požiadavky |
| SEC-01g | Spoločná autorizačná vrstva pre budúce hľadanie/export/AI | S | vzor `assertOwnedIds` + `PERMISSION_RULES`; test pri každej novej ceste |

### Etapa 1 — bezplatný modeler a prvý publikovaný proces

| ID | Úloha | Nár. | Závislosť | Migrácia | API / UI | Akceptácia |
|---|---|---|---|---|---|---|
| **FREE-01** | Verejná stránka `/bpmn-modeler`: nový diagram, otvoriť `.bpmn`/`.xml` (výber aj pretiahnutie), stiahnuť `.bpmn`, kontrola veľkosti a štruktúry, upozornenie na neuložené zmeny, lokálna záloha rozpracovaného diagramu v prehliadači | M | — | nie | bez API; odkaz z landingu | scenár 11: round-trip bez straty názvov a spojení (test `bpmn-roundtrip-test`), funguje bez účtu, znak bpmn.io viditeľný, žiadna požiadavka na server s obsahom diagramu |
| **FREE-02** | Export SVG, tlač s voľbou orientácie a delením veľkého diagramu na strany, anonymné počítanie spustení/exportov (bez obsahu, bez cookies) | M | FREE-01 | počítadlá (agregáty) | `POST /api/public/usage` (len typ udalosti) | scenár 12; SVG vektorový; veľký diagram sa neoreže |
| FREE-03 | Úprava landingu a cenníka podľa stratégie (Free = modeler; platené = úložisko + editori) | S | FREE-01 | nie | texty | kap. 2.5 — žiadne nepravdivé tvrdenia; **ceny a limity dodá vlastník** |
| **CORE-01** | Verzie procesu: návrh vs. publikovaná nemenná verzia, publikovanie s účinnosťou, čitateľ vidí účinnú verziu, história verzií | L | — | `ProcessVersion`, prenos dát | `GET /processes/:id?view=effective\|draft`, `POST /processes/:id/publish`, `GET /processes/:id/versions` | scenár 3 (bez schvaľovania — to je GOV-01); úprava publikovanej = 409; test účinnosti na hranici dňa |
| CORE-02 | Štruktúrovaný proces „Rýchly": účel, spúšťač, výsledok, kroky (poradie, popis), vlastník; minimum pre publikovanie | M | CORE-01 | `ProcessActivity`, polia | editor krokov, záložky Prehľad/Kroky/Postup | scenár 1: prvý proces bez org schémy, zrozumiteľný zoznam chýbajúcich údajov pred publikovaním |
| CORE-03 | Zodpovedná pozícia priamo v editore procesu (vytvorenie miesta na mieste), RACI na krok | M | CORE-02 | `ProcessPosition.activityId`, RACI | výber/vytvorenie miesta | scenár 2 (časť): Peter vidí proces po zmene obsadenia |
| CORE-04 | Kód procesu, jedinečný pri publikovaní | S | CORE-01 | `code` | | duplicitný kód → 409 |
| ORG-01 | Organizácia | — | — | — | — | hotové (#12–#16); doplniť archiváciu miesta s ukážkou dopadu (scenár 8) → GRAPH-01 |
| DOC-02 | Riadené dokumenty: dokument s verziami súboru, stav, účinnosť; väzba publikovanej verzie procesu na konkrétnu verziu dokumentu; kvóta zahŕňa všetky verzie | L | CORE-01 | `Document`, `Attachment.documentId` | | publikovaný odkaz vedie na platnú verziu; nahratie novej verzie nezmení v1 snapshot |

### Etapa 2 — portál, governance, import

| ID | Úloha | Nár. | Závislosť | Akceptácia |
|---|---|---|---|---|
| **UX-01a** | Moja práca: procesy podľa mojich platných obsadení (zdroj zodpovednosti), moje schválenia, dokumenty | M | CORE-01, ORG-01 | scenár 2 celý (Jana → Peter k dátumu) |
| UX-01b | Prehľad: na revíziu, bez vlastníka, neobsadené, dokument po účinnosti — každá karta vedie na nápravu | M | CORE-01 | čísla sa zhodujú s filtrovanými zoznamami |
| UX-01c | Globálne vyhľadávanie v PostgreSQL (full-text), rozlíšenie publikované/návrh/archív, rovnaké oprávnenia ako API | M | CORE-01, SEC-01g | scenár 7 pre hľadanie |
| UX-01d | Nahlásenie chyby/návrhu zlepšenia k procesu | S | CORE-01 | čitateľ nahlási, vlastník vidí |
| **GOV-01** | Tok návrh → preskúmanie → schválenie → publikácia → revízia → archív; zamietnutie s dôvodom; termín revízie; audit udalostí | L | CORE-01 | scenár 3 celý; schválenie ostáva pripísané Jane aj po zmene obsadenia |
| GOV-02 | Notifikácie (v aplikácii; e-mail po #20) z doménových udalostí cez outbox | M | GOV-01 | `ReviewDue` pri termíne revízie |
| **LINK-01** | Import `.bpmn` z Free modelera do workspace ako návrh s pôvodným XML; pred vytvorením riadeného procesu vyžiadať názov, účel, vlastníka | M | FREE-01, CORE-01 | scenár 13 |
| QUAL-01 | Vstupy/výstupy, väzby predchádzajúci/nasledujúci, kritériá, zdroje, riziká a príležitosti (jednoduchý text), pripravenosť evidencie ako zoznam stavov | L | CORE-02 | scenáre 4, 5 — nikdy „proces je ISO certifikovaný" |
| IMP-01 | Import Word/PDF/Excel/CSV: kandidáti s citáciou zdroja, zlúčenie duplicít, potvrdenie → návrhy | L | CORE-02, #11 antivírus | scenár 6; nič sa nepublikuje |

### Etapa 3 — ISO, AI, dopady

| ID | Úloha | Nár. | Závislosť | Poznámka |
|---|---|---|---|---|
| ISO-01 | Verzovaný profil ISO 9001:2026, validovaná matica, auditný export s manifestom a checksumami | L | QUAL-01, **licencia + expert** | scenár 9; bez licencovaného textu len schopnosti z tabuľky 5.3 |
| AI-01 | Odpovede zo schváleného obsahu s citáciami; návrh procesu z textu (draft) | L | UX-01c, **rozhodnutie o poskytovateľovi** | scenár 7 pre AI |
| GRAPH-01 | Dopad zmeny miesta, systému, dokumentu; archivácia miesta s ukážkou dotknutých procesov | M | CORE-01, DOC-02 | scenár 8 |

---

## 5. Čo musí zabezpečiť vlastník (mimo kódu)

| Vstup | Potrebné pre |
|---|---|
| Legálne získaný text ISO 9001:2026 a odborník na normu (validácia mapovania) | ISO-01, texty ISO vo QUAL-01 |
| Ceny a limity plánov (GB, počet editorov), znenie cenníka | FREE-03 |
| Poskytovateľ e-mailov, doména, DNS SPF/DKIM/DMARC | #20, GOV-02 |
| Rozhodnutie o AI (poskytovateľ, retencia, región, tréning na dátach, on-premise alternatíva) | AI-01, IMP-01 |
| Právne texty (podmienky, ochrana údajov, cookies, ak pribudne analytika) | #21, FREE-02 meranie |
| Rozhodnutie, čo s „ISO normami" nahratými z PDF v backoffice (licencia) | ISO-01 |
| Pilotné firmy (5–10) a pozorované onboardingy (10) | meranie prijatia, scenár 10 |

## 6. Riziká

- **Migrácia na verzie (CORE-01)** mení význam „aktuálneho" procesu — preto prenos: dnešný obsah = návrh, nič sa nepublikuje samo; čitatelia uvidia proces až po prvom publikovaní (treba to zreteľne ukázať v UI).
- **BPMN vs. kroky**: bez pravidiel synchronizácie ostáva BPMN samostatnou reprezentáciou; žiadna „automatická konverzia" ľubovoľného BPMN na postup.
- **Strojový preklad obsahu** pri uložení je v rozpore so stratégiou — navrhujem po CORE-01 prekladať len ako návrh na revíziu.
- **ISO štruktúra z PDF v backoffice** — do rozhodnutia vlastníka nerozširovať, v UI hovoriť o „súvisiacich témach", nie o zhode.

## 7. Poradie implementácie teraz

1. **FREE-01** — verejný modeler (tento krok).
2. **CORE-01** — verzie a publikovanie, potom CORE-02 kroky.
3. **LINK-01** — prechod z Free do workspace.
4. **UX-01a** Moja práca, **GOV-01** schvaľovanie.

---

## 8. Stav implementácie

| Úloha | Commit | Overenie |
|---|---|---|
| B7 oprávnenia podľa rolí (predpoklad SEC-01) | `4365fc6` | `permissions-test` 25/25, pôvodný kód 9/25 |
| Písma bez Google Fonts (#21 inventúra) | `16ab752` | v prehliadači žiadna požiadavka na tretiu stranu |
| **FREE-01** #24 | `0a466ac` | `bpmn-roundtrip-test` 7/7 vrátane súboru stiahnutého z modelera; negatívna kontrola; odmietnutie ne-BPMN, DTD, poškodeného XML, >10 MB |
| **CORE-01** #27 | `b898db2` (API), `8e90ca3` (UI) | `process-versions-test` 25/25; v prehliadači publikovanie v1, návrh so zmenami, prepínač návrh/platná verzia, schvaľovateľ vidí predvolene platnú verziu |
| **CORE-02** #28 | `f43d968` | `quick-process-test` 15/15 — scenár 1 aj celý cez rozhranie: proces bez org. schémy, 3 kroky, miesto Účtovník vytvorené pri procese, zoznam chýbajúcich údajov, publikovanie |
| **LINK-01** #39 | `9467fcf` | `bpmn-import-test` 17/17 — scenár 13: návrh s pôvodným XML bajt po bajte, bez krokov sa nepublikuje; v prehliadači neprihlásený návštevník → prihlásenie → návrat s diagramom → návrh procesu |
| **UX-01a** #33 | `76ffaa0` | `my-work-test` 10/10 — scenár 2: Jana do D, Peter od D+1; k D+2 vidí proces Peter, Jana len ako vedúca; zlúčené role z viacerých miest so zdrojom; revízia do 30 dní / po termíne |
| **GOV-01** #37 | `9cb151c` | `approval-test` 26/26 — scenár 3 celý: firma zapne povinné schvaľovanie, editor odošle návrh (priame publikovanie 409), schvaľuje sa obsah zmrazený pri odoslaní, vlastnú žiadosť ani ISO auditor neschváli, zamietnutie len s dôvodom, stiahnutie; rozhodnutie ostáva pripísané Jane s miestom aj po jej odchode z miesta. V prehliadači: Eva odošle → Jana v „Moja práca" → posúdenie → schválenie → v1 platí do D−1, v2 naplánovaná, história so schválením |
| **CORE-04** #30 | `d779923` | `process-code-test` 22/22 — kód normalizovaný na veľké písmená, jedinečný vo firme pri uložení (409, aj pri súbehu cez index) a pri publikovaní/schválení voči platným a naplánovaným verziám iných procesov; verzia nahradená v ten istý deň neblokuje; iná firma má vlastné kódy; procesy bez kódu majú nezmenený odtlačok. V prehliadači: kód v strome, hľadanie podľa kódu, chyba obsadeného kódu priamo vo formulári |
| **SEC-01f** #32 | `cb3b938` | `log-hygiene-test` 11/11 — negatívna kontrola: pred opravou log obsahoval z chyby Prismy názov a popis procesu a mená procesov zo 4xx; po oprave celý beh 14 sád zanechá v logu jediný riadok (druh chyby, miesto v kóde, ID požiadavky). ID požiadavky v hlavičke, v odpovedi 500, v chybovej hláške klienta a v incidentoch backoffice; CI kontroluje `api.log` |
| **CORE-03** #29 | `f90b288` | `step-raci-test` 24/24 — RACI na kroku k pracovnému miestu, osoba len ako označená výnimka (CHECK v DB: práve jedno); najviac jedno A; cudzie miesto/osoba 404; starší klient bez `raci` zodpovednosti nezmaže; zmena RACI v histórii čitateľne; RACI je súčasť verzie; scenár 2: k D+3 ukáže verzia pri kroku Petra namiesto Jany; „Moja práca" aj pre zodpovednosť len za krok. V prehliadači: pridanie R/A/C, neobsadené A zvýraznené, externista „(osoba)"; nové miesto priamo pri kroku aj pri vykonávateľoch |
| **UX-01b** #34 | `388d343` | `overview-test` 18/18 — každý z 8 procesov má práve jeden problém a objaví sa práve v jeho karte (revízia do 30 dní / po termíne k D+40, čaká na schválenie, bez vlastníka, neobsadené miesto vlastníka aj kroku s číslom a rolou, neúplné, bez platnej verzie, nepublikované zmeny); počet = dĺžka zoznamu; bez skupín a cudzích firiem. V prehliadači: karty, zoznam s popisom a odkazom na nápravu, `?kategoria=` |
| **UX-01d** #36 | `c0d61ca` | `feedback-test` 26/26 — čitateľka bez práva upravovať nahlási chybu ku kroku platnej verzie; iná čitateľka cudzí podnet nevidí; vlastník podľa miesta (bez práva upravovať) vidí a rozhoduje, po odchode z miesta už nie (403); zamietnutie len s dôvodom; vybavený sa neotvára; autorka vidí výsledok; „Moja práca" vlastníka a karta v Prehľade. V prehliadači: Jana nahlási návrh ku kroku, vlastník firmy ho z Prehľadu prijme s odpoveďou; dátumy udalostí v miestnom čase |
| **GOV-02** #38 | `d581e45` | `notifications-test` 26/26 — outbox `DomainEvent` v transakcii so zmenou, dispečer → `Notification`: nová verzia (vlastník, vykonávatelia, RACI krokov), revízia do 30 dní / po termíne (vlastník, bez vlastníka editori; bez opakovania), žiadosť o schválenie (schvaľovatelia s odkazom na posúdenie), rozhodnutie (žiadateľ), podnet a jeho vybavenie, obsadenie miesta; nikdy autor zmeny, nikdy mimo firmy; označenie len vlastných. V prehliadači: zvonček s počtom, panel, klik otvorí proces a označí prečítané |
| **UX-01c** #35 | `83ec905` | `search-test` 17/17 — scenár 7: z inej firmy s rovnakými slovami sa nevráti proces, názov, kód, miesto ani dokument; výsledky rozlišujú platnú (v2), naplánovanú, návrh a archív (v1); bez diakritiky, podľa začiatku slova, podľa kódu (DB funkcia `pb_search_vector`), pracovné miesta, názvy dokumentov, úryvok so zhodou; špeciálne znaky nerozbijú dopyt. V prehliadači: pole v hornej lište → výsledky s filtrom Platné/Návrhy/Archív |
| **DOC-02** #31 | `DOC02_HASH` | `document-versions-test` 27/27 — akceptácia: nová verzia dokumentu nezmení snapshot v1 procesu (v1 odkazuje na v1 dokumentu, stiahnutie dá obsah v1, vie o novšej v2); návrh dostane platnú verziu a zmenu na publikovanie, naplánovaná verzia až od účinnosti; zoznam verzií so stavom a použitím vo verziách procesov; kvóta = všetky verzie; verziu v publikovanom procese nemožno zmazať; archivácia a vlastník; prenos existujúcich príloh ako v1 (ID zachované, odtlačky bez zmeny). Nadväzuje: karta Prehľadu „Dokument po účinnosti" (#34) a upozornenie `DocumentSuperseded` (#38). V prehliadači: v2 s „Verzie (2)", platná verzia procesu ukazuje v1 s upozornením na novšiu |

**Známe obmedzenia DOC-02:** dokument patrí jednému procesu (zdieľanie medzi procesmi a samostatný register
dokumentov sú na neskôr); stránka Dokumenty zatiaľ nenahráva novú verziu (len karta procesu).

**Známe obmedzenia UX-01c:** bez indexu (pre stovky procesov stačí; pri raste GIN index nad `pb_search_vector`);
odkaz na archívnu verziu otvorí proces — konkrétnu verziu treba otvoriť v Histórii.

**Známe obmedzenia GOV-02:** len v aplikácii — e-mail z tých istých udalostí po výbere poskytovateľa (#20);
`DocumentSuperseded` príde s DOC-02 (#31); nové upozornenia sa načítajú raz za minútu (bez push kanála).

**Známe obmedzenia UX-01b:** karta „dokument po účinnosti" (platná verzia odkazuje na nahradený dokument) pribudla s DOC-02.
Prehľad počíta obsadenie k zvolenému dňu, stav publikovania k dnešku.

**Známe obmedzenia CORE-01:** strom procesov zobrazuje názov návrhu aj čitateľom (obsah detailu je
z platnej verzie); naplánovanú verziu nemožno zrušiť ani nahradiť skoršou; bez zapnutého schvaľovania
publikuje každý s oprávnením `process:write`; samostatná rola „čitateľ" zatiaľ nie je.

**Známe obmedzenia GOV-01:** jednokrokové schvaľovanie (rozhoduje ktokoľvek s `approval:approve`,
okrem žiadateľa) — viac krokov a schvaľovateľ určený miestom zatiaľ nie; o novej žiadosti sa
schvaľovateľ dozvie len v „Moja práca" (upozornenia sú GOV-02 #38); archív a jednotný audit udalostí
ostávajú na GOV-02 / QUAL-01.
