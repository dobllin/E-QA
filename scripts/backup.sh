#!/usr/bin/env bash
# Backup database E-QA (Docker). Jalankan dari folder utama proyek:  ./scripts/backup.sh
# Jadwalkan harian dengan cron, contoh (jam 02:00):  0 2 * * * cd /path/ke/e-qa && ./scripts/backup.sh
set -euo pipefail
mkdir -p backups
FILE="backups/eqa-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T db pg_dump -U eqa -d eqa --no-owner | gzip > "$FILE"
echo "Backup tersimpan: $FILE ($(du -h "$FILE" | cut -f1))"
# Simpan salinan di tempat LAIN (flashdisk / cloud), jangan hanya di server yang sama.
# Hapus backup yang lebih dari 30 hari:
find backups -name 'eqa-*.sql.gz' -mtime +30 -delete
