# Produkcny obraz Processbase: API + zostaveny frontend + backoffice v jednom
# procese Node. Kontext = koren repozitara:  docker build -f deploy/Dockerfile .
# Vyvojovy obraz ostava v process-platform-angular/Dockerfile (ng serve, tsx watch).

FROM node:22-bookworm-slim AS platform
WORKDIR /build
COPY process-platform-angular/package.json process-platform-angular/package-lock.json ./
RUN npm ci
COPY process-platform-angular/ ./
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim AS backoffice
WORKDIR /build
COPY process-platform-backoffice/package.json process-platform-backoffice/package-lock.json ./
RUN npm ci
COPY process-platform-backoffice/ ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    API_PORT=3000 \
    STATIC_DIR=/app/public \
    BACKOFFICE_PORT=4300 \
    BACKOFFICE_HOST=0.0.0.0 \
    BACKOFFICE_STATIC_DIR=/app/public-backoffice \
    UPLOAD_DIR=/data/uploads \
    SECRETS_FILE=/data/secrets.json

COPY --from=platform /build/node_modules ./node_modules
COPY --from=platform /build/package.json /build/prisma.config.ts ./
COPY --from=platform /build/prisma ./prisma
COPY --from=platform /build/generated ./generated
COPY --from=platform /build/server ./server
COPY --from=platform /build/scripts ./scripts
COPY --from=platform /build/dist/process-platform-angular/browser ./public
COPY --from=backoffice /build/dist/process-platform-backoffice/browser ./public-backoffice

# /data = prilohy + tajomstva (zväzok, zalohovat spolu s databazou)
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000 4300

# migracie pri starte — pred aktualizaciou vzdy zaloha (deploy/backup.sh)
CMD ["sh", "-c", "npx prisma migrate deploy && exec node --import tsx server/index.ts"]
