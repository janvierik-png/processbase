# Processbase — nasadenie, zálohy a on-premise

Tento dokument popisuje **produkčné** nasadenie. Lokálny vývoj ostáva v
`process-platform-angular/docker-compose.yml` (hot reload, `ng serve`, `tsx watch`).

> **Stav k 29. 9. 2026:** súbory v `deploy/` sú pripravené a produkčný obraz sa stavia a
> testuje v CI. Na Hetzner **zatiaľ nič nie je nasadené** — nasadenie až po dokončení
> revízie (rozhodnutie vlastníka).

## 1. Prečo nie `ng serve` na produkcii

Dnešná produkcia (`processbase.klomproject.sk`) podľa dostupných informácií beží na
vývojovom serveri Angularu (`ng serve`, preto `allowedHosts` v `angular.json`). Ten:

- nie je určený na verejný internet — vystavuje Vite dev server, ktorý mal v roku 2025
  viacero chýb s čítaním súborov mimo aplikácie (lokálne overené: verzia 5.4.21 ich má opravené,
  ale každá ďalšia by sa týkala aj produkcie),
- posiela nezminifikovaný kód so source mapami a pri každej zmene súborov prestavuje aplikáciu,
- pri `git pull` sa správa nepredvídateľne (reštart kvôli `angular.json`).

**Cieľ:** jeden proces Node (API + zostavený frontend), pred ním nginx s TLS; backoffice
na samostatnom porte dostupnom len lokálne.

```
internet ──TLS──► nginx :443 ──► app :3000  (API + SPA)
                                 app :4300  (backoffice, len 127.0.0.1 → SSH tunel/VPN)
                                   │
                        postgres (zväzok pgdata)    /data (zväzok appdata: prílohy, tajomstvá)
```

## 2. Prvé nasadenie

Predpoklady na serveri: Docker s Compose, nginx, certbot.

```sh
git clone https://github.com/janvierik-png/processbase.git && cd processbase
cp deploy/.env.example deploy/.env      # vyplniť POSTGRES_PASSWORD a tajomstvá
chmod 600 deploy/.env
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
```

- Migrácie databázy bežia automaticky pri štarte kontajnera (`prisma migrate deploy`).
- Prvý backoffice admin vznikne pri štarte, ak žiadny neexistuje (`BACKOFFICE_ADMIN_*`, inak
  dočasné heslo v `/data/initial-backoffice-password.txt` — po prihlásení zmeniť a súbor zmazať).
- nginx: `deploy/nginx.conf.example` → `/etc/nginx/sites-available/`, potom `certbot --nginx`.
- Backoffice: `ssh -L 4300:127.0.0.1:4300 používateľ@server` a otvoriť `http://localhost:4300`.
  Na verejnom porte `/api/backoffice` vracia 404.

## 3. Prechod z dnešnej inštalácie na Hetzneri

Poradie (celé v jednom okne údržby, s pripravenou zálohou):

1. **Záloha** dnešnej databázy (`pg_dump`) — bez nej nezačínať.
2. Zistiť, kde dnešná DB beží, a preniesť ju do nového `postgres` (`pg_restore`), alebo
   nasmerovať `DATABASE_URL` na existujúcu DB.
3. Spustiť nový obraz — migrácie doplnia nové tabuľky (relácie, osoby, obsadenia, audit, …).
   Prenos `UserPosition` → obsadenia a presifrovanie API kľúčov prebehne automaticky.
4. Prílohy z DB na disk: suchý beh a potom presun
   `docker compose … exec app node --import tsx scripts/migrate-attachments-to-files.ts [--apply]`.
5. **Zmeniť heslo backoffice admina `jano`**, ak ho vytvoril starý seed (heslo je verejne v gite).
6. Používatelia sa musia prihlásiť znova (nové relácie). Po overení zastaviť starý `ng serve`.

## 4. Zálohy a obnova

