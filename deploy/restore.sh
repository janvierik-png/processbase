#!/bin/sh
# Obnova zo zalohy — PREPISE aktualnu databazu aj /data.
#   sh deploy/restore.sh backups/20260929-120000
# Postup obnovy si vyskusajte vopred na testovacom serveri (docs/DEPLOYMENT.md).
set -eu

DIR="${1:?Zadajte adresar zalohy, napr. backups/20260929-120000}"
COMPOSE="docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env"

test -s "$DIR/database.dump" || { echo "Chyba $DIR/database.dump"; exit 1; }
test -s "$DIR/data.tar.gz" || { echo "Chyba $DIR/data.tar.gz"; exit 1; }

printf 'Obnova z %s PREPISE aktualne data. Pokracovat? Napiste ANO: ' "$DIR"
read -r answer
[ "$answer" = "ANO" ] || { echo "Zrusene."; exit 1; }

$COMPOSE stop app
$COMPOSE exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < "$DIR/database.dump"
$COMPOSE run --rm --no-deps -T app sh -c 'find /data -mindepth 1 -delete && tar -C /data -xzf -' < "$DIR/data.tar.gz"
$COMPOSE start app

echo "Obnova hotova. Skontrolujte prihlasenie, jeden proces a stiahnutie jednej prilohy."
