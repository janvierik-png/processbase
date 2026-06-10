# Processbase Angular struktura

Toto je Angular-ready verzia aplikacie vytvorena vedla aktualneho Vite prototypu v `process-platform`.

## Spustenie

```powershell
cd F:\Projekty\procesy\process-platform-angular
npm install
npm.cmd run dev
```

## Databaza PostgreSQL + Prisma

Databazovy zaklad je pripraveny v:

```text
prisma/schema.prisma
prisma/seed.ts
.env
.env.example
```

PostgreSQL v Dockeri:

```powershell
cd F:\Projekty\procesy\process-platform-angular
docker compose up -d postgres
```

Vytvorenie tabuliek a Prisma klienta:

```powershell
npm.cmd run db:generate
npm.cmd run db:migrate
```

Seed demo dat:

```powershell
npm.cmd run db:seed
```

Otvorenie databazy cez Prisma Studio:

```powershell
npm.cmd run db:studio
```

Alebo cela Angular appka cez Docker:

```powershell
cd F:\Projekty\procesy\process-platform-angular
docker compose up --build
```

API bezi na:

```text
http://localhost:3000/api/health
```

Angular bezi na:

```text
http://localhost:4200
```

## Camunda 7 deploy

Deploy ide cez backend endpoint:

```text
POST /api/processes/:processId/camunda7/deploy
```

Konfiguracia je v `.env`:

```text
CAMUNDA7_BASE_URL="http://localhost:8080/engine-rest"
CAMUNDA7_USERNAME=""
CAMUNDA7_PASSWORD=""
```

V Dockeri je predvoleny Camunda endpoint:

```text
http://host.docker.internal:8080/engine-rest
```

Pri deployi sa BPMN XML najprv uklada k procesu v PostgreSQL a nasledne sa vytvori zaznam v `CamundaDeployment`.

URL:

```text
http://localhost:4200
```

## Struktura

```text
src/app
  core
    data
    guards
    models
    services
  features
    landing
    workspace
    processes
      components
    settings
    backoffice
```

## Mapovanie funkcionalit

- `features/landing` - uvodna stranka, registracia firmy, login
- `features/workspace` - layout prihlasenej organizacie
- `features/processes` - strom procesov, detail procesu, BPMN editor
- `features/processes/components/bpmn-editor` - wrapper okolo `bpmn-js` a Camunda properties panelu
- `features/settings` - nazov firmy, pouzivatelia, roly, pozvanky
- `features/backoffice` - sprava prekladov
- `core/services/auth.service.ts` - owner registracia, login, logout
- `core/services/process-store.service.ts` - procesny strom a aktivny proces
- `core/services/translation.service.ts` - SK/EN preklady a backoffice upravy
- `core/services/camunda7.service.ts` - pripraveny klient na backend Camunda 7 endpointy

## Datovy model

- `Organization` - firma/tenant
- `User`, `OrganizationUser`, `Role`, `Invitation` - owner, pouzivatelia, roly, pozvanky
- `ProcessNode` - strom skupin a procesov
- `ProcessRevision` - ulozene BPMN verzie procesu
- `Attachment` - subory k procesom
- `ApprovalRequest`, `ApprovalStep` - schvalovanie
- `IsoTemplate` - ISO sablony a vazby
- `Translation` - SK/EN a buduce preklady cez backoffice
- `CamundaDeployment` - historia deployov do Camunda 7

## Dalsi migracny krok

Aktualne je to Angular kostra s localStorage store rovnako ako prototyp. Dalsi krok je prepojit Angular services na existujuci Express backend v `process-platform/server`:

- auth API a hashovanie hesiel
- organizacie a pozvanky
- procesy/revizie/prilohy
- export PDF/DOCX/HTML
- Camunda 7 deploy
