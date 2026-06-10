# Procesna kniznica pre male firmy

MVP aplikacia na zapisovanie a riadenie firemnych procesov: strom procesov, BPMN modeler, ISO vazby, revizie, prilohy, pouzivatelia, opravnenia, schvalovanie a export procesnej dokumentacie.

## Spustenie cez npm build

Projekt je pripraveny ako Vite/npm aplikacia. `bpmn-js` uz nie je tahany z CDN, ale z `package.json`.

```bash
cd process-platform
npm install
npm run dev
```

Produkcia:

```bash
npm run build
npm run db:init
npm run server
```

V tomto Codex prostredi nebol dostupny prikaz `npm`, preto som zavislosti nenainstaloval. Subory su vsak pripravene na standardny npm workflow.

## Spustenie cez Docker

Ak nechces riesit lokalne `npm`, pouzi Docker:

```bash
cd process-platform
docker compose up --build
```

Potom otvor:

- frontend: `http://127.0.0.1:5173`
- backend API: `http://127.0.0.1:3000/api/health`

Ak Camunda 7 bezi na host pocitaci na porte `8080`, compose pouzije:

```bash
CAMUNDA7_BASE_URL=http://host.docker.internal:8080/engine-rest
```

Ak je Camunda inde, nastav premennu pred spustenim:

```bash
$env:CAMUNDA7_BASE_URL="http://adresa-servera:8080/engine-rest"
docker compose up --build
```

## Frontend

- `index.html` - hlavna obrazovka a zakladne DOM kotvy
- `src/app.js` - UI logika, Vite importy, BPMN modeler, localStorage fallback
- `src/sample-data.js` - ukazkove procesy, pouzivatelia, role a ISO sablony
- `styles/app.css` - vizualny system

Owner-first flow:

- verejna uvodna stranka s popisom softveru, registraciou, loginom a cenovymi planmi
- prvy pouzivatel sa zaregistruje ako owner firmy
- owner pri registracii vytvori novu firmu
- existujuci pouzivatel sa vie znovu prihlasit emailom a heslom
- nova firma zacina s prazdnou procesnou kniznicou
- owner nastavi nazov spolocnosti v nastaveniach firmy
- owner ma pristupne nastavenia firmy v hornom paneli aplikacie
- owner vie v nastaveniach pozvat dalsich pouzivatelov do platformy

Funkcie vo frontende:

- registracia organizacie a prveho ownera
- sprava nazvu spolocnosti a identifikatora organizacie
- pozvanie noveho pouzivatela do organizacie cez email a rolu
- stromova struktura procesov
- `bpmn-js` modeler z lokalneho npm balika
- BPMN/Camunda 7 properties panel napojeny priamo na graficky model
- BPMN XML export
- popis procesu, rizika, ISO vazby a revizie
- schvalovacie kroky
- nastavenia firmy s prehladom pouzivatelov, roli a pozvanok v organizacii
- nova skupina v stromovej strukture
- presuvanie procesov a skupin v strome cez drag-and-drop
- skrytie laveho stromu procesov a praveho BPMN properties panelu
- mazanie procesov a skupin zo stromu
- upload priloh k jednotlivym procesom
- ulozenie pomenovanej revizie procesu s datumom, BPMN XML a obrazkom diagramu
- otvorenie ulozenej historickej revizie procesu
- HTML export procesnej dokumentacie s obrazkom procesu
- prazdny novy BPMN proces bez automaticky vlozeneho startu, ulohy alebo konca
- prepnutie jazyka SK/EN
- backoffice sprava prekladov cez zalozku Backoffice
- prehlad priloh
- PDF/DOCX export tlacidla, ktore volaju backend a pri statickom otvoreni pouziju textovy fallback

## Backend

- `server/index.js` - Express API
- `server/db/schema.sql` - SQLite schema
- `server/db/init.js` - inicializacia databazy a seed dat
- `server/repositories/*` - datove vrstvy pre procesy, ISO, pouzivatelov a schvalovanie
- `server/services/documentExportService.js` - generovanie PDF a DOCX

Hlavne API:

- `POST /api/register`
- `GET /api/organizations/:id`
- `PATCH /api/organizations/:id`
- `GET /api/organizations/:id/users`
- `GET /api/organizations/:id/invitations`
- `POST /api/organizations/:id/invitations`
- `GET /api/processes`
- `GET /api/processes/:id`
- `POST /api/processes`
- `POST /api/processes/:id/revisions`
- `POST /api/processes/:id/attachments`
- `GET /api/users`
- `GET /api/roles`
- `GET /api/iso/templates`
- `POST /api/processes/:id/iso-links`
- `POST /api/processes/:id/approvals`
- `GET /api/camunda7/config`
- `GET /api/camunda7/deployments`
- `POST /api/camunda7/deploy`
- `POST /api/camunda7/start`
- `GET /api/processes/:id/export.pdf`
- `GET /api/processes/:id/export.docx`

## Camunda 7 konektor

Projekt cieli iba na Camunda 7 REST API. Camunda 8 konektor tu zamerne nie je.

Konfiguracia cez environment premenne:

```bash
CAMUNDA7_BASE_URL=http://localhost:8080/engine-rest
CAMUNDA7_ENGINE_NAME=
CAMUNDA7_USERNAME=demo
CAMUNDA7_PASSWORD=demo
CAMUNDA7_DEPLOYMENT_SOURCE=process-platform
```

Endpointy konektora:

- `GET /api/camunda7/config` - bezpecny nahlad konfiguracie bez hesla
- `GET /api/camunda7/deployments` - posledne deploymenty
- `POST /api/camunda7/deploy` - deploy BPMN XML cez Camunda 7 `POST /deployment/create`
- `POST /api/camunda7/start` - start procesu cez `POST /process-definition/key/{key}/start`

Autentifikacia do Camundy ostava na serveri. Frontend neposiela ani neuklada Camunda heslo.

## Databazovy model

Schema pokryva:

- organizacie a clenstvo pouzivatelov v organizacii
- registraciu ownera a prvej organizacie
- pozvanky novych pouzivatelov s tokenom a rolou
- procesy so stromovou vazbou cez `parent_id`
- revizie procesu
- prilohy procesu
- pouzivatelov
- role a opravnenia
- schvalovacie workflow a kroky
- ISO sablony
- vazby procesu na ISO poziadavky

## Dalsie kroky

1. Po dostupnosti npm spustit `npm install` a `npm run build`.
2. Prepojit frontend na API namiesto localStorage fallbacku.
3. Doriesit prihlasovanie, hashovanie hesiel, prijatie pozvanky a session/JWT.
4. Doriesit produkcne prihlasovanie a opravnenia pre Camunda 7 deploy.
5. Pridat testy pre repository vrstvy a exporty.
