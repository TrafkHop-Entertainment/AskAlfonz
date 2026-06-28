// js/main.js
// Verbindet alle Module: UI, RAG-Suche, Helper-Client, Gedächtnis, Export/Import.
// Ersetzt das alte sendMessage() von AskAlfonz.js, jetzt ohne Modus-Switch
// (nur noch der eine Alfonz-Buddy) und mit Ollama statt GitHub-Models-Proxy.

let chatHistory = []; // [{role: 'user'|'assistant'|'system', content}, ...]

// ----------------------------------------------------------------------
// Helper-Status periodisch prüfen, UND bei Erfolg die echten installierten
// Ollama-Modelle abrufen (ersetzt die hartcodierte Fallback-Liste im
// Dropdown durch das, was tatsächlich auf diesem PC verfügbar ist).
// ----------------------------------------------------------------------
let modelsLoadedOnce = false;

async function checkHelperStatus() {
    const status = await HelperClient.getStatus();
    if (status.ok) {
        UI.setStatus(true, `Helper ok · ${status.rootFolderExists ? 'Archiv gefunden' : 'Archiv-Pfad fehlt!'}`);

        // Modell-Liste nur einmal laden (nicht bei jedem 30s-Status-Check
        // neu abfragen) — falls du während der Nutzung ein neues Modell
        // ziehst, reicht ein Seiten-Reload, um es im Dropdown zu sehen.
        if (!modelsLoadedOnce) {
            try {
                const models = await HelperClient.listModels();
                if (models.length > 0) {
                    UI.populateModelDropdown(models);
                    modelsLoadedOnce = true;
                }
            } catch (e) {
                console.warn('Konnte installierte Modelle nicht abrufen, bleibe bei Fallback-Liste:', e);
            }
        }
    } else {
        UI.setStatus(false, 'Helper nicht erreichbar — gestartet?');
    }
    return status.ok;
}

// ----------------------------------------------------------------------
// Eine einzelne Anfrage an Ollama, inkl. Tool-Call-Behandlung für
// die Gedächtnis-Kompression (siehe memory.js).
// Gibt { content, thinking } zurück statt nur eines Strings, damit
// main.js den Gedankengang optional anzeigen kann (siehe Thinking-Toggle).
//
// SICHERHEITSNETZ für schwache Modelle (z.B. Llama 3.2 3B): Manche
// Modelle haben kein echtes Tool-Calling-Training und geben stattdessen
// einen kaputten Tool-Call-Versuch als sichtbaren Text aus (z.B.
// {"name": "eval", "parameters": {...}}). Wir erkennen dieses Muster und
// wiederholen die Anfrage EINMAL ohne Tools — das gibt dem Modell die
// Chance, einfach normal zu antworten, ohne dass der User je die kaputte
// JSON-Antwort zu Gesicht bekommt.
// ----------------------------------------------------------------------
async function askOllama(messages, model, think) {
    const tools = Memory.getTools();
    let result = await HelperClient.chat(model, messages, tools, think);

    // Falls die KI das compress_history-Tool aufruft: ausführen, dann
    // die eigentliche Frage erneut (mit komprimiertem Verlauf) stellen.
    if (Memory.wantsCompression(result.message)) {
        chatHistory = await Memory.compress(chatHistory, model);
        const freshMessages = [
            { role: 'system', content: ALFONZ_SYSTEM_PROMPT },
            ...chatHistory
        ];
        result = await HelperClient.chat(model, freshMessages, tools, think);
    }

    // Schwaches Modell hat einen kaputten Tool-Call als Text ausgegeben?
    // Einmal ohne Tools erneut versuchen, statt dem User Müll zu zeigen.
    if (Memory.looksLikeFailedToolCallText(result.message?.content)) {
        console.warn('⚠️ Modell hat einen ungültigen Tool-Call-Versuch als Text ausgegeben — versuche erneut ohne Tools.');
        result = await HelperClient.chat(model, messages, null, think);
    }

    return {
        content: result.message?.content || '',
        thinking: result.message?.thinking || null
    };
}

