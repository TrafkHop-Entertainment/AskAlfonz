// js/infoPopup.js
// Einmaliges Hinweis-Banner pro Sitzung: erklärt, was die Seite speichert
// (Transparenz, da öffentlich zugänglich) und wie man Alfonz überhaupt
// zum Laufen bringt (Helper + Ollama + Repo). Blockiert NICHTS — reiner
// Hinweis, wegklickbar, Chat funktioniert auch ohne Bestätigung.
//
// "Schon gesehen"-Status lebt in sessionStorage (NICHT localStorage!):
// kommt also bei jedem neuen Tab/jeder neuen Sitzung wieder, verschwindet
// aber nicht für immer — passt zur "keine Cookies, kein dauerhaftes
// Tracking"-Philosophie des Projekts. Würde man "für immer nicht mehr
// zeigen" wollen, bräuchte es localStorage — bewusst nicht gewählt.

const InfoPopup = (() => {

    const SEEN_KEY = 'alfonz_info_seen';
    const REPO_URL = 'https://github.com/TrafkHop-Entertainment/AskAlfonz.git';

    function hasBeenSeen() {
        try {
            return sessionStorage.getItem(SEEN_KEY) === '1';
        } catch (e) {
            return false; // im Zweifel lieber zeigen als verschlucken
        }
    }

    function markAsSeen() {
        try {
            sessionStorage.setItem(SEEN_KEY, '1');
        } catch (e) { /* sessionStorage blockiert? dann eben jedes Mal zeigen */ }
    }

    function buildPopup() {
        const overlay = document.createElement('div');
        overlay.id = 'alfonz-info-overlay';

        const box = document.createElement('div');
        box.id = 'alfonz-info-box';

        box.innerHTML = `
            <button id="alfonz-info-close" class="do" title="Schließen">✕</button>
            <h2>Willkommen, Traveler</h2>

            <h3>🔒 Was hier passiert (Datenschutz)</h3>
            <p>
                Ask Alfonz läuft komplett <strong>lokal auf deinem eigenen Gerät</strong> —
                nicht auf einem fremden Server. Diese Webseite (auf GitHub Pages) verbindet
                sich nur mit einem kleinen Helper-Programm und einer KI (Ollama), die beide
                bei dir auf dem Rechner laufen.
            </p>
            <ul>
                <li><strong>Chatverlauf:</strong> bleibt nur im Speicher deines Browser-Tabs
                    (<code>sessionStorage</code>) — kein Cookie, kein Account, kein Server.
                    Schließt du den Tab, ist er weg, außer du speicherst ihn dir selbst als Datei.</li>
                <li><strong>Deine Fragen & die KI-Antworten:</strong> gehen ausschließlich an
                    deine eigene, lokale Ollama-Installation — nirgendwo sonst hin.</li>
                <li><strong>Deine Dateien/Notizen (RAG-Archiv):</strong> werden nur von deinem
                    eigenen Helper-Programm von deiner eigenen Festplatte gelesen.</li>
                <li>Diese Hinweisbox merkt sich nur für die aktuelle Browser-Sitzung, dass du
                    sie gesehen hast (auch das via <code>sessionStorage</code>, kein Tracking).</li>
            </ul>

            <h3>🚀 Wie du Alfonz benutzt</h3>
            <p>Alfonz braucht zwei Dinge, die <strong>bei dir lokal</strong> laufen müssen:</p>
            <ol>
                <li><strong>Ollama</strong> installieren (<a class="do" href="https://ollama.com" target="_blank" rel="noopener">ollama.com</a>)
                    und ein Modell ziehen, z.B.:
                    <span class="codeblock alfonz-info-code">ollama pull qwen3:8b</span>
                </li>
                <li>Den <strong>Alfonz-Helper</strong> einrichten — er verbindet diese Webseite
                    sicher mit deinem lokalen Ollama und deinem Datei-Archiv:
                    <span class="codeblock alfonz-info-code">git clone ${REPO_URL}</span>
                    Danach im <code>helper/</code>-Ordner die <code>config.json</code> anpassen
                    (eigener Root-Ordner-Pfad) und <code>start.sh</code> bzw. <code>start.bat</code>
                    ausführen. Alle Details stehen in der <code>helper/README.md</code> im Repo.
                </li>
                <li>Beim allerersten Start: Browser-Warnung wegen des selbst-signierten
                    Zertifikats einmal akzeptieren (<code>https://localhost:7861/api/status</code>
                    öffnen → "Trotzdem fortfahren").</li>
            </ol>
            <p>
                Läuft beides, verbindet sich diese Seite automatisch — der kleine Punkt oben
                in der Leiste wird grün, sobald alles bereit ist.
            </p>

            <button id="alfonz-info-ok" class="do alfonz-info-ok-btn">Verstanden, los geht's!</button>
        `;

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        const close = () => {
            overlay.remove();
            markAsSeen();
        };

        document.getElementById('alfonz-info-close').addEventListener('click', close);
        document.getElementById('alfonz-info-ok').addEventListener('click', close);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close(); // Klick außerhalb der Box schließt auch
        });
    }

    function showIfFirstVisit() {
        if (!hasBeenSeen()) {
            buildPopup();
        }
    }

    // Erlaubt manuelles erneutes Öffnen, z.B. über einen "Info"-Button
    // in der Status-Leiste, falls man es später nochmal lesen will.
    function showManually() {
        buildPopup();
    }

    return { showIfFirstVisit, showManually };
})();
