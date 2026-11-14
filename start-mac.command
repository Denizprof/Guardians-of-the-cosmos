#!/bin/bash
# Global SAR: install (first run only), build and start the app. Double-click this file on macOS
# (or run ./start-mac.command in Terminal; it also works on Linux).
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get it from https://nodejs.org (version 20.19 or newer), or run: brew install node"
  read -r -p "Press Enter to close."
  exit 1
fi
if [ ! -d web/node_modules ]; then
  echo "Installing dependencies (first run only)..."
  npm run setup || { echo "Setup failed."; read -r -p "Press Enter to close."; exit 1; }
fi
echo "Starting Global SAR. The address is printed below (normally http://localhost:4173). Press Ctrl+C to stop."
npm start
