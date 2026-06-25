// lib/ollamaProxy.js
// Reicht Anfragen von unserem HTTPS-Helper an das lokal laufende Ollama (HTTP) weiter.
// Grund: GitHub Pages läuft über HTTPS, Browser blockieren von dort aus
// "Mixed Content"-Anfragen an ein einfaches http://localhost:11434.
// Mit diesem Proxy spricht die Website nur noch HTTPS, der Proxy übernimmt
// die letzte Strecke zu Ollama per normalem HTTP (was unproblematisch ist,
// da das nie das eigene Gerät verlässt).

const { createProxyMiddleware } = require('http-proxy-middleware');

function createOllamaProxy(ollamaTarget) {
    return createProxyMiddleware({
        target: ollamaTarget,
        changeOrigin: true,
        ws: false,
        // Ollama streamt Antworten Stück für Stück (für den "Tipp-Effekt" im Chat).
        // selfHandleResponse: false lässt den Stream unverändert durchlaufen.
        selfHandleResponse: false,
        on: {
            error: (err, req, res) => {
                console.error('❌ Ollama-Proxy-Fehler:', err.message);
                if (!res.headersSent) {
                    res.writeHead(502, { 'Content-Type': 'application/json' });
                }
                res.end(JSON.stringify({
                    error: 'Ollama ist nicht erreichbar. Läuft "ollama serve" auf deinem Rechner?'
                }));
            }
        }
    });
}

module.exports = { createOllamaProxy };