```sh
sh deploy/backup.sh                 # → backups/<čas>/database.dump + data.tar.gz
sh deploy/restore.sh backups/<čas>  # PREPÍŠE dáta, pýta si potvrdenie
```

- Záloha = **databáza aj `/data`** (prílohy a `secrets.json`). Samotná DB nestačí: bez
  `/data` chýbajú súbory príloh a bez `secrets.json` sa nedajú dešifrovať uložené API kľúče.
- Zálohy obsahujú dáta zákazníkov a tajomstvá — ukladať šifrovane a mimo servera, obmedziť prístup.
- Plánovanie (napr. cron denne) a **pravidelná skúška obnovy** na testovacom serveri:
  obnoviť, prihlásiť sa, otvoriť proces, stiahnuť prílohu. Neoverená záloha nie je záloha.

## 5. Aktualizácia a návrat späť

```sh
sh deploy/backup.sh
git pull
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
```

Kontrola po aktualizácii: backoffice → Dashboard → Stav služby (DB, incidenty 5xx).
Návrat: `git checkout <predchádzajúci commit>`, znova `up -d --build`; ak nová verzia zmenila
schému databázy, obnoviť aj zálohu z kroku 1 (migrácie sa automaticky nevracajú).

## 6. Monitoring

- Backoffice → Dashboard: stav DB, požiadavky a 5xx od štartu, posledné incidenty, fronta e-mailov.
- Logy: `docker compose … logs -f app` (neobsahujú telá požiadaviek ani obsah zákazníkov).
- Externý dohľad dostupnosti (napr. kontrola `GET /api/translations` každú minútu) — zatiaľ nie je.

## 7. On-premise — posúdenie (#23)

Zadanie: *„až po overení základného SaaS toku a požiadaviek pilotného zákazníka"*. Preto zatiaľ
len posúdenie, bez inštalátora.

| Oblasť | Stav | Poznámka |
|---|---|---|
| Kontajnerizácia | **pripravené** | ten istý `deploy/` obraz a compose; beží na ľubovoľnom Linuxe s Dockerom |
| Bez vendor lock-in | **áno** | PostgreSQL 16, súbory na disku, žiadne cloudové služby; e-mail bude cez štandardný SMTP |
| Konfigurácia | **áno** | všetko cez premenné prostredia (`deploy/.env.example`) |
| Databáza | **áno** | vlastná alebo zákazníkova PostgreSQL (`DATABASE_URL`) |
| Súborové úložisko | **áno** | zväzok `/data`; S3-kompatibilné úložisko by bolo treba doplniť |
| Aktualizácie | **čiastočné** | migrácie pri štarte, postup v kap. 5; chýba kontrola kompatibility verzií a automatický návrat |
| Logy | **áno** | stdout kontajnera → zákazníkov systém logov |
| Zálohy | **áno** | `deploy/backup.sh` / `restore.sh`; zodpovednosť za zálohy nesie zákazník |
| Licenčné overenie | **nie je** | treba rozhodnúť model (kľúč s dátumom platnosti podpísaný výrobcom, bez volania domov) |
| Sprievodca inštaláciou | **nie je** | dnes kap. 2 tohto dokumentu; pre zákazníka treba zjednodušiť a otestovať na čistom serveri |
| Podpora bez prístupu k dátam | **otvorené** | diagnostika len z backoffice metrík a logov; prístup k dátam len so súhlasom zákazníka |

**Zodpovednosť zákazníka pri on-premise:** server a OS, TLS certifikát, zálohy a ich skúšky,
aktualizácie v dohodnutom okne, SMTP pre e-maily. **Výrobca:** obraz, migrácie, bezpečnostné
aktualizácie, postup aktualizácie.

**Ďalšie kroky (až s pilotným zákazníkom):** licenčný kľúč, overenie inštalácie na čistom serveri,
kontrola verzie DB pred migráciou, voliteľne S3 úložisko.
