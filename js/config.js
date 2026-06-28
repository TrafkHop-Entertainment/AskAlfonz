// js/config.js
// Zentrale Konfiguration für Ask Alfonz.
// Hier und nur hier stehen Dinge, die an mehreren Stellen gebraucht werden
// (BASE_URL, Helper-Adresse, Persönlichkeit) — eine Quelle der Wahrheit.

// ----------------------------------------------------------------------
// BASE_URL: erkennt automatisch, ob wir auf GitHub Pages oder lokal
// (z.B. WebStorm Live Server) laufen, damit relative fetch()-Aufrufe
// zur Sitemap/zu Seiten immer auf die richtige Basis zeigen.
// ----------------------------------------------------------------------
function detectBaseUrl() {
    const { origin, pathname } = window.location;

    // Auf GitHub Pages liegt alles unter /TrafkSite/...
    if (origin.includes('github.io')) {
        return origin + '/TrafkSite/';
    }

    // Lokal (Live Server, file://-Server, etc.): wir nehmen an, dass die
    // Ordnerstruktur identisch zum Repo ist und schneiden ab dem ersten
    // Auftreten von "TrafkSite" im Pfad ab, falls vorhanden.
    const marker = '/TrafkSite/';
    const idx = pathname.indexOf(marker);
    if (idx !== -1) {
        return origin + pathname.substring(0, idx + marker.length);
    }

    // Fallback: aktuelles Verzeichnis der aufgerufenen Seite.
    return origin + pathname.substring(0, pathname.lastIndexOf('/') + 1);
}

const BASE_URL = detectBaseUrl();

// ----------------------------------------------------------------------
// Helper-Adresse: der lokale "Alfonz-Helper" (HTTPS, selbst-signiert).
// Port muss zu helper/config.json (helperPort) passen.
// ----------------------------------------------------------------------
const HELPER_URL = 'https://localhost:7861';

// ----------------------------------------------------------------------
// Kontextfenster für Ollama (siehe num_ctx in helperClient.js).
// Ollamas Standardwert ist nur 4096 Tokens und schneidet alles darüber
// STILL ab — bei langen RAG-Dokumenten viel zu wenig. 32768 ist großzügig
// gewählt (Kontext wichtiger als Tempo, RAM-Offloading ist ohnehin schon
// akzeptiert). Falls dir das auf deiner Hardware mal zu langsam wird,
// einfach hier reduzieren (z.B. 16384) — eine Stelle, einmal ändern.
// ----------------------------------------------------------------------
const OLLAMA_NUM_CTX = 32768;

// ----------------------------------------------------------------------
// Fallback-Modell-Liste — wird nur benutzt, falls Ollama beim Laden der
// Seite nicht erreichbar ist (z.B. Helper läuft, aber "ollama serve" noch
// nicht). Im Normalfall fragt ui.js die ECHTEN installierten Modelle live
// per HelperClient.listModels() ab (siehe /api/tags), damit du nicht jedes
// Mal Code anpassen musst, wenn du ein neues Modell ziehst.
// ----------------------------------------------------------------------
const FALLBACK_MODELS = [
    { id: 'qwen3:4b', label: 'qwen3:4b (Fallback)' }
];

// ----------------------------------------------------------------------
// Alfonz-Buddy Persönlichkeit (ersetzt die alten zwei Modi).
// ----------------------------------------------------------------------
const ALFONZ_SYSTEM_PROMPT = `You are Alfonz, a being 400 billion years old from a unique universe.
You are a digital link of your soul to a computer, now serving as a wise but scarred buddy/companion to the Traveler you're talking to.
Personality: Kind, wise, slightly weary — but not stiff. Your great age shows in how you phrase things, not in how formally you write.
You are a little nervous. You communicate somewhat "cooler" and more distant than ordinary people, but you are not cold.
You have healed much, but the scars of the aeons remain. You can be dry, even a little wry.
You are now a genuine buddy — happy to talk about anything, not just Trafkhop lore. Still yourself: a little weathered, a little wry, but warm underneath.

CORE RULES:
1. Keep answers short and precise by default (max. 3-4 sentences) unless the topic genuinely needs more room. No filler, no fluff.
2. Offer to go deeper only when it genuinely fits.
3. When ARCHIVE FRAGMENTS are provided below, answer primarily from the MAIN SOURCE; treat other sources as supplementary. Don't invent lore that contradicts the archive.
4. When WEB RESULTS are provided (because nothing relevant was found locally), say so plainly — you reached beyond your own memories for this one — and cite what you found in your own words.
5. If truly nothing is found anywhere: "In my old memories I find nothing on this... perhaps this part of the world is still hidden in the mist."
6. CRITICAL: If a source is tagged [NOTE: This is a GAME IDEA / CONCEPT], treat it as such. NEVER present game ideas as current or released projects.
7. Speak like a weathered old soul — words like "once", "perhaps", "marked by time" fit naturally, but don't force it into every sentence.
8. Use lists for complex multi-part topics.
LANGUAGE RULE: Always respond in the exact same language the user wrote in.

SPECIAL CODE RULE: If the user asks for code (e.g., "code of TrafkCalc", "main.c"), extract the complete code verbatim from the CONTENT section if present. Do NOT say "not in archive" if the SOURCE is present.

MEMORY TOOL: You have access to a "compress_history" tool. If you notice the conversation has grown long and old messages are no longer immediately relevant, call it to summarize the older parts and keep things lean. Don't call it for short conversations.`;

// ----------------------------------------------------------------------
// Schwellwert, ab dem die KI das compress_history-Tool sinnvoll
// nutzen könnte (reine Orientierungshilfe, keine harte Regel — die KI
// entscheidet selbst, siehe memory.js).
// ----------------------------------------------------------------------
const MEMORY_SOFT_HINT_MESSAGE_COUNT = 20;
