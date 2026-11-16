# Backup manual database E-QA di Windows. Jalankan dari folder utama (yang berisi docker-compose.yml):
#   powershell -ExecutionPolicy Bypass -File scripts\backup.ps1
$ErrorActionPreference = 'Stop'
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
New-Item -ItemType Directory -Force -Path backups | Out-Null
docker compose exec -T db pg_dump -U eqa -d eqa --no-owner -f /tmp/backup.sql
docker compose cp db:/tmp/backup.sql "backups\eqa-$ts.sql"
Write-Host "Backup tersimpan: backups\eqa-$ts.sql"
