#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "Starte Alfonz-Helper..."
echo ""

if [ ! -d "node_modules" ]; then
    echo "Erste Ausführung erkannt - installiere Abhängigkeiten..."
    npm install
    echo ""
fi

echo "Tipp: Vergiss nicht, vorher 'ollama serve' in einem eigenen Terminal zu starten!"
echo ""
node server.js
