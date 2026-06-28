# Alfonz-Helper

Das ist das kleine Programm, das **lokal auf deinem PC** läuft, damit Ask Alfonz
(auf GitHub Pages) mit deinem lokalen Ollama reden und deinen Root-Ordner (z.B.:)
(`run/media/hopx/TrafkSite/`) als RAG-Archiv lesen kann.

Die Website selbst bleibt auf GitHub Pages — nur Ollama + dieser Helper laufen
bei dir zuhause.

## Was macht der Helper genau?

1. **HTTPS-Tunnel zu Ollama**
   GitHub Pages läuft über `https://`. Browser blockieren standardmäßig, dass
   eine `https://`-Seite eine einfache `http://localhost:11434`-Anfrage (so
   spricht Ollama von Haus aus) schickt — das nennt sich "Mixed Content".
   Der Helper öffnet stattdessen selbst `https://localhost:7861` und reicht
   alles intern an Ollama weiter.

2. **Sicherer Dateizugriff**
   Damit Alfonz deine Lore/Projekte/Notizen lesen kann, braucht er Zugriff auf
   deine Festplatte. Browser dürfen das aus Sicherheitsgründen nicht von
   selbst — der Helper liest stattdessen den in `config.json` eingetragenen
   Ordner aus und stellt ihn der Website über eine kleine, abgesicherte
   Schnittstelle bereit (nur lesend, nur erlaubte Dateitypen, nichts außerhalb
   des Root-Ordners).

## Einmaliges Setup

1. **Node.js installieren**, falls noch nicht vorhanden: https://nodejs.org (LTS-Version reicht)
2. **Ollama installieren**, falls noch nicht vorhanden: https://ollama.com
3. Mindestens ein Modell ziehen, z.B.:
   ```
   ollama pull qwen3:8b
   ```
4. In `config.json` (in diesem Ordner) den `rootFolder`-Pfad auf deinen echten
   Pfad anpassen, z.B.:
   ```json
   "rootFolder": "/run/media/raubo/RaubosHDD2/TrafkSite"
   ```
   Auf Windows z.B.: `"D:/TrafkSite"`
5. Trag unter `allowedOrigins` alle Adressen ein, von denen aus du die Seite
   öffnest (die GitHub-Pages-Adresse ist schon drin; falls du z.B. WebStorm
   mit einem anderen Port nutzt, dort ergänzen).

## Jeden Tag, wenn du Alfonz benutzen willst

1. Ollama starten (falls es nicht schon automatisch im Hintergrund läuft):
   ```
   ollama serve
   ```
2. Den Helper starten:
   - Windows: Doppelklick auf `start.bat`
   - Linux/Mac: `./start.sh` (einmalig `chmod +x start.sh` nötig)
3. Beim ersten Mal: Öffne `https://localhost:7861/api/status` im Browser und
   bestätige die Zertifikatswarnung ("Erweitert" → "Trotzdem fortfahren").
   Das ist normal und passiert nur, weil das Zertifikat selbst-signiert ist
   (kein offizielles Internet-Zertifikat für `localhost` nötig/möglich).
4. Jetzt die TrafkSite ganz normal im Browser öffnen — Alfonz verbindet sich
   automatisch mit deinem lokalen Helper.

## Dateien in diesem Ordner

| Datei/Ordner       | Zweck                                                          |
|--------------------|------------------------------------------------------------------|
| `server.js`        | Haupteinstieg, startet den HTTPS-Server                          |
| `config.json`      | Deine Einstellungen (Root-Ordner, Ports, erlaubte Adressen)      |
| `lib/certs.js`     | Erzeugt das selbst-signierte HTTPS-Zertifikat                    |
| `lib/ollamaProxy.js` | Leitet Anfragen an Ollama weiter                                |
| `lib/filesApi.js`  | Liest sicher aus deinem Root-Ordner                              |
| `certs/`           | Generiertes Zertifikat (wird automatisch erstellt, nicht commiten!) |
| `start.bat` / `start.sh` | Komfort-Start für Windows / Linux/Mac                      |

## Troubleshooting

- **"Ollama ist nicht erreichbar"** → Läuft `ollama serve`? Mit `ollama ps`
  prüfen, ob ein Modell geladen ist.
- **Website zeigt "Helper nicht erreichbar"** → Läuft der Helper noch im
  Terminal? Wurde die Zertifikatswarnung schon einmal akzeptiert?
- **RAG findet keine Dateien** → Stimmt der `rootFolder`-Pfad in
  `config.json`? Pfad-Schreibweise unter Windows mit `/` statt `\` versuchen.
