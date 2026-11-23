#!/usr/bin/env bash
set -euo pipefail

# Installa il path unit che consente alla UI di richiedere l'aggiornamento
# senza dare al processo web accesso a sudo o a una shell root.
if [[ "${EUID}" -ne 0 ]]; then
  echo "Esegui come root: sudo $0"
  exit 1
fi

MEMORA_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MEMORA_CONFIG_DIR="${MEMORA_CONFIG_DIR:-/etc/memora}"
ENV_FILE="$MEMORA_CONFIG_DIR/memora.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi
MEMORA_DATA_DIR="${MEMORA_DATA_DIR:-/var/lib/memora}"
MEMORA_USER="${MEMORA_USER:-memora}"

cat > /etc/systemd/system/memora-update.service <<UNIT
[Unit]
Description=Memora update request runner
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=root
Group=root
WorkingDirectory=$MEMORA_HOME
# Lascia il tempo alla richiesta HTTP di rispondere prima del riavvio.
ExecStartPre=/bin/sleep 3
ExecStart=$MEMORA_HOME/update.sh
TimeoutStartSec=1800
StandardOutput=journal
StandardError=journal
SyslogIdentifier=memora-update
UNIT

cat > /etc/systemd/system/memora-update.path <<UNIT
[Unit]
Description=Watch for Memora update requests

[Path]
PathExists=$MEMORA_DATA_DIR/update-request
Unit=memora-update.service

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now memora-update.path
echo "Update helper installato: $MEMORA_DATA_DIR/update-request"
