#!/bin/sh
# Zaloha produkcie: databaza (pg_dump) + zväzok /data (prilohy, tajomstva).
# Spustat na hoste z korena repozitara:  sh deploy/backup.sh
# Obsahuje data zakaznikov a tajomstva — zalohy drzte sifrovane a mimo servera.
set -eu

COMPOSE="docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env"
STAMP=$(date +%Y%m%d-%H%M%S)
DIR="${BACKUP_DIR:-backups}/$STAMP"

umask 077
mkdir -p "$DIR"

$COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$DIR/database.dump"
$COMPOSE exec -T app tar -C /data -czf - . > "$DIR/data.tar.gz"

# kontrola, ze zaloha nie je prazdna a da sa precitat
test -s "$DIR/database.dump"
tar -tzf "$DIR/data.tar.gz" > /dev/null

echo "Zaloha hotova: $DIR"
ls -l "$DIR"
