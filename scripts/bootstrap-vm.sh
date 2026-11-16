#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -eq 0 ]]; then
  echo "Esegui come utente normale con sudo disponibile."
  exit 1
fi

sudo apt update
sudo apt install -y sudo curl ca-certificates git build-essential sqlite3 jq unzip openssh-server qemu-guest-agent
sudo systemctl enable --now ssh qemu-guest-agent

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'Number(process.versions.node.split(`.`)[0])')" -lt 24 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh
  sudo -E bash /tmp/nodesource_setup.sh
  sudo apt install -y nodejs
fi

if command -v corepack >/dev/null 2>&1; then
  sudo corepack enable || true
  corepack prepare pnpm@latest --activate || true
fi

if ! command -v pi >/dev/null 2>&1; then
  curl -fsSL https://pi.dev/install.sh | sh
fi

echo "Bootstrap completato."
node -v || true
npm -v || true
command -v pi || echo "Riapri la shell se Pi è stato appena installato."
