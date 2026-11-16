#!/usr/bin/env bash
# Pulihkan database dari file backup.  Pemakaian:  ./scripts/restore.sh backups/eqa-XXXX.sql.gz
# PERINGATAN: ini MENGGANTI seluruh isi database saat ini.
set -euo pipefail
FILE="${1:?Berikan nama file backup, contoh: ./scripts/restore.sh backups/eqa-20261109-020000.sql.gz}"
read -r -p "Semua data sekarang akan DIGANTI dengan isi $FILE. Ketik YA untuk lanjut: " ans
[ "$ans" = "YA" ] || { echo "Dibatalkan."; exit 1; }
docker compose stop api web
docker compose exec -T db psql -U eqa -d postgres -c "DROP DATABASE IF EXISTS eqa;" -c "CREATE DATABASE eqa OWNER eqa;"
gunzip -c "$FILE" | docker compose exec -T db psql -U eqa -d eqa -v ON_ERROR_STOP=1 -q
docker compose start api web
echo "Selesai. Database dipulihkan dari $FILE"
