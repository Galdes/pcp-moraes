#!/usr/bin/env bash
# pg_dump de todos os clientes em ~/backups/<cliente>/ (mantém 14 dias) e,
# se houver um remote do rclone configurado, envia para fora da VPS.
# Remote padrão: gdrive:pcp-backups (Google Drive). Para trocar (ex.: Backblaze B2):
#   export BACKUP_REMOTE=b2:nome-do-bucket/pcp-backups
set -euo pipefail
REMOTE="${BACKUP_REMOTE:-gdrive:pcp-backups}"
for dir in "$HOME"/clientes/*/; do
  nome="$(basename "$dir")"
  mkdir -p "$HOME/backups/$nome"
  arq="$HOME/backups/$nome/$nome-$(date +%Y%m%d-%H%M).dump"
  docker compose -p "$nome" -f "$dir/docker-compose.yml" --project-directory "$dir" exec -T db pg_dump -U pcp -Fc pcp > "$arq"
  find "$HOME/backups/$nome" -name '*.dump' -mtime +14 -delete
done

if command -v rclone >/dev/null 2>&1 && rclone listremotes | grep -qx "${REMOTE%%:*}:"; then
  rclone copy "$HOME/backups" "$REMOTE" --include "*.dump" --transfers 2
  rclone delete "$REMOTE" --min-age 14d --include "*.dump"
  echo "$(date '+%F %T') enviado para $REMOTE"
else
  echo "$(date '+%F %T') AVISO: remote ${REMOTE%%:*} do rclone não configurado; backup só local"
fi
