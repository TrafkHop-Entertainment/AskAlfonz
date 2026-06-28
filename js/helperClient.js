// js/helperClient.js
// Einzige Anlaufstelle für alles, was mit dem lokalen Helper redet:
// Status-Check, Datei-Zugriff (RAG-Archiv) und der Ollama-Proxy.
// Andere Module rufen NIE direkt fetch() auf HELPER_URL auf — sie
// benutzen diese Funktionen, damit Fehlerbehandlung an einer Stelle bleibt.

const HelperClient = (() => {

    let lastKnownStatus = null; // wird von ui.js für den Status-Punkt benutzt

    // --------------------------------------------------------------
    // Status
    // --------------------------------------------------------------
    async function getStatus() {
        try {
            const res = await fetch(`${HELPER_URL}/api/status`);
            if (!res.ok) throw new Error(`Status ${res.status}`);
            const data = await res.json();
            lastKnownStatus = { ok: true, ...data };
            return lastKnownStatus;
        } catch (e) {
            lastKnownStatus = { ok: false, error: e.message };
            return lastKnownStatus;
        }
    }

    function getCachedStatus() {
        return lastKnownStatus;
    }

    // --------------------------------------------------------------
    // Dateizugriff (RAG-Archiv auf der lokalen Platte)
    // --------------------------------------------------------------
    async function listFiles(subpath = '') {
        const url = `${HELPER_URL}/api/files/list?subpath=${encodeURIComponent(subpath)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Datei-Liste fehlgeschlagen: HTTP ${res.status}`);
        return res.json(); // { root, count, files: [...] }
    }

    async function readFile(relPath) {
        const url = `${HELPER_URL}/api/files/read?path=${encodeURIComponent(relPath)}`;
        const res = await fetch(url);
        if (!res.ok) return null; // z.B. 404 — Datei existiert nicht/nicht lesbar
        const data = await res.json();
        return data.content;
    }

    // --------------------------------------------------------------
    // Ollama-Proxy (Chat-Anfragen)
    // model: z.B. "qwen3:8b"
    // messages: [{role, content}, ...] im Ollama-Format
    // tools: optionale Tool-Definitionen (für compress_history)
    // think: true/false — steuert Qwen3s nativen Thinking-Modus (siehe
    //        unten). Default false, da Thinking auf schwacher Hardware
    //        teils MINUTEN zusätzlich braucht, bevor überhaupt die
    //        sichtbare Antwort kommt.
    //
    // WICHTIG zu num_ctx: Ollama nutzt standardmäßig nur ein Kontextfenster
    // von 4096 Tokens und schneidet alles, was darüber hinausgeht, STILL
    // vom Anfang her ab — ohne Fehler, ohne Warnung im Frontend. Bei langen
    // RAG-Docs reicht das nicht annähernd. Wir übersteuern das deshalb bei
    // JEDER Anfrage explizit per "options.num_ctx" (Wert kommt aus
    // config.js, siehe OLLAMA_NUM_CTX).
    //
    // WICHTIG zu think: Qwen3 hat einen nativen "Thinking"-Modus, der VOR
    // der eigentlichen Antwort lange intern vor sich hin überlegt (sichtbar
    // im "thinking"-Feld der Antwort). Das Text-Tag "/no_think" im Prompt
    // ist dafür NICHT zuverlässig (bekannter Ollama/Qwen3-Bug, das Modell
    // verwechselt das Tag oft mit echtem Nutzertext). Der korrekte, von
    // Ollama offiziell unterstützte Weg ist dieses eigene "think"-Feld auf
    // oberster Ebene des Request-Bodys (NICHT in "options").
    // --------------------------------------------------------------
    async function chat(model, messages, tools = null, think = false) {
        const body = {
            model,
            messages,
            stream: false,
            think,
            options: { num_ctx: OLLAMA_NUM_CTX }
        };
        if (tools) body.tools = tools;

        const res = await fetch(`${HELPER_URL}/ollama/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            let detail = '';
            try { detail = (await res.json()).error || ''; } catch (e) { /* ignore */ }
            throw new Error(`Ollama nicht erreichbar (HTTP ${res.status}). ${detail}`.trim());
        }

        return res.json(); // { message: { role, content, thinking? }, ... }
    }

    // --------------------------------------------------------------
    // Liste der lokal installierten Ollama-Modelle abrufen.
    // Nutzt Ollamas eigenen /api/tags Endpunkt (läuft automatisch über
    // unseren generischen /ollama/* Proxy, keine Helper-Änderung nötig).
    // Gibt eine einfache Liste von Modell-Namen zurück, z.B. ["qwen3:4b", "qwen3:8b"].
    // --------------------------------------------------------------
    async function listModels() {
        const res = await fetch(`${HELPER_URL}/ollama/api/tags`);
        if (!res.ok) throw new Error(`Modell-Liste fehlgeschlagen: HTTP ${res.status}`);
        const data = await res.json();
        return (data.models || []).map(m => m.name).sort();
    }

    return { getStatus, getCachedStatus, listFiles, readFile, chat, listModels };
})();
