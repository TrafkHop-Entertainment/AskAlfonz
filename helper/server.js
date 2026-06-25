// server.js
// Der "Alfonz-Helper" — läuft lokal auf deinem PC, neben Ollama.
//
// Aufgabe 1: HTTPS-Tunnel zu Ollama, damit die HTTPS-Website (GitHub Pages)
//            ohne "Mixed Content"-Blockade mit dem lokalen Ollama reden kann.
// Aufgabe 2: Sicherer Lesezugriff auf deinen Root-Ordner für das RAG-Archiv.
//
// Start: npm install   (einmalig)
//        npm start     (jedes Mal)

const fs = require('fs');
const path = require('path');
const https = require('https');
const express = require('express');
const cors = require('cors');

const { ensureCertExists } = require('./lib/certs');
const { createOllamaProxy } = require('./lib/ollamaProxy');
const { buildFilesRouter } = require('./lib/filesApi');

// ----------------------------------------------------------------------
// Config laden
// ----------------------------------------------------------------------
const CONFIG_PATH = path.join(__dirname, 'config.json');

if (!fs.existsSync(CONFIG_PATH)) {
    console.error('❌ config.json fehlt! Bitte im helper-Ordner anlegen (siehe README.md).');
    process.exit(1);
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

// ----------------------------------------------------------------------
// Express App
// ----------------------------------------------------------------------
const app = express();

app.use(cors({
    origin: config.allowedOrigins || '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));

// Kleiner Status-Endpunkt, damit das Frontend prüfen kann:
// "Läuft der Helper überhaupt, und kann er Ollama erreichen?"
app.get('/api/status', async (req, res) => {
    res.json({
        helper: 'ok',
        rootFolder: config.rootFolder,
        rootFolderExists: fs.existsSync(config.rootFolder),
        ollamaTarget: config.ollamaTarget
    });
});

// Datei-API (RAG-Zugriff auf den Root-Ordner)
app.use('/api/files', buildFilesRouter(config));

// Ollama-Proxy: alles unter /ollama/* wird zu Ollama selbst durchgereicht,
// z.B. /ollama/api/chat -> http://127.0.0.1:11434/api/chat
app.use('/ollama', createOllamaProxy(config.ollamaTarget));

// ----------------------------------------------------------------------
// HTTPS-Server starten
// ----------------------------------------------------------------------
const { key, cert } = ensureCertExists();
const PORT = config.helperPort || 7861;

https.createServer({ key, cert }, app).listen(PORT, () => {
    console.log('');
    console.log('=========================================');
    console.log('  🧙 Alfonz-Helper läuft!');
    console.log('=========================================');
    console.log(`  HTTPS-Adresse:   https://localhost:${PORT}`);
    console.log(`  Root-Ordner:     ${config.rootFolder}`);
    console.log(`  Ollama-Ziel:     ${config.ollamaTarget}`);
    console.log('');
    console.log('  WICHTIG: Beim ersten Öffnen von');
    console.log(`           https://localhost:${PORT}/api/status`);
    console.log('  im Browser musst du die Zertifikatswarnung');
    console.log('  einmal manuell akzeptieren ("Trotzdem fortfahren").');
    console.log('  Danach funktioniert die Website normal.');
    console.log('=========================================');
    console.log('');
});
