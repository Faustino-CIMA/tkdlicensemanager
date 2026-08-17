#!/usr/bin/env bash
set -euo pipefail

echo "Installing prerequisites: Docker and Git"

if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg lsb-release git
  if ! command -v docker >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker "$USER"
  fi
elif command -v dnf >/dev/null 2>&1; then
  sudo dnf install -y git curl
  if ! command -v docker >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sh
    sudo systemctl enable --now docker
    sudo usermod -aG docker "$USER"
  fi
elif command -v pacman >/dev/null 2>&1; then
  sudo pacman -Sy --noconfirm git docker
  sudo systemctl enable --now docker
  sudo usermod -aG docker "$USER"
else
  echo "Unsupported package manager. Install Docker and Git manually:"
  echo "https://docs.docker.com/engine/install/"
  echo "https://git-scm.com/downloads"
  exit 1
fi

echo
echo "Next steps:"
echo "1. Log out and back in (or reboot) for docker group changes to take effect."
echo "2. Verify installs:"
echo "   docker --version"
echo "   docker compose version"
echo "   git --version"
