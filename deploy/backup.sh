#!/usr/bin/env bash
# =====================================================================
#  Backup harian: database (pg_dump format custom) + seluruh lampiran.
#
#    crontab -e
#    15 1 * * * /opt/imr/deploy/backup.sh >> /var/log/imr-backup.log 2>&1
#
#  Disimpan di deploy/backups/, dirotasi setelah KEEP_DAYS hari. Backup di
#  disk yang sama dengan database bukan backup: salin folder itu ke luar
#  VPS (rclone ke Google Drive/S3, atau snapshot dari penyedia VPS).
#
#  Pulihkan:
#    docker compose exec -T db pg_restore -U postgres -d imr --clean --if-exists < backups/imr-<tanggal>.dump
#    docker run --rm -v imr_berkas:/data -v "$PWD/backups":/b alpine tar -xzf /b/berkas-<tanggal>.tar.gz -C /data
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")"

KEEP_DAYS=${KEEP_DAYS:-14}
stamp=$(date +%Y%m%d-%H%M)
mkdir -p backups

docker compose exec -T db pg_dump -U postgres -d imr -Fc > "backups/imr-$stamp.dump.part"
mv "backups/imr-$stamp.dump.part" "backups/imr-$stamp.dump"

docker run --rm -v imr_berkas:/data:ro -v "$PWD/backups":/b alpine \
  tar -czf "/b/berkas-$stamp.tar.gz" -C /data .

find backups -name 'imr-*.dump' -mtime +"$KEEP_DAYS" -delete
find backups -name 'berkas-*.tar.gz' -mtime +"$KEEP_DAYS" -delete

echo "$(date -Is) backup ok: imr-$stamp.dump ($(du -h "backups/imr-$stamp.dump" | cut -f1))"
