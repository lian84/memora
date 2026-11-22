#!/usr/bin/env bash
set -euo pipefail

# Memora installer for Debian 13 + systemd.
# It installs the current checkout into MEMORA_HOME, builds it and starts the
# service. No secret is copied from the source checkout.
if [[ "${EUID}" -ne 0 ]]; then
  echo "Il programma di installazione richiede root. Riavvio con sudo…"
  exec sudo -E bash "$0" "$@"
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEMORA_HOME="${MEMORA_HOME:-/opt/memora}"
MEMORA_USER="${MEMORA_USER:-memora}"
MEMORA_DATA_DIR="${MEMORA_DATA_DIR:-/var/lib/memora}"
MEMORA_CONFIG_DIR="${MEMORA_CONFIG_DIR:-/etc/memora}"
MEMORA_PORT="${MEMORA_PORT:-3000}"
MEMORA_HOST="${MEMORA_HOST:-127.0.0.1}"
MEMORA_BACKUP_DIR="${MEMORA_BACKUP_DIR:-${MEMORA_DATA_DIR%/}/../memora-backups}"
MEMORA_RESTORE_FILE="${MEMORA_RESTORE_FILE:-}"
MEMORA_VERSION="${MEMORA_VERSION:-$(git -C "$SOURCE_DIR" describe --tags --always 2>/dev/null || echo 0.0.0)}"

systemctl stop memora.service >/dev/null 2>&1 || true

echo "Memora installer"
echo "  codice:   $MEMORA_HOME"
echo "  utente:   $MEMORA_USER"
echo "  dati:     $MEMORA_DATA_DIR"
echo "  config:   $MEMORA_CONFIG_DIR"
echo "  backup:   $MEMORA_BACKUP_DIR"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Dipendenza mancante: $1"
    exit 1
  fi
}

apt-get update
apt-get install -y --no-install-recommends ca-certificates curl tar unzip git

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
else
  NODE_MAJOR=0
fi
if [[ "$NODE_MAJOR" -lt 24 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh
  bash /tmp/nodesource_setup.sh
  apt-get install -y nodejs
fi
need node

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    corepack enable
    corepack prepare pnpm@12.21.0 --activate
  else
    npm install -g pnpm@12.21.0
  fi
fi
need pnpm

if ! id -u "$MEMORA_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$MEMORA_HOME" --shell /usr/sbin/nologin "$MEMORA_USER"
fi
install -d -m 0700 -o "$MEMORA_USER" -g "$MEMORA_USER" "$MEMORA_DATA_DIR" "$MEMORA_BACKUP_DIR" "$MEMORA_DATA_DIR/tools"
install -d -m 0750 -o root -g "$MEMORA_USER" "$MEMORA_CONFIG_DIR"

if [[ "$SOURCE_DIR" != "$MEMORA_HOME" ]]; then
  install -d -m 0750 -o "$MEMORA_USER" -g "$MEMORA_USER" "$MEMORA_HOME"
  tar -C "$SOURCE_DIR" \
    --exclude='.env' --exclude='data' --exclude='node_modules' \
    --exclude='apps/dist' --exclude='packages/*/dist' \
    -cf - . | tar -C "$MEMORA_HOME" -xf -
fi
chown -R "$MEMORA_USER:$MEMORA_USER" "$MEMORA_HOME"

# The Debian rclone package can lack the Mega backend. Prefer the official
# static binary in the data directory.
if ! "$MEMORA_DATA_DIR/tools/rclone" help backends 2>/dev/null | grep -q '^  mega'; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL https://downloads.rclone.org/rclone-current-linux-amd64.zip -o "$tmp/rclone.zip"
  unzip -p "$tmp/rclone.zip" '*/rclone' > "$MEMORA_DATA_DIR/tools/rclone"
  chmod 0755 "$MEMORA_DATA_DIR/tools/rclone"
  chown "$MEMORA_USER:$MEMORA_USER" "$MEMORA_DATA_DIR/tools/rclone"
  rm -rf "$tmp"
  trap - EXIT
fi

runuser -u "$MEMORA_USER" -- sh -c 'cd "$1" && pnpm install --frozen-lockfile && pnpm build' sh "$MEMORA_HOME"

if [[ ! -f "$MEMORA_CONFIG_DIR/memora.env" ]]; then
  cat > "$MEMORA_CONFIG_DIR/memora.env" <<ENV
NODE_ENV=production
MEMORA_HOST=$MEMORA_HOST
MEMORA_PORT=$MEMORA_PORT
MEMORA_DATA_DIR=$MEMORA_DATA_DIR
MEMORA_BACKUP_DIR=$MEMORA_BACKUP_DIR
MEMORA_VERSION=$MEMORA_VERSION
ENV
  chmod 0640 "$MEMORA_CONFIG_DIR/memora.env"
  chown root:"$MEMORA_USER" "$MEMORA_CONFIG_DIR/memora.env"
else
  echo "File ambiente esistente preservato: $MEMORA_CONFIG_DIR/memora.env"
fi

sed \
  -e "s|^User=.*|User=$MEMORA_USER|" \
  -e "s|^Group=.*|Group=$MEMORA_USER|" \
  -e "s|^WorkingDirectory=.*|WorkingDirectory=$MEMORA_HOME|" \
  -e "s|^EnvironmentFile=.*|EnvironmentFile=$MEMORA_CONFIG_DIR/memora.env|" \
  "$MEMORA_HOME/deploy/memora.service" > /etc/systemd/system/memora.service
systemctl daemon-reload
systemctl enable memora.service

if [[ -z "$MEMORA_RESTORE_FILE" && -t 0 ]]; then
  read -r -p "Vuoi ripristinare un backup? [y/N] " reply
  if [[ "$reply" =~ ^[Yy] ]]; then
    read -r -p "Percorso archivio (.mbackup): " MEMORA_RESTORE_FILE
    read -r -s -p "Password del backup: " MEMORA_BACKUP_PASSWORD
    echo
  fi
fi
if [[ -n "$MEMORA_RESTORE_FILE" ]]; then
  echo "Ripristino in corso…"
  MEMORA_BACKUP_PASSWORD="${MEMORA_BACKUP_PASSWORD:?MEMORA_BACKUP_PASSWORD richiesta per il restore}" \
    node "$MEMORA_HOME/scripts/restore-backup.mjs" --file "$MEMORA_RESTORE_FILE" --data-dir "$MEMORA_DATA_DIR" --yes --force
  chown -R "$MEMORA_USER:$MEMORA_USER" "$MEMORA_DATA_DIR"
fi

systemctl restart memora.service
for _ in $(seq 1 60); do
  if curl -fsS "http://$MEMORA_HOST:$MEMORA_PORT/api/health" >/dev/null 2>&1; then
    echo "Memora è attivo su http://$MEMORA_HOST:$MEMORA_PORT"
    exit 0
  fi
  sleep 1
done
echo "Memora non risponde. Controlla: journalctl -u memora.service -n 100"
exit 1
