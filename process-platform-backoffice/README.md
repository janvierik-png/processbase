# Processbase Backoffice

Samostatna admin aplikacia pre platformu Processbase. Bezi oddelene od hlavnej aplikacie (`process-platform-angular`) a komunikuje s jej Express API a PostgreSQL databazou.

## Spustenie

Predpoklad: bezi API platformy (port 3000) a PostgreSQL (Docker).

```powershell
cd F:\Projekty\procesy\process-platform-backoffice
npm install
npm.cmd run dev
```

Backoffice bezi na:

```text
http://localhost:4300
```

Dev server proxuje `/api` na `http://127.0.0.1:3000` (viz `proxy.conf.json`), takze netreba riesit CORS ani konfigurovat URL.

## Funkcie

- **Dashboard** - pocty organizacii, pouzivatelov, procesov a prekladov
- **Organizacie** - prehlad registrovanych firiem s poctami pouzivatelov a procesov
- **Preklady** - sprava globalnych prekladov platformy, ulozene v PostgreSQL (model `Translation`), import predvolenych prekladov
- **Integracie** - prehlad Camunda 7 a dokumentoveho uloziska

## Backend endpointy

Backoffice pouziva endpointy v `process-platform-angular/server/index.ts`:

- `GET /api/backoffice/stats`
- `GET /api/backoffice/organizations`
- `GET /api/backoffice/translations?locale=sk`
- `PUT /api/backoffice/translations` - upsert `{ locale, key, value }`
- `POST /api/backoffice/translations/import` - bulk import `{ items: [...] }`
- `DELETE /api/backoffice/translations/:id`

Preklady sa ukladaju globalne (`organizationId = null`).

## Dalsie kroky

1. Autentifikacia admin pouzivatelov (zatial bez loginu).
2. Prepojit hlavnu aplikaciu, aby citala preklady z DB namiesto localStorage.
3. Sprava organizacii (deaktivacia, limity, fakturacia).
4. Editovatelna Camunda konfiguracia per organizacia.
