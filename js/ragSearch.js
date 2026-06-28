// js/ragSearch.js
// Übernommen aus dem alten AskAlfonz.js-Konzept, aber:
// - liest Dateien jetzt über den Helper (lokale Platte) statt fetch() auf die Live-Seite
// - Sitemap kommt aus dem ROOT-Ordner (/sitemap.xml), nicht aus einer Projekt-Kopie
// - dritte Stufe vorbereitet: Web-Suche als Fallback, falls RAG nichts findet
//   (echte Anbindung an SearXNG folgt später, siehe searchWeb() Stub unten)

const RagSearch = (() => {

    let sitemapUrls = [];          // relative Pfade (zum Root-Ordner), z.B. "projects/.../main.c"
    let urlPriorityMap = new Map();
    let searchIndex = [];          // [{ path, text, rawText, images, isBackup, isGameIdea, priority }]
    let indexReady = false;
    let indexBuildPromise = null;

    // ----------------------------------------------------------------
    // Filter: nichts aus .git, node_modules etc. indizieren
    // (der Helper filtert das serverseitig schon über excludeFolders,
    //  das hier ist eine zusätzliche Absicherung im Frontend)
    // ----------------------------------------------------------------
    function shouldIndexPath(p) {
        if (!p) return false;
        const lower = p.toLowerCase();
        if (lower.includes('.git/')) return false;
        return true;
    }

    // ----------------------------------------------------------------
    // Sitemap laden — aus dem ROOT-Ordner, über den Helper.
    // sitemap.xml enthält volle URLs (z.B. https://irgendeine-domain.de/TrafkSite/...).
    // Für die LOKALE Dateisuche ist die Domain davor komplett irrelevant —
    // wir brauchen nur den Teil NACH "/TrafkSite/", denn das entspricht
    // exakt dem Root-Ordner, den der Helper durchsucht. Wichtig: das
    // funktioniert dadurch unabhängig davon, von wo aus die Seite gerade
    // aufgerufen wird (GitHub Pages, WebStorm Live Server, irgendein
    // anderer lokaler Server) — die Sitemap-Domain muss mit der aktuellen
    // BASE_URL gar nicht übereinstimmen, wir schneiden einfach ab einem
    // festen Markernamen ab, statt zwei URLs zu vergleichen.
    // ----------------------------------------------------------------
    // sitemap.xml ist eine XML-Datei — Sonderzeichen in Dateinamen wie "&"
    // stehen darin korrekterweise HTML-kodiert als "&amp;" (sonst wäre die
    // XML-Datei selbst ungültig). Für den tatsächlichen Dateipfad auf der
    // Festplatte brauchen wir aber das echte Zeichen zurück, sonst sucht
    // der Helper nach einer Datei, die "&amp;" im Namen hat statt nur "&"
    // — und findet sie nicht (404), obwohl sie existiert.
    function decodeXmlEntities(text) {
        return text
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'");
    }

    function urlToRelativePath(fullUrl) {
        const marker = '/TrafkSite/';
        const idx = fullUrl.indexOf(marker);
        if (idx === -1) return null; // URL gehört nicht zu unserer Seite, ignorieren
        return decodeXmlEntities(fullUrl.substring(idx + marker.length));
    }

    async function loadSitemap() {
        sitemapUrls = [];
        urlPriorityMap.clear();

        const xmlText = await HelperClient.readFile('sitemap.xml');
        if (!xmlText) {
            console.warn('⚠️ sitemap.xml konnte nicht über den Helper gelesen werden.');
            return;
        }

        const urlRegex = /<loc>(.*?)<\/loc>/gi;
        const priorityRegex = /<priority>(.*?)<\/priority>/gi;
        const priorities = [...xmlText.matchAll(priorityRegex)].map(m => m[1]);
        const seen = new Set();

        let idx = 0;
        let locMatch;
        while ((locMatch = urlRegex.exec(xmlText)) !== null) {
            let fullUrl = locMatch[1].trim();
            let priority = (idx < priorities.length) ? priorities[idx] : '0.65';
            idx++;

            // Volle URL -> relativer Pfad zum Root-Ordner (domain-unabhängig)
            let relPath = urlToRelativePath(fullUrl);
            if (!relPath || seen.has(relPath)) continue;
            seen.add(relPath);

            if (shouldIndexPath(relPath)) {
                sitemapUrls.push(relPath);
                urlPriorityMap.set(relPath, parseFloat(priority));
            }
        }
        console.log(`✅ Sitemap geladen: ${sitemapUrls.length} Pfade`);
    }

    // ----------------------------------------------------------------
    // Bilder aus Markdown-Rohtext extrahieren (Obsidian-Stil ![[bild.png]])
    // ----------------------------------------------------------------
    function extractImagesFromRaw(rawText, docPath) {
        if (!rawText) return [];
        const baseDir = docPath.substring(0, docPath.lastIndexOf('/') + 1);
        const images = [];
        const seen = new Set();
        for (const m of rawText.matchAll(/!\[\[([^\]]+\.(png|jpg|jpeg|gif|webp|bmp|svg))\]\]/gi)) {
            const filename = m[1].trim();
            if (seen.has(filename)) continue;
            seen.add(filename);
            const beforeImg = rawText.substring(0, m.index);
            const labelMatch = beforeImg.match(/####\s*picture description of:\s*(.+)\s*$/im);
            const label = labelMatch ? labelMatch[1].trim() : filename.replace(/\.[^.]+$/, '');
            images.push({ filename, relPath: baseDir + filename, label });
        }
        return images;
    }

    // Sehr simple HTML-Tag-Entfernung für den durchsuchbaren Volltext
    // (kein DOMParser nötig, da wir keinen Browser-DOM-Kontext über den
    //  Helper bekommen — reiner Text reicht für die Stichwortsuche).
    function flattenHtml(text) {
        return text
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // ----------------------------------------------------------------
    // Index aufbauen: alle Sitemap-Pfade über den Helper einlesen.
    //
    // WICHTIG: Promise.allSETTLED statt Promise.all! Bei mehreren hundert
    // Pfaden (Sitemaps haben oft 100+) ist es NORMAL, dass einzelne Dateien
    // fehlschlagen (Sonderzeichen im Pfad, gelöschte Datei, o.ä.). Mit
    // Promise.all würde EIN EINZIGER Fehler den GESAMTEN Index auf 0
    // zurückwerfen, ohne jede Fehlermeldung — genau das ist der Bug, der
    // hier ursprünglich dazu führte, dass das RAG-Archiv komplett leer
    // blieb, obwohl der Helper einzelne Dateien nachweislich korrekt lesen
    // konnte. Mit allSettled sammeln wir, was funktioniert, und überspringen
    // nur das, was fehlschlägt.
    // ----------------------------------------------------------------
    async function buildSearchIndex() {
        const relevantPaths = sitemapUrls.filter(shouldIndexPath);
        console.log(`📚 Baue Index mit ${relevantPaths.length} Pfaden auf...`);

        const settled = await Promise.allSettled(relevantPaths.map(async (relPath) => {
            const raw = await HelperClient.readFile(relPath);
            if (!raw) return null;

            const flat = relPath.endsWith('.html') ? flattenHtml(raw) : raw.replace(/\s+/g, ' ').trim();
            if (!flat) return null;

            const priority = urlPriorityMap.get(relPath) || 0.65;
            return {
                path: relPath,
                text: flat.toLowerCase(),
                rawText: raw,
                images: relPath.endsWith('.md') ? extractImagesFromRaw(raw, relPath) : [],
                isBackup: /\/backups?\//i.test(relPath) || /\/old\//i.test(relPath),
                isGameIdea: /\/gameideas\//i.test(relPath) || /spieleideen/i.test(relPath),
                priority
            };
        }));

        let failedCount = 0;
        const results = settled.map(s => {
            if (s.status === 'fulfilled') return s.value;
            failedCount++;
            return null;
        });

        searchIndex = results.filter(Boolean);
        indexReady = true;
        console.log(`✅ Index fertig: ${searchIndex.length} Dokumente geladen.${failedCount > 0 ? ` (${failedCount} Pfade übersprungen, z.B. wegen 404 oder Sonderzeichen)` : ''}`);
    }

    // Startet Sitemap+Index-Aufbau einmalig im Hintergrund.
    // Gibt ein Promise zurück, auf das man bei Bedarf warten kann.
    function startIndexing() {
        if (!indexBuildPromise) {
            indexBuildPromise = loadSitemap()
                .then(() => buildSearchIndex())
                .catch(e => {
                    console.warn('Sitemap/Index Ladefehler:', e);
                    indexReady = true; // Fallback freischalten, auch wenn leer
                });
        }
        return indexBuildPromise;
    }

    function isIndexReady() {
        return indexReady;
    }

    // ----------------------------------------------------------------
    // ARCHIVE MAP für den KI-Router (Stufe 1) — Pfade jetzt relativ
    // zum Root-Ordner, identisch zur alten Logik.
    // ----------------------------------------------------------------
    const ARCHIVE_MAP_PROMPT = `You are the internal Database Router for Trafkhop Entertainment.
You are given a User Query and a list of available file paths.
YOUR ONLY TASK: Find the 1 to 4 file paths that most likely contain the answer to the query.
RETURN ONLY A RAW JSON ARRAY of strings. Do not use markdown blocks (\`\`\`json). Just the array.
Example: ["projects/TrafkCalc/TrafkCalc/main.c", "SourceHop-Notes/trafkverse/Information/BasicsOfTheVerses.html"]

ARCHIVE MAP — use this to understand where things live:

PROJECTS & CODE
- projects/projects.html            → overview of all TrafkHop projects
- projects/<Name>/<Name>/           → source files for that project (e.g. main.c, index.html, *.js)

LORE & UNIVERSE
- SourceHop-Notes/trafkverse/       → PRIMARY lore location (HTML notes)
  - Information/BasicsOfTheVerses.html  → fundamental lore: what are Verses, Anam, the Outside
  - Information/MagicBook.html          → magic system, Mana, spells, LE/Anam costs
  - Information/UseCasesForMagicAndMagicalItems.html → applied magic, items
  - Information/Alfönisß_*.html         → TrafkHops own language
  - Worlds/                             → here are the storys, the history, culture and geography of all the worlds and places there are.
  - Characters/                         → character sheets and bios
- SourceHop-Notes/trafkverse/trafkverse.html → lore index/overview

STUDIO & META
- studio/                           → info about TrafkHop Entertainment as a studio
- news/                             → news and updates
- index.html                        → site homepage

ROUTING RULES:
- "lore / universe / verses / anam / mana / magic / grundwerk / etc" → SourceHop-Notes/trafkverse/Information/
- "world / planet / <world name> / etc"   → SourceHop-Notes/trafkverse/Worlds/
- "character / person / <name> / etc"     → SourceHop-Notes/trafkverse/Characters/ or Characters/<Name>
- "projects / games / what are you working on / etc" → projects/projects.html
- "code / source / snippet / <ProjectName> / etc" → projects/<ProjectName>/ source files
- "studio / team / about / etc"           → studio/
If nothing fits those criterias, think and pick the ones that fit the most`;

    // Erkennt Backup-/Archiv-Pfade (z.B. ".../old/...", ".../Backups/...").
    // Diese bleiben zwar im Index (für den seltenen Fall, dass jemand
    // explizit nach einer alten Version fragt), werden aber standardmäßig
    // NICHT der KI zur Auswahl angeboten — sonst greift sie (wie beobachtet)
    // gerne zur alten Version, einfach weil sie zufällig im selben Ordner
    // wie die aktuelle Datei liegt, ohne dass danach gefragt wurde.
    function isBackupPath(p) {
        return /\/old\//i.test(p) || /\/backups?\//i.test(p);
    }

    // Erkennt, ob die Userfrage selbst explizit nach einer alten/Backup-
    // Version fragt — nur dann dürfen Backup-Pfade der KI angeboten werden.
    function queryAsksForBackup(userQuery) {
        return /\b(alt|alte|alten|backup|archiv|old|vorherige|frühere)\b/i.test(userQuery);
    }

    // Stufe 1: KI wählt relevante Pfade aus der Sitemap-Liste.
    // Braucht eine chat()-Funktion (üblicherweise HelperClient.chat) und das aktuelle Modell.
    async function pickRelevantPaths(userQuery, model) {
        let availablePaths = sitemapUrls.filter(shouldIndexPath);
        if (!queryAsksForBackup(userQuery)) {
            availablePaths = availablePaths.filter(p => !isBackupPath(p));
        }
        const searchMsg = `USER QUERY: ${userQuery}\n\nAVAILABLE PATHS:\n${JSON.stringify(availablePaths)}`;

        try {
            const result = await HelperClient.chat(model, [
                { role: 'system', content: ARCHIVE_MAP_PROMPT },
                { role: 'user', content: searchMsg }
            ]);
            let reply = result?.message?.content || '[]';
            reply = reply.replace(/```json/gi, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(reply);
            if (Array.isArray(parsed)) return parsed;
        } catch (e) {
            console.warn('KI-Pfadwahl fehlgeschlagen, nutze Fallback...', e);
        }
        return [];
    }

    // KEIN Zeichen-Limit mehr — komplette Dateien werden immer voll
    // eingefügt, egal wie lang. Bewusste Entscheidung: Vollständigkeit ist
    // wichtiger als Performance/Sicherheit hier. RISIKO, das damit bewusst
    // akzeptiert wird: Falls eine einzelne Quelle zufällig riesig ist, kann
    // sie allein schon einen Großteil des num_ctx-Fensters (32768 Tokens,
    // siehe config.js) aufbrauchen — Ollama schneidet bei Überschreitung
    // STILL ab, ohne Fehlermeldung. Das LOG_WARN_CHAR_THRESHOLD unten
    // dient nur der Transparenz in der Konsole, schneidet selbst NICHTS ab.
    const LOG_WARN_CHAR_THRESHOLD = 50000;

    function buildContextFromPaths(chosenPaths) {
        let contextStr = '';
        let images = [];
        let addedFiles = 0;

        for (const path of chosenPaths) {
            if (addedFiles >= 4) break;
            const normalized = path.replace(/^\/+/, '');
            const doc = searchIndex.find(d => d.path === normalized || d.path === path);
            if (!doc) continue;

            const label = addedFiles === 0 ? `[MAIN SOURCE]\nSOURCE: ${doc.path}` : `SOURCE: ${doc.path}`;
            const ideaTag = doc.isGameIdea ? '\n[NOTE: This is a GAME IDEA / CONCEPT — NOT a released project]' : '';
            const backupTag = doc.isBackup ? '\n[NOTE: This is BACKUP / ARCHIVE content]' : '';
            if (doc.rawText.length > LOG_WARN_CHAR_THRESHOLD) {
                console.warn(`⚠️ "${doc.path}" ist sehr groß (${doc.rawText.length} Zeichen) — wird trotzdem komplett eingefügt, kann num_ctx sprengen.`);
            }
            contextStr += `${label}${ideaTag}${backupTag}\nCONTENT:\n${doc.rawText}\n\n---\n\n`;

            if (doc.images) images.push(...doc.images);
            addedFiles++;
        }

        return { context: contextStr, images, foundAny: addedFiles > 0 };
    }

    // Stufe 2 (Fallback): simple Keyword-Suche, falls die KI-Pfadwahl versagt.
    function fallbackKeywordSearch(userQuery) {
        const allowBackups = queryAsksForBackup(userQuery);
        const words = userQuery.toLowerCase().split(/\W+/).filter(w => w.length > 3);
        const scored = searchIndex
            .filter(doc => allowBackups || !isBackupPath(doc.path))
            .map(doc => {
                let score = 0;
                words.forEach(word => {
                    if (doc.path.toLowerCase().includes(word)) score += 50;
                    if (doc.text.includes(word)) score += 10;
                });
                return { doc, score };
            });
        const topDocs = scored.filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map(x => x.doc);
        const context = topDocs.map(d => `SOURCE: ${d.path}\nCONTENT:\n${d.rawText}`).join('\n\n---\n\n');
        return { context, images: [], foundAny: topDocs.length > 0 };
    }

    // ----------------------------------------------------------------
    // Stufe 3 (Fallback, nur wenn RAG NICHTS findet): Web-Suche.
    // STUB: Anbindung an lokal gehostetes SearXNG folgt später über
    // einen weiteren Proxy-Pfad im Helper (z.B. HELPER_URL + '/searxng/...').
    // Bis dahin liefert diese Funktion bewusst "nicht verfügbar" zurück,
    // damit der Aufrufer (main.js) saubere Fehlertexte zeigen kann statt
    // eines stillen Fehlschlags.
    // ----------------------------------------------------------------
    async function searchWeb(userQuery) {
        console.log('🌐 Web-Suche wäre hier nötig für:', userQuery);
        return { context: '', images: [], foundAny: false, unavailable: true };
    }

    // ----------------------------------------------------------------
    // Öffentliche Haupt-Funktion: kombiniert alle drei Stufen.
    // 1. KI wählt Pfade aus Sitemap
    // 2. Falls das nichts liefert: Keyword-Fallback
    // 3. Falls AUCH DAS nichts liefert: Web-Suche (sobald angebunden)
    // ----------------------------------------------------------------
    async function fetchContext(userQuery, model) {
        if (!indexReady || sitemapUrls.length === 0) {
            return await searchWeb(userQuery);
        }

        const chosenPaths = await pickRelevantPaths(userQuery, model);
        let result = chosenPaths.length > 0 ? buildContextFromPaths(chosenPaths) : { foundAny: false };

        if (!result.foundAny) {
            result = fallbackKeywordSearch(userQuery);
        }

        if (!result.foundAny) {
            const webResult = await searchWeb(userQuery);
            return webResult;
        }

        return result;
    }

    return { startIndexing, isIndexReady, fetchContext };
})();
