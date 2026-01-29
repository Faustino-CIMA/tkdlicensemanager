#!/usr/bin/env bash
set -euo pipefail

echo "Installing prerequisites: Docker Desktop and Git"

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew not found. Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

brew update

if ! brew list --cask docker >/dev/null 2>&1; then
  brew install --cask docker
fi

if ! command -v git >/dev/null 2>&1; then
  brew install git
fi

echo
echo "Next steps:"
echo "1. Launch Docker Desktop and finish setup."
echo "2. Verify installs:"
echo "   docker --version"
echo "   docker compose version"
echo "   git --version"
