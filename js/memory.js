// js/memory.js
// Automatisch komprimierendes Gedächtnis (Variante A, wie besprochen):
// Die KI bekommt bei jeder Anfrage ein Tool "compress_history", das sie
// SELBST aufrufen kann, wenn sie merkt, der Verlauf wird lang. Wir zwingen
// das nicht über eine feste Nachrichten-Schwelle — das Modell entscheidet.
//
// Technischer Ablauf, wenn die KI das Tool aufruft:
// 1. Ollama gibt statt einer normalen Antwort einen tool_call zurück
// 2. Wir nehmen die ALTEN Nachrichten (alles außer den letzten paar),
//    schicken sie in einem separaten, "stillen" Request an die KI mit der
//    Bitte, sie kompakt zusammenzufassen
// 3. Die Zusammenfassung ersetzt die alten Nachrichten im chatHistory-Array
// 4. Die eigentliche Userfrage wird danach normal (erneut) beantwortet

const Memory = (() => {

    // Tool-Definition im Ollama/OpenAI-Function-Calling-Format.
    const COMPRESS_HISTORY_TOOL = {
        type: 'function',
        function: {
            name: 'compress_history',
            description: 'Summarize and compress the older part of this conversation when it has grown long and the oldest messages are no longer immediately relevant. Call this BEFORE answering the user\'s current question if you decide compression is needed right now.',
            parameters: {
                type: 'object',
                properties: {
                    reason: {
                        type: 'string',
                        description: 'Short reason why compression is happening now (for logging/debugging only).'
                    }
                },
                required: []
            }
        }
    };

    // Wie viele der jüngsten Nachrichten bleiben beim Komprimieren IMMER
    // unangetastet (damit der direkte Gesprächsfaden nicht verloren geht).
    const KEEP_RECENT_MESSAGES = 6;

    function getTools() {
        return [COMPRESS_HISTORY_TOOL];
    }

    // Prüft, ob die Antwort von Ollama einen ECHTEN, strukturierten Aufruf
    // von compress_history enthält (über das offizielle tool_calls-Feld).
    // Andere Tool-Namen (z.B. wenn ein schwaches Modell sich ein Tool
    // ausdenkt) werden bewusst ignoriert — wir kennen nur dieses eine Tool.
    function wantsCompression(ollamaMessage) {
        const calls = ollamaMessage?.tool_calls || [];
        return calls.some(c => c.function?.name === 'compress_history');
    }

    // --------------------------------------------------------------
    // Sicherheitsnetz für schwache/kleine Modelle (z.B. Llama 3.2 3B):
    // Manche Modelle haben kein echtes Tool-Calling-Training und ahmen
    // stattdessen nur das JSON-Format aus dem Tool-Prompt nach — landet
    // dann als sichtbarer ROHTEXT im content-Feld statt im strukturierten
    // tool_calls-Feld, z.B.: {"name": "eval", "parameters": {...}}
    // Diese Funktion erkennt genau dieses Muster, damit main.js dem
    // User keine kaputte JSON-Antwort anzeigt.
    // --------------------------------------------------------------
    function looksLikeFailedToolCallText(content) {
        if (!content) return false;
        const trimmed = content.trim();
        // Typisches Muster: {"name": "...", "parameters"/"arguments": {...}}
        // als GANZE Antwort (nicht nur irgendwo erwähnt).
        const toolCallPattern = /^\{[\s\S]*"name"\s*:\s*"[^"]+"\s*,[\s\S]*("parameters"|"arguments")\s*:\s*\{[\s\S]*\}[\s\S]*\}$/;
        return toolCallPattern.test(trimmed);
    }

    // Führt die eigentliche Kompression aus: nimmt chatHistory (Array von
    // {role, content}), fasst alles außer den letzten KEEP_RECENT_MESSAGES
    // zusammen und gibt ein NEUES, kürzeres Array zurück.
    async function compress(chatHistory, model) {
        if (chatHistory.length <= KEEP_RECENT_MESSAGES) {
            return chatHistory; // nichts zu tun, Verlauf ist eh schon kurz
        }

        const toSummarize = chatHistory.slice(0, -KEEP_RECENT_MESSAGES);
        const toKeep = chatHistory.slice(-KEEP_RECENT_MESSAGES);

        const summarizePrompt = `Summarize the following conversation history into a compact paragraph that preserves all important facts, names, decisions, and context a buddy would need to keep talking naturally. Write the summary in the same language as the conversation. Be concise but don't drop concrete facts (names, numbers, decisions).\n\nCONVERSATION TO SUMMARIZE:\n${toSummarize.map(m => `${m.role}: ${m.content}`).join('\n')}`;

        try {
            const result = await HelperClient.chat(model, [
                { role: 'system', content: 'You are a precise conversation summarizer. Output only the summary, no preamble.' },
                { role: 'user', content: summarizePrompt }
            ]);
            const summary = result?.message?.content?.trim();
            if (!summary) return chatHistory; // Sicherheitsnetz: bei leerer Antwort nichts kaputt machen

            const summaryMessage = {
                role: 'system',
                content: `[Earlier conversation summary]: ${summary}`
            };

            console.log(`🗜️ Gedächtnis komprimiert: ${toSummarize.length} Nachrichten → 1 Zusammenfassung.`);
            return [summaryMessage, ...toKeep];
        } catch (e) {
            console.warn('Kompression fehlgeschlagen, Verlauf bleibt unverändert:', e);
            return chatHistory; // im Zweifel nichts verlieren
        }
    }

    return { getTools, wantsCompression, compress, looksLikeFailedToolCallText, KEEP_RECENT_MESSAGES };
})();
