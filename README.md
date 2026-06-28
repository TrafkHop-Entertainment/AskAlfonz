Copyright © 2026 TrafkHop Entertainment™
All rights reserved.

# AskAlfonz

Der Chatbot der TrafkSite — ein 400 Milliarden Jahre alter, leicht abgenutzter
Begleiter, der dein Trafkhop-Lore-Archiv durchsucht und dir sonst auch einfach
als Buddy zur Seite steht.
(Dieses Projekt ist nur für **Mitglieder von TrafkHop** gedacht)

**Wichtigstes Prinzip dieses Projekts: alles läuft lokal.** Keine Cloud-KI,
kein fremder Server, keine Accounts, keine Cookies. Die Webseite selbst liegt
auf GitHub Pages — aber die KI (Ollama), deine Notizen/Dateien und der
Chatverlauf bleiben ausschließlich auf deinem eigenen Rechner.

## Wie das Ganze zusammenspielt

```
┌─────────────────────┐      HTTPS       ┌──────────────────────┐      HTTP      ┌─────────┐
│   GitHub Pages       │ ───────────────► │   Alfonz-Helper       │ ─────────────► │ Ollama  │
│   (dieses Frontend)  │ ◄─────────────── │   (lokal, Node.js)     │ ◄───────────── │ (lokal) │
└─────────────────────┘                  └──────────┬───────────┘                 └─────────┘
                                                      │
                                                      ▼
                                          Deine Festplatte (RAG-Archiv:
                                          Lore-Notizen, Projekte, Code …)
```

- **Frontend** (`AskAlfonz.html`, `AskAlfonz.css`, `js/`) — läuft im Browser,
  egal ob live auf GitHub Pages oder lokal über einen Live-Server zum Testen.
- **Alfonz-Helper** (`helper/`) — ein kleines Node.js-Programm, das **du**
  lokal startest. Es verbindet die HTTPS-Webseite sicher mit deinem lokalen
  Ollama (HTTP) und liest dein RAG-Archiv von der Festplatte.
- **Ollama** — die eigentliche KI-Engine, läuft komplett auf deinem Gerät.

## Schnellstart

1. [Ollama installieren](https://ollama.com), ein Modell ziehen:
   ```bash
   ollama pull qwen3:8b
   ```
2. Dieses Repo klonen:
   ```bash
   git clone https://github.com/TrafkHop-Entertainment/AskAlfonz.git
   ```
3. Im `helper/`-Ordner `config.json` öffnen und `rootFolder` auf deinen
   eigenen Lore-/Notizen-Ordner anpassen.
4. Helper starten:
   - Windows: `helper/start.bat` doppelklicken
   - Linux/Mac: `./helper/start.sh`
5. Beim allerersten Mal: `https://localhost:7861/api/status` im Browser
   öffnen und die Zertifikatswarnung einmal akzeptieren (selbst-signiert,
   das ist normal und beabsichtigt).
6. Die TrafkSite öffnen, zu Ask Alfonz navigieren — der Status-Punkt in der
   Leiste wird grün, sobald alles verbunden ist.

**Ausführliche Anleitung, Troubleshooting, technische Details zum Helper:**
siehe [`helper/README.md`](helper/README.md).

## Features

- **Kein Cloud-Zugriff nötig** — Chat, RAG-Suche und (später) Bildgenerierung
  laufen alle lokal.
- **RAG-Archiv** — durchsucht deine eigenen Notizen/Projekte über eine
  zweistufige Suche (KI wählt passende Dateien aus der Sitemap, mit
  Keyword-Fallback, falls das nichts findet).
- **Modell-Auswahl** — zeigt automatisch alle Modelle an, die du lokal mit
  `ollama pull` gezogen hast, kein Code-Update nötig für neue Modelle.
- **Gedächtnis-Kompression** — die KI fasst bei Bedarf selbst ältere
  Gesprächsteile zusammen (Tool-Calling), damit lange Unterhaltungen nicht
  am Kontextfenster scheitern. Modelle ohne Tool-Unterstützung funktionieren
  trotzdem ganz normal weiter, nur ohne diese Kompression.
- **Export/Import** — Chatverlauf als Markdown-Datei speichern/laden, über
  die File System Access API (kein Download-Ordner-Chaos). Chrome/Edge mit
  nativer Ordner-Auswahl, Firefox/Safari über klassischen Datei-Dialog.
- **Kein dauerhaftes Tracking** — der laufende Chatverlauf lebt nur in
  `sessionStorage` (übersteht Browser-Tab-Discarding, verschwindet aber beim
  Schließen des Tabs). Kein Cookie, kein Account.

## Projektstruktur

```
AskAlfonz/
├── AskAlfonz.html          Hauptseite
├── AskAlfonz.css           Styles (Status-Leiste, Popup, Chat)
├── js/
│   ├── config.js           Zentrale Konfiguration, Systemprompt, BASE_URL-Erkennung
│   ├── helperClient.js      Kommunikation mit dem lokalen Helper
│   ├── ragSearch.js         RAG-Suchlogik (Sitemap, Index, zweistufige Suche)
│   ├── memory.js            Gedächtnis-Kompression (Tool-Calling)
│   ├── chatExport.js        Export/Import als Markdown
│   ├── ui.js                DOM-Rendering, Status-Leiste, Modell-Dropdown
│   ├── infoPopup.js         Datenschutz-/Anleitungs-Hinweis
│   └── main.js              Orchestrierung, sessionStorage-Persistierung
└── helper/                  Lokales Node.js-Programm (siehe helper/README.md)
    ├── server.js
    ├── config.json          ⚠️ Hier deinen rootFolder-Pfad eintragen!
    ├── lib/
    └── start.sh / start.bat
```

## Mitmachen / Issues

Das Projekt ist in aktiver Entwicklung. Wenn dir Bugs auffallen oder du
Ideen hast, gerne über Issues melden.

---

**Made with AI**