// ----------------------------------------------------------------------
// Nachricht senden
// ----------------------------------------------------------------------
async function sendMessage(inputField) {
    const text = inputField.value.trim();
    if (!text) return;

    UI.addMessage('Traveler', text);
    inputField.value = '';

    const model = UI.getSelectedModel();
    const think = UI.isThinkingEnabled();
    const loadingId = 'loading-' + Date.now();
    UI.addLoadingMessage(loadingId, 'Alfonz', think);

    try {
        // Index-Status berücksichtigen: Falls noch nicht fertig, kurz warten
        if (!RagSearch.isIndexReady()) {
            for (let i = 0; i < 30 && !RagSearch.isIndexReady(); i++) {
                await new Promise(r => setTimeout(r, 500));
            }
        }

        const { context, images, unavailable } = await RagSearch.fetchContext(text, model);

        let finalPrompt;
        if (context) {
            finalPrompt = `Here are fragments from the Library:\n${context}\n\nAnswer the following question primarily using information from these fragments — treat the MAIN SOURCE as authoritative, others as supplementary.\n\nQuestion: ${text}`;
        } else if (unavailable) {
            finalPrompt = `${text}\n\n(Note: nothing relevant was found locally, and web search is not yet configured. Answer from your own general knowledge if you can, and mention that you couldn't check the archive or the web for this one.)`;
        } else {
            finalPrompt = text;
        }

        chatHistory.push({ role: 'user', content: finalPrompt });

        const messages = [
            { role: 'system', content: ALFONZ_SYSTEM_PROMPT },
            ...chatHistory
        ];

        const { content: reply, thinking } = await askOllama(messages, model, think);
        UI.removeLoadingMessage(loadingId);

        if (!reply) {
            UI.addMessage('Alfonz', '*clears throat* ... The memories are scattered today.');
        } else {
            UI.addMessage('Alfonz', reply, thinking);
            chatHistory.push({ role: 'assistant', content: reply });
        }

        if (images && images.length > 0) UI.addImages(images);

    } catch (e) {
        UI.removeLoadingMessage(loadingId);
        UI.addMessage('Alfonz', `*trembles slightly* ... The connection has been severed. (${e.message})`);
        console.error(e);
    }
}

// ----------------------------------------------------------------------
// Export / Import
// ----------------------------------------------------------------------
async function handleExport() {
    const result = await ChatExport.exportChat(chatHistory);
    if (!result.ok && !result.cancelled) {
        UI.addMessage('System', 'Speichern ist leider fehlgeschlagen.');
    }
}

async function handleImport() {
    const result = await ChatExport.importChat();
    if (result.ok && result.history) {
        chatHistory = result.history;
        UI.clearChatWindow();
        for (const msg of chatHistory) {
            if (msg.role === 'user') UI.addMessage('Traveler', msg.content);
            else if (msg.role === 'assistant') UI.addMessage('Alfonz', msg.content);
        }
    } else if (!result.cancelled) {
        UI.addMessage('System', 'Laden ist leider fehlgeschlagen.');
    }
}

// ----------------------------------------------------------------------
// Init
// ----------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async function () {
    const refs = UI.init();
    if (!refs) return;
    const { inputField, sendBtn, exportBtn, importBtn } = refs;

    sendBtn.addEventListener('click', () => sendMessage(inputField));
    inputField.addEventListener('keypress', e => {
        if (e.key === 'Enter') sendMessage(inputField);
    });
    exportBtn.addEventListener('click', handleExport);
    importBtn.addEventListener('click', handleImport);

    // Helper-Status sofort prüfen, danach alle 30s erneut (z.B. falls
    // der Helper erst NACH dem Laden der Seite gestartet wird)
    checkHelperStatus();
    setInterval(checkHelperStatus, 30000);

    // Sitemap + Index im Hintergrund laden — blockiert NICHT das Senden!
    RagSearch.startIndexing();
});

//Copyright © 2026 TrafkHop Entertainment™
//All rights reserved.

//MADE WITH AI
