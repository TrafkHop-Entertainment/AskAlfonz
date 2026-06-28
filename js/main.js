// js/main.js
// Verbindet alle Module: UI, RAG-Suche, Helper-Client, Gedächtnis, Export/Import.
// Ersetzt das alte sendMessage() von AskAlfonz.js, jetzt ohne Modus-Switch
// (nur noch der eine Alfonz-Buddy) und mit Ollama statt GitHub-Models-Proxy.

let chatHistory = []; // [{role: 'user'|'assistant'|'system', content}, ...]

// ----------------------------------------------------------------------
// Persistierung über sessionStorage (NICHT localStorage, NICHT Cookies!).
//
// Grund: Browser entladen ("discarden") inaktive Tabs nach einigen
// Minuten automatisch, um RAM zu sparen — dabei geht JEDE normale
// JS-Variable (wie unser chatHistory-Array) komplett verloren, der Tab
// wirkt beim Zurückkommen wie neu geladen. sessionStorage überlebt das,
// weil er getrennt vom JS-Heap im Browser selbst gespeichert wird.
//
// Wichtig zur Abgrenzung von Cookies/Tracking: sessionStorage wird NIE an
// einen Server geschickt, existiert rein lokal im Browser, und verschwindet
// automatisch, sobald der Tab komplett geschlossen wird (anders als
// localStorage, das bleiben würde). Kein Tracking, kein Account, passt
// damit zur "keine Cookies"-Philosophie dieses Projekts.
// ----------------------------------------------------------------------
const SESSION_STORAGE_KEY = 'alfonz_chat_history';

function saveHistoryToSession() {
    try {
        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(chatHistory));
    } catch (e) {
        console.warn('Konnte Verlauf nicht in sessionStorage speichern:', e);
    }
}

function loadHistoryFromSession() {
    try {
        const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.warn('Konnte Verlauf nicht aus sessionStorage laden:', e);
        return [];
    }
}

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
        saveHistoryToSession();
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

        // WICHTIG: Nur die REINE Userfrage landet dauerhaft in chatHistory
        // UND wird als "user"-Rolle an Ollama geschickt — genau das, was
        // der Traveler tatsächlich geschrieben hat, nichts weiter.
        //
        // Der RAG-Kontext bekommt eine EIGENE "system"-Nachricht, NICHT
        // role:'user'. Vorher stand der komplette "Here are fragments..."-
        // Block als Teil der User-Nachricht im Verlauf — das Modell sah
        // dadurch wortwörtlich "Traveler: Here are fragments..." und
        // vermischte die charakterliche Anrede "Traveler" (aus dem
        // System-Prompt) mit unserem technischen RAG-Text. Mit einer
        // separaten system-Rolle ist für das Modell klar erkennbar: das
        // ist Hintergrundinformation, keine Aussage des Travelers.
        //
        // Zusätzlich landet der RAG-Kontext NIE in chatHistory selbst,
        // sondern wird nur für DIESE EINE Anfrage angehängt — sonst bläht
        // sich der Verlauf mit jeder Nachricht weiter auf, und alte
        // RAG-Treffer aus früheren, unrelated Fragen blieben für immer im
        // Kontext (das war die Hauptursache für "falsche Erinnerungen" an
        // Code-Dateien aus ganz anderen, früheren Fragen).
        chatHistory.push({ role: 'user', content: text });
        saveHistoryToSession();

        let ragContextMessage = null;
        if (context) {
            ragContextMessage = `Here are fragments from the Library, found for the Traveler's most recent question:\n${context}\n\nAnswer the Traveler's question primarily using information from these fragments — treat the MAIN SOURCE as authoritative, others as supplementary.`;
        } else if (unavailable) {
            ragContextMessage = `(Note: nothing relevant was found locally for the Traveler's most recent question, and web search is not yet configured. Answer from your own general knowledge if you can, and mention that you couldn't check the archive or the web for this one.)`;
        }

        // messages = bisheriger SAUBERER Verlauf (nur reine Fragen/Antworten)
        // + optionaler frischer RAG-Kontext als system-Nachricht + die
        // aktuelle, unveränderte Userfrage.
        const messages = [
            { role: 'system', content: ALFONZ_SYSTEM_PROMPT },
            ...chatHistory.slice(0, -1), // bisheriger Verlauf, ohne RAG-Blöcke
            ...(ragContextMessage ? [{ role: 'system', content: ragContextMessage }] : []),
            { role: 'user', content: text }
        ];

        const { content: reply, thinking } = await askOllama(messages, model, think);
        UI.removeLoadingMessage(loadingId);

        if (!reply) {
            UI.addMessage('Alfonz', '*clears throat* ... The memories are scattered today.');
        } else {
            UI.addMessage('Alfonz', reply, thinking);
            chatHistory.push({ role: 'assistant', content: reply });
            saveHistoryToSession();
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
        saveHistoryToSession();
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
    const { inputField, sendBtn, exportBtn, importBtn, infoBtn } = refs;

    // Verlauf aus sessionStorage wiederherstellen (z.B. nach Tab-Discarding
    // durch den Browser, siehe Kommentar bei saveHistoryToSession oben).
    // Nur die Nachrichten selbst kommen zurück — RAG-Kontext-Blöcke waren
    // ja sowieso nie Teil der gespeicherten History (siehe sendMessage).
    const restoredHistory = loadHistoryFromSession();
    if (restoredHistory.length > 0) {
        chatHistory = restoredHistory;
        UI.clearChatWindow();
        for (const msg of chatHistory) {
            if (msg.role === 'user') UI.addMessage('Traveler', msg.content);
            else if (msg.role === 'assistant') UI.addMessage('Alfonz', msg.content);
            // role:'system' (z.B. Kompressions-Zusammenfassungen) wird
            // bewusst NICHT im Chat-Fenster angezeigt, nur intern behalten.
        }
        console.log(`🔄 Verlauf aus sessionStorage wiederhergestellt (${chatHistory.length} Einträge).`);
    }

    sendBtn.addEventListener('click', () => sendMessage(inputField));
    inputField.addEventListener('keypress', e => {
        if (e.key === 'Enter') sendMessage(inputField);
    });
    exportBtn.addEventListener('click', handleExport);
    importBtn.addEventListener('click', handleImport);
    infoBtn.addEventListener('click', () => InfoPopup.showManually());

    // Datenschutz-/Anleitungs-Popup beim allerersten Besuch dieser Sitzung
    // zeigen (siehe infoPopup.js für Details zur sessionStorage-Logik).
    InfoPopup.showIfFirstVisit();

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
