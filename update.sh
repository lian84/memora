#!/usr/bin/env bash
set -euo pipefail

# Manual update for a Memora installation created by install.sh.
# A local encrypted backup is mandatory before changing the release.
if [[ "${EUID}" -ne 0 ]]; then
  echo "L’aggiornamento richiede root. Riavvio con sudo…"
  exec sudo -E bash "$0" "$@"
fi

MEMORA_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEMORA_USER="${MEMORA_USER:-memora}"
MEMORA_CONFIG_DIR="${MEMORA_CONFIG_DIR:-/etc/memora}"
ENV_FILE="$MEMORA_CONFIG_DIR/memora.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "File ambiente non trovato: $ENV_FILE"
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
MEMORA_DATA_DIR="${MEMORA_DATA_DIR:-/var/lib/memora}"
MEMORA_PORT="${MEMORA_PORT:-3000}"
MEMORA_BACKUP_DIR="${MEMORA_BACKUP_DIR:-${MEMORA_DATA_DIR%/}/../memora-backups}"

if [[ ! -d "$MEMORA_HOME/.git" ]]; then
  echo "La directory installata non è un repository git: aggiornamento non disponibile."
  exit 1
fi

TARGET_TAG="${MEMORA_UPDATE_TAG:-}"
PREVIOUS_COMMIT="$(git -C "$MEMORA_HOME" rev-parse HEAD)"
PREVIOUS_VERSION="$(grep '^MEMORA_VERSION=' "$ENV_FILE" | cut -d= -f2- || true)"

restore_service() {
  systemctl start memora.service >/dev/null 2>&1 || true
}

rollback() {
  echo "Tentativo di rollback…"
  git -C "$MEMORA_HOME" checkout --detach "$PREVIOUS_COMMIT"
  chown -R "$MEMORA_USER:$MEMORA_USER" "$MEMORA_HOME"
  if [[ -n "$PREVIOUS_VERSION" ]]; then
    sed -i "s|^MEMORA_VERSION=.*|MEMORA_VERSION=$PREVIOUS_VERSION|" "$ENV_FILE"
  else
    sed -i '/^MEMORA_VERSION=/d' "$ENV_FILE"
  fi
  chown root:"$MEMORA_USER" "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
  runuser -u "$MEMORA_USER" -- sh -c 'cd "$1" && pnpm install --frozen-lockfile && pnpm build' sh "$MEMORA_HOME"
  restore_service
}

echo "Arresto di Memora per il backup pre-aggiornamento…"
systemctl stop memora.service

echo "Creazione backup obbligatorio…"
if ! runuser -u "$MEMORA_USER" -- env \
  MEMORA_DATA_DIR="$MEMORA_DATA_DIR" \
  MEMORA_BACKUP_DIR="$MEMORA_BACKUP_DIR" \
  node "$MEMORA_HOME/scripts/backup-now.mjs"; then
  echo "Backup fallito: aggiornamento annullato. Il servizio viene riavviato."
  restore_service
  exit 1
fi

echo "Ricerca release…"
git -C "$MEMORA_HOME" fetch --tags --force
if [[ -z "$TARGET_TAG" ]]; then
  TARGET_TAG="$(git -C "$MEMORA_HOME" tag --list 'v*' --sort=-v:refname | head -n 1)"
fi
if [[ -z "$TARGET_TAG" ]]; then
  echo "Nessuna release trovata. Aggiornamento annullato."
  restore_service
  exit 1
fi
if ! git -C "$MEMORA_HOME" rev-parse --verify "$TARGET_TAG" >/dev/null 2>&1; then
  echo "Release non trovata: $TARGET_TAG"
  restore_service
  exit 1
fi
echo "Aggiornamento a $TARGET_TAG"

if ! git -C "$MEMORA_HOME" checkout --detach "$TARGET_TAG"; then
  echo "Checkout fallito. Il servizio viene riavviato senza modifiche."
  git -C "$MEMORA_HOME" checkout --detach "$PREVIOUS_COMMIT" || true
  restore_service
  exit 1
fi

chown -R "$MEMORA_USER:$MEMORA_USER" "$MEMORA_HOME"

# Keep the running/release version aligned with the tag, without touching
# secret values already present in the environment file.
if grep -q '^MEMORA_VERSION=' "$ENV_FILE"; then
  sed -i "s|^MEMORA_VERSION=.*|MEMORA_VERSION=$TARGET_TAG|" "$ENV_FILE"
else
  printf '\nMEMORA_VERSION=%s\n' "$TARGET_TAG" >> "$ENV_FILE"
fi
chown root:"$MEMORA_USER" "$ENV_FILE"
chmod 0640 "$ENV_FILE"

if ! runuser -u "$MEMORA_USER" -- sh -c 'cd "$1" && pnpm install --frozen-lockfile && pnpm build' sh "$MEMORA_HOME"; then
  echo "Build fallita: rollback."
  rollback
  exit 1
fi

# Best-effort migration of legacy project metadata. It is idempotent.
runuser -u "$MEMORA_USER" -- sh -c 'cd "$1" && MEMORA_DATA_DIR="$2" pnpm projects:migrate --apply' sh "$MEMORA_HOME" "$MEMORA_DATA_DIR" || true

if ! systemctl start memora.service; then
  echo "Avvio fallito: rollback."
  rollback
  exit 1
fi

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$MEMORA_PORT/api/health" >/dev/null 2>&1; then
    echo "Aggiornamento completato: $TARGET_TAG"
    echo "Backup pre-aggiornamento: $MEMORA_BACKUP_DIR"
    exit 0
  fi
  sleep 1
done

echo "Il servizio non risponde dopo l’aggiornamento: rollback."
rollback
exit 1
