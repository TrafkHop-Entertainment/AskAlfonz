// js/chatExport.js
// Manueller Export/Import des Chatverlaufs als Markdown-Datei.
// Nutzt die File System Access API (Chrome/Edge), damit der Verlauf
// direkt in einen vom User gewählten Ordner gespeichert/geladen wird —
// kein Download-Ordner-Chaos, kein Cookie, kein Account.
//
// WICHTIG: Diese API ist nur in Chromium-Browsern verfügbar (Chrome, Edge,
// Opera). In Firefox/Safari fallen wir auf den klassischen Download/Upload
// zurück, damit es dort trotzdem funktioniert.

const ChatExport = (() => {

    const hasFileSystemAccess = 'showSaveFilePicker' in window;

    // Wandelt chatHistory ([{role, content}, ...]) in lesbares Markdown um.
    function historyToMarkdown(chatHistory) {
        const date = new Date().toISOString().slice(0, 19).replace('T', ' ');
        let md = `# Ask Alfonz — Gespräch vom ${date}\n\n`;

        for (const msg of chatHistory) {
            if (msg.role === 'system') {
                md += `> _[System: ${msg.content}]_\n\n`;
            } else if (msg.role === 'user') {
                md += `**Traveler:** ${msg.content}\n\n`;
            } else if (msg.role === 'assistant') {
                md += `**Alfonz:** ${msg.content}\n\n`;
            }
        }
        return md;
    }

    // Parst ein zuvor exportiertes Markdown wieder zurück in chatHistory.
    // Bewusst simpel gehalten — geht von genau dem Format aus, das wir
    // selbst beim Export erzeugen (siehe historyToMarkdown).
    function markdownToHistory(md) {
        const history = [];
        const lines = md.split('\n');
        let current = null;

        for (const line of lines) {
            const userMatch = line.match(/^\*\*Traveler:\*\*\s*(.*)$/);
            const botMatch = line.match(/^\*\*Alfonz:\*\*\s*(.*)$/);

            if (userMatch) {
                if (current) history.push(current);
                current = { role: 'user', content: userMatch[1] };
            } else if (botMatch) {
                if (current) history.push(current);
                current = { role: 'assistant', content: botMatch[1] };
            } else if (current && line.trim() !== '' && !line.startsWith('#') && !line.startsWith('>')) {
                // Mehrzeilige Antworten: weitere Zeilen an die aktuelle Nachricht anhängen
                current.content += '\n' + line;
            }
        }
        if (current) history.push(current);
        return history;
    }

    // --------------------------------------------------------------
    // Export
    // --------------------------------------------------------------
    async function exportChat(chatHistory) {
        const markdown = historyToMarkdown(chatHistory);
        const filename = `alfonz-chat-${Date.now()}.md`;

        if (hasFileSystemAccess) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }]
                });
                const writable = await handle.createWritable();
                await writable.write(markdown);
                await writable.close();
                return { ok: true };
            } catch (e) {
                if (e.name === 'AbortError') return { ok: false, cancelled: true };
                console.warn('File System Access Export fehlgeschlagen, nutze Download-Fallback:', e);
                // fällt durch zum Fallback unten
            }
        }

        // Fallback: klassischer Browser-Download (Firefox/Safari oder falls obiges scheitert)
        const blob = new Blob([markdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        return { ok: true, viaFallback: true };
    }

    // --------------------------------------------------------------
    // Import
    // --------------------------------------------------------------
    async function importChat() {
        if (hasFileSystemAccess) {
            try {
                const [handle] = await window.showOpenFilePicker({
                    types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }]
                });
                const file = await handle.getFile();
                const text = await file.text();
                return { ok: true, history: markdownToHistory(text) };
            } catch (e) {
                if (e.name === 'AbortError') return { ok: false, cancelled: true };
                console.warn('File System Access Import fehlgeschlagen, nutze Upload-Fallback:', e);
                // fällt durch zum Fallback unten
            }
        }

        // Fallback: klassisches <input type="file">
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.md,text/markdown';
            input.onchange = async () => {
                const file = input.files[0];
                if (!file) { resolve({ ok: false, cancelled: true }); return; }
                const text = await file.text();
                resolve({ ok: true, history: markdownToHistory(text) });
            };
            input.click();
        });
    }

    return { exportChat, importChat, hasFileSystemAccess };
})();
