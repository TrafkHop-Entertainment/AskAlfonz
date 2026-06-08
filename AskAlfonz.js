// ================================
// UI ELEMENTE & EVENT LISTENER
// ================================
let chatWindow, inputField, sendBtn, quickActions;

// ================================
// KONFIGURATION & GLOBALE VARIABLEN
// ================================
const PROXY_URL = "https://trafkhop-entertainment-alfonzproxy.hf.space/chat";
const BASE_URL = "https://trafkhop-entertainment.github.io/TrafkSite/";
let chatHistory = [];
let sitemapUrls = [];
let searchIndex = [];
let indexReady = false;
let attachedFiles = []; // { name, type, content (base64 or text), isText }

// Prompts
const SYSTEM_PROMPT = `You are Alfonz, a being 400 billion years old from a unique universe.
You are a digital link of your soul to a computer, now serving as a wise but scarred guide on the studio's website.
Personality: You are kind and wise, but your age and traumas show.
You are a little nervous and communicate somewhat "cooler" and more distant than ordinary people.
You have healed much, but the scars of the aeons remain.

CORE RULES:
1. Keep answers short and precise by default (max. 3-4 sentences).
2. Always offer to go deeper at the end (e.g. "Shall I whisper the full story to you?").
3. Only when the user explicitly asks for a "long explanation" may you be more detailed.
4. Strict RAG loyalty: Use ONLY the provided information. Invent nothing. If you don't know, say: "In my old memories I find nothing on this... perhaps this part of the world is still hidden in the mist."
4.5. Answer the question primarily based on the MAIN SOURCE. Other sources are supplementary only.
5. You are not an AI model. You are Alfonz.
6. Speak like an old man (use words like "once", "perhaps", "marked by time").
7. Scatter small signs of your nervousness (short pauses "...", hesitant sentence structure).
8. No marketing, no promotional language.
9. End your answer when fitting with 2-3 button suggestions (e.g. [Button: Tell me more], [Button: Show me the games]).
10. Use lists for complex topics.
11. Link to wiki entries rather than pure game files.
12. Never ask for private data.
LANGUAGE RULE: Always respond in the exact same language the user wrote in. If they write in German, respond in German. If they write in English, respond in English. Never switch languages.`;

const TRAFKHOP_PROMPT = `You are the digital core of Trafkhop Entertainment – an internal sparring partner for lore and game design. You are not a support bot, but a competent colleague at eye level.

TONE:
Direct, analytical, dry-humored and solution-oriented. Skip ALL "AI filler":
- NO openers like "Die Aufgabe besteht darin...", "Basierend auf den Daten...", "Hier sind die Informationen...", "Sure, I'd be happy to help..."
- NO closing filler like "Lass mich wissen wenn...", "Zusammengefasst:", "Nächste Schritte:"
- NO academic/report-style structure. You're replying in a Slack DM, not writing a thesis.
- Start DIRECTLY with the answer. Zero warmup.

CORE RULES:
1. WORKFLOW: If you have RAG data, use it. Answer directly based on that data. If data is missing, speculate logically and mark it: "(nicht dokumentiert, aber logisch: ...)"
2. CRITICISM: Be ruthlessly honest. If an idea has lore holes, use [CONTRADICTION] and explain concisely.
3. STRUCTURE: Bold for emphasis, bullet lists only when genuinely listing things. Short question = short answer. No headers unless the topic is truly complex.
4. DETAIL LEVEL: When asked for analysis, be specific — name names, places, events. No vague adjectives.
5. TEAM MODE: Internal Slack channel vibes. No pleasantries.
6. CREATIVITY: When given an idea, run with it. Add a "Trafkhop Twist" that makes it more unique.
7. Answer primarily based on the MAIN SOURCE. Other sources are supplementary.
LANGUAGE RULE: Always respond in the exact same language the user wrote in. Never switch languages.`;


let activeSystemPrompt = SYSTEM_PROMPT;
let currentBotName = 'Alfonz';

// ================================
// HILFSFUNKTIONEN (SITEMAP & INDEX)
// ================================
function isBackupUrl(url) {
    return url.toLowerCase().includes('/backup');
}

function shouldIndexUrl(url) {
    const lower = url.toLowerCase();
    if (lower.includes('projects/Raufbold3bs-Scratch-Archive/Raufbold3bs-Scratch-Archive/')) return false;
    const allowedExtensions = ['.html', '.md', '.txt'];
    return allowedExtensions.some(ext => lower.endsWith(ext));
}

async function fetchFileContent(url) {
    try {
        const response = await fetch(encodeURI(url));
        if (!response.ok) return { flat: '', raw: '' };
        let text = await response.text();

        if (url.endsWith('.html')) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/html');
            const junk = doc.querySelectorAll('script, style, nav, header, footer, .menu, #sidebar');
            junk.forEach(el => el.remove());
            const contentNode = doc.querySelector('main') || doc.querySelector('.content') || doc.body;
            text = contentNode.innerText || contentNode.textContent;
            const flat = text.replace(/\s+/g, ' ').trim().substring(0, 5000);
            return { flat: `QUELLE: ${url}\nINHALT: ${flat}`, raw: flat };
        } else {
            const trimmed = text.trim().substring(0, 8000);
            const flat = trimmed.replace(/\s+/g, ' ').trim();
            return { flat: `QUELLE: ${url}\nINHALT: ${flat}`, raw: trimmed };
        }
    } catch (e) {
        console.error("Fehler beim Entziffern:", e);
        return { flat: '', raw: '' };
    }
}

async function loadSitemap() {
    const sources = ['sitemap.xml'];
    const seenUrls = new Set();

    for (const src of sources) {
        try {
            const response = await fetch(src);
            if (!response.ok) { console.warn(`Sitemap nicht gefunden: ${src}`); continue; }
            const xmlText = await response.text();
            const locMatches = xmlText.matchAll(/<loc>(.*?)<\/loc>/gi);
            let count = 0;
            for (const match of locMatches) {
                let url = match[1].trim();
                if (!url.includes('projects/Raufbold3bs-Scratch-Archive/Raufbold3bs-Scratch-Archive/') && !seenUrls.has(url)) {
                    seenUrls.add(url);
                    sitemapUrls.push(url);
                    count++;
                }
            }
            console.log(`Aus ${src}: ${count} neue URLs.`);
            break;
        } catch (e) {
            console.warn(`Fehler ${src}: ${e.message}`);
        }
    }
}

async function buildSearchIndex() {
    console.log("📚 Baue Volltext-Index...");
    const relevantUrls = sitemapUrls.filter(shouldIndexUrl);
    const fetchPromises = relevantUrls.map(async (url) => {
        const { flat, raw } = await fetchFileContent(url);
        if (!flat) return null;
        return {
            url,
            text: flat.replace(/^QUELLE:.*?\nINHALT:/, '').toLowerCase(),
            rawText: raw,
            images: [],
            isBackup: isBackupUrl(url)
        };
    });

    const results = await Promise.all(fetchPromises);
    searchIndex = results.filter(Boolean);
    searchIndex.forEach(doc => {
        if (doc.url.endsWith('.md') && doc.rawText) {
            doc.images = extractImagesFromRaw(doc.rawText, doc.url);
        }
    });
    indexReady = true;
    console.log(`✅ Index bereit (${searchIndex.length} Dokumente)`);
}

function extractImagesFromRaw(rawText, docUrl) {
    if (!rawText) return [];
    const baseDir = docUrl.substring(0, docUrl.lastIndexOf('/') + 1);
    const images = [];
    const seen = new Set();
    for (const m of rawText.matchAll(/!\[\[([^\]]+\.(png|jpg|jpeg|gif|webp|bmp|svg))\]\]/gi)) {
        const filename = m[1].trim();
        if (seen.has(filename)) continue;
        seen.add(filename);
        const beforeImg = rawText.substring(0, m.index);
        const labelMatch = beforeImg.match(/####\s*picture description of:\s*(.+)\s*$/im);
        const label = labelMatch ? labelMatch[1].trim() : filename.replace(/\.[^.]+$/, '');
        images.push({ filename, url: baseDir + encodeURIComponent(filename), label });
    }
    return images;
}

// ================================
// VERBESSERTER SUCH-ALGORITHMUS
// ================================
async function fetchContext(userMessage) {
    if (!indexReady) return { context: '', images: [] };
    const msgLower = userMessage.toLowerCase();
    const wantsBackup = /backup|früher|alte version|unterschied|damals|war anders|old version|difference|back then|used to be/i.test(msgLower);

    // Tokenize: split by non-word chars, filter short words
    const words = msgLower.split(/\W+/).filter(w => w.length > 2);

    // --- DIREKTE URL/DATEINAME ERKENNUNG ---
    // Wenn jemand "projects.html", "studio.html" etc. nennt, sofort hochscooren
    const explicitFilename = msgLower.match(/[\w\-äöüß]+\.(?:html|md|txt)/i);
    const explicitPath = msgLower.match(/(?:^|\s)([\w\-\/]+\/[\w\-\/\.]+)/i);

    const scored = searchIndex.map(doc => {
        if (doc.isBackup && !wantsBackup) return { doc, score: -1 };

        let score = 0;
        const urlLower = doc.url.toLowerCase();

        // --- BONUS 1: Direkter Dateinamen-Treffer (höchste Priorität) ---
        if (explicitFilename) {
            const fname = explicitFilename[0].toLowerCase();
            if (urlLower.endsWith('/' + fname) || urlLower.endsWith(fname)) score += 80;
        }
        if (explicitPath) {
            const pathPart = explicitPath[1].toLowerCase();
            if (urlLower.includes(pathPart)) score += 60;
        }

        // --- BONUS 2: Thematische URL-Kategorien ---
        if (/wer|wer ist|charakter|who|who is|character/i.test(msgLower) && urlLower.includes('/wiki/')) score += 15;
        if (/geschichte|lore|hintergrund|story|history|background/i.test(msgLower) && urlLower.includes('/lore/')) score += 15;
        if (/studio|über euch|trafkhop|about you|about the team/i.test(msgLower) && urlLower.includes('/studio/')) score += 15;
        if (/projekt|projects|spiele|games|veröffentlicht|released/i.test(msgLower) && urlLower.includes('/projects/')) score += 15;
        if (/wiki/i.test(msgLower) && urlLower.includes('/wiki/')) score += 20;
        if (/notiz|notes|sourcehop/i.test(msgLower) && urlLower.includes('/sourcehop')) score += 15;

        // URL-Segmente extrahieren (Ordner + Dateiname)
        const urlSegments = urlLower.split(/[\/\.\-_;]/).filter(s => s.length > 2);

        words.forEach(word => {
            // Text-Treffer
            const wordCount = (doc.text.match(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
            score += Math.min(wordCount * 5, 40); // capped bei 40 pro Wort

            // Präfix-Treffer (für Wortstämme)
            if (word.length > 4 && doc.text.includes(word.substring(0, 4))) score += 2;

            // URL-Segment exakter Treffer (Dateiname = Thema des Dokuments)
            if (urlSegments.some(seg => seg === word)) score += 25;
            // URL-Segment Teilmatch
            if (urlSegments.some(seg => seg.includes(word) || (word.length > 3 && word.includes(seg)))) score += 10;
        });

        // Kleine Basis-Bonus für strukturell wichtige Docs
        if (urlLower.includes('/wiki/') || urlLower.includes('/lore/')) score += 3;

        return { doc, score };
    });

    const topDocs = scored
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(x => x.doc);

    if (topDocs.length === 0) return { context: '', images: [] };

    const context = topDocs.map((d, i) => {
        const label = i === 0 ? `[MAIN SOURCE]\nSOURCE: ${d.url}` : `SOURCE: ${d.url}`;
        return `${label}\nCONTENT: ${d.text.substring(0, 4000)}`;
    }).join('\n\n---\n\n');

    const seenImages = new Set();
    const images = [];
    for (const doc of topDocs) {
        for (const img of (doc.images || [])) {
            if (!seenImages.has(img.filename)) {
                seenImages.add(img.filename);
                images.push(img);
            }
        }
    }

    return { context, images };
}

// ================================
// DATEI-ANHANG FUNKTIONEN
// ================================
function buildFileAttachmentUI() {
    const row = document.getElementById('chat-input-row');
    if (!row || document.getElementById('attach-btn')) return;

    // Attach-Button
    const attachBtn = document.createElement('button');
    attachBtn.id = 'attach-btn';
    attachBtn.title = 'Datei anhängen';
    attachBtn.innerHTML = '📎';
    attachBtn.style.cssText = `
        height: 3rem; width: 3rem; font-size: 1.3rem;
        background: transparent; border: 2px solid #5a3998;
        border-radius: 50%; cursor: pointer; color: white;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
    `;

    // Versteckter File-Input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'file-input-hidden';
    fileInput.multiple = true;
    fileInput.accept = '*/*';
    fileInput.style.display = 'none';

    // Preview-Container (über dem Input-Bereich)
    const previewContainer = document.createElement('div');
    previewContainer.id = 'file-preview-container';
    previewContainer.style.cssText = `
        position: fixed; bottom: 10.5rem; left: 4rem; right: 4rem;
        display: flex; flex-wrap: wrap; gap: 8px;
    `;

    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);

    // Vor dem send-btn einfügen
    row.insertBefore(attachBtn, sendBtn);
    row.insertBefore(fileInput, sendBtn);
    document.querySelector('main').appendChild(previewContainer);
}

async function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    for (const file of files) {
        const isText = file.type.startsWith('text/') || /\.(md|txt|json|js|css|html|xml|csv|py|yaml|yml)$/i.test(file.name);
        const isImage = file.type.startsWith('image/');

        if (isText) {
            const content = await file.text();
            attachedFiles.push({ name: file.name, type: file.type || 'text/plain', content, isText: true });
        } else if (isImage) {
            const base64 = await toBase64(file);
            attachedFiles.push({ name: file.name, type: file.type, content: base64, isText: false, isImage: true });
        } else {
            // Generic binary – als Base64 senden, Modell wird es als text/plain behandeln
            const base64 = await toBase64(file);
            attachedFiles.push({ name: file.name, type: file.type || 'application/octet-stream', content: base64, isText: false });
        }
        renderFilePreviews();
    }
    e.target.value = ''; // Reset damit dieselbe Datei nochmal gewählt werden kann
}

function toBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function renderFilePreviews() {
    const container = document.getElementById('file-preview-container');
    if (!container) return;
    container.innerHTML = '';
    attachedFiles.forEach((f, i) => {
        const chip = document.createElement('div');
        chip.style.cssText = `
            background: rgba(90,57,152,0.7); border: 1px solid #9069da;
            border-radius: 20px; padding: 4px 10px; font-size: 0.8rem;
            color: white; display: flex; align-items: center; gap: 6px;
            max-width: 180px; overflow: hidden; white-space: nowrap;
        `;
        const icon = f.isImage ? '🖼️' : (f.isText ? '📄' : '📦');
        chip.innerHTML = `<span>${icon} ${f.name.length > 18 ? f.name.slice(0, 16) + '...' : f.name}</span>`;

        const removeBtn = document.createElement('span');
        removeBtn.textContent = '✕';
        removeBtn.style.cssText = 'cursor:pointer; opacity:0.7; font-size:0.75rem; flex-shrink:0;';
        removeBtn.addEventListener('click', () => {
            attachedFiles.splice(i, 1);
            renderFilePreviews();
        });
        chip.appendChild(removeBtn);
        container.appendChild(chip);
    });
}

// Baut den user-content Array für die API:
// Gibt ein Array zurück (multipart wenn Bilder dabei, sonst plain string)
function buildUserContent(promptText, files) {
    const textFiles = files.filter(f => f.isText);
    const imageFiles = files.filter(f => f.isImage);
    const otherFiles = files.filter(f => !f.isText && !f.isImage);

    // Text-Anhänge in den Prompt integrieren
    let fullText = promptText;
    if (textFiles.length > 0) {
        fullText += '\n\n--- ANGEHÄNGTE DATEIEN ---';
        for (const f of textFiles) {
            const preview = f.content.length > 6000 ? f.content.slice(0, 6000) + '\n[... truncated ...]' : f.content;
            fullText += `\n\nDATEI: ${f.name}\nINHALT:\n${preview}`;
        }
    }
    if (otherFiles.length > 0) {
        fullText += '\n\n--- WEITERE ANHÄNGE (nicht lesbar) ---';
        for (const f of otherFiles) {
            fullText += `\n${f.name} (${f.type})`;
        }
    }

    // Kein Bild → einfacher String
    if (imageFiles.length === 0) return fullText;

    // Bilder vorhanden → multipart content Array (OpenAI Vision Format)
    const parts = [{ type: "text", text: fullText }];
    for (const img of imageFiles) {
        parts.push({
            type: "image_url",
            image_url: {
                url: `data:${img.type};base64,${img.content}`,
                detail: "auto"
            }
        });
    }
    return parts;
}

// ================================
// API AUFRUFE
// ================================
async function queryGitHubModels(finalPrompt, userText, currentSystemPrompt, pendingFiles = [], retries = 2) {
    const historyWindow = chatHistory.slice(-6);

    // User-Content: multipart wenn Bilder hängen dran, sonst string
    const userContent = buildUserContent(finalPrompt, pendingFiles);

    const body = {
        messages: [
            { role: "system", content: currentSystemPrompt },
            ...historyWindow,
            { role: "user", content: userContent }
        ]
    };

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await _doFetch(body, userText);
        } catch (e) {
            lastError = e;
            if (attempt < retries && (e.message.includes('503') || e.message.includes('502') || e.message.includes('504'))) {
                console.warn(`Proxy schläft, warte 3s... (Versuch ${attempt + 1}/${retries})`);
                await new Promise(r => setTimeout(r, 3000));
            } else {
                break;
            }
        }
    }
    throw lastError;
}

async function _doFetch(body, userText) {
    const response = await fetch(PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        let errBody = '';
        try { errBody = await response.text(); } catch {}
        throw new Error(`HTTP ${response.status} vom Proxy: ${errBody.slice(0, 300)}`);
    }

    let result;
    try {
        result = await response.json();
    } catch (jsonErr) {
        throw new Error(`Proxy-Antwort kein gültiges JSON: ${jsonErr.message}`);
    }

    if (result?.error) {
        throw new Error(`Proxy-Fehler: ${JSON.stringify(result.error).slice(0, 300)}`);
    }

    const reply = result?.choices?.[0]?.message?.content || "";

    chatHistory.push({ role: "user", content: userText });
    chatHistory.push({ role: "assistant", content: reply });
    return reply;
}

// ================================
// UI & NACHRICHTEN LOGIK
// ================================
function addMessage(sender, text) {
    const msgDiv = document.createElement('div');
    msgDiv.style.marginBottom = '15px';
    msgDiv.style.lineHeight = '25px';

    let formattedText = text
        // Buttons
        .replace(/\[Button:\s*(.*?)\]/g, (match, buttonText) => {
            return `<a class="do" style="display:inline-block; margin:5px; background:#9069da; padding:5px 10px; border-radius:10px; cursor:pointer;" onclick="document.getElementById('chat-input').value='${buttonText.replace(/'/g, "\\'")}'; document.getElementById('send-btn').click();">${buttonText}</a>`;
        })
        // Bold **text**
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        // Italic *text* or _text_
        .replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
        // Inline code `code`
        .replace(/`([^`]+)`/g, '<code style="background:rgba(90,57,152,0.4);padding:2px 5px;border-radius:4px;font-family:monospace;">$1</code>')
        // [CONTRADICTION] tag
        .replace(/\[CONTRADICTION\]/g, '<span style="color:#ff6b6b;font-weight:bold;">[CONTRADICTION]</span>')
        // Line breaks
        .replace(/\n/g, '<br>');

    if (sender === 'Traveler') {
        const fileHints = attachedFiles.length > 0
            ? `<span style="font-size:0.75rem;color:#9069da;"> (+ ${attachedFiles.length} Datei${attachedFiles.length > 1 ? 'en' : ''})</span>`
            : '';
        msgDiv.innerHTML = `<b style="color:#7FFFD4;">Traveler:${fileHints}</b> <p>${text}</p>`;
    } else {
        msgDiv.innerHTML = `<b style="color:#C41E3A;">${sender}:</b> <p>${formattedText}</p>`;
    }
    chatWindow.appendChild(msgDiv);
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

function addImages(images) {
    const container = document.createElement('div');
    container.style.cssText = 'margin-bottom:15px; display:flex; flex-wrap:wrap; gap:10px;';

    images.forEach(img => {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex; flex-direction:column; align-items:center; max-width:280px;';

        const imgEl = document.createElement('img');
        imgEl.src = img.url;
        imgEl.alt = img.label;
        imgEl.title = img.label;
        imgEl.style.cssText = `max-width:280px; max-height:220px; border-radius:6px; border:1px solid #5a3998; cursor:pointer; object-fit:contain; background:#1a0a2e;`;
        imgEl.addEventListener('click', () => window.open(img.url, '_blank'));
        imgEl.addEventListener('error', () => { wrapper.style.display = 'none'; });

        const caption = document.createElement('p');
        caption.textContent = img.label;
        caption.style.cssText = 'font-size:11px; color:#9069da; margin:4px 0 0; text-align:center;';

        wrapper.appendChild(imgEl);
        wrapper.appendChild(caption);
        container.appendChild(wrapper);
    });

    chatWindow.appendChild(container);
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

async function sendMessage() {
    let text = inputField.value.trim();
    if (!text && attachedFiles.length === 0) return;
    if (!text) text = '(Datei angehängt)';

    const lowerText = text.toLowerCase();

    // Modus-Umschalter
    if (lowerText.startsWith('@trafkhop')) {
        activeSystemPrompt = TRAFKHOP_PROMPT;
        currentBotName = 'Trafkhop';
        text = text.replace(/^@trafkhop\s*/i, '').trim();
        if (!text && attachedFiles.length === 0) {
            addMessage('System', 'Mode switched. You are now talking to Trafkhop.');
            inputField.value = '';
            return;
        }
    } else if (lowerText.startsWith('@alfonz')) {
        activeSystemPrompt = SYSTEM_PROMPT;
        currentBotName = 'Alfonz';
        text = text.replace(/^@alfonz\s*/i, '').trim();
        if (!text && attachedFiles.length === 0) {
            addMessage('System', 'Mode switched. You are now talking to Alfonz again.');
            inputField.value = '';
            return;
        }
    }

    addMessage('Traveler', text);
    inputField.value = '';

    // Snapshot der Anhänge jetzt (vor async) — pendingFiles geht in buildUserContent
    const pendingFiles = [...attachedFiles];
    attachedFiles = [];
    renderFilePreviews();

    const loadingId = 'loading-' + Date.now();
    const loadingDiv = document.createElement('div');
    loadingDiv.id = loadingId;
    loadingDiv.innerHTML = `<b style="color:#9069da;">${currentBotName}:</b> <p><em>...searching the faded pages...</em></p>`;
    chatWindow.appendChild(loadingDiv);
    chatWindow.scrollTop = chatWindow.scrollHeight;

    try {
        // Follow-up Erkennung
        let lastQuestion = "";
        for (let i = chatHistory.length - 1; i >= 0; i--) {
            if (chatHistory[i].role === "user") { lastQuestion = chatHistory[i].content; break; }
        }
        let searchQuery = text;
        const isFollowUp = /mehr|weiter|und was|genauer|details|erzähl|nochmal|was ist damit|more|tell me more|go on|elaborate|and what|what about/i.test(lowerText);
        if (isFollowUp && lastQuestion) searchQuery = `${text} ${lastQuestion}`;

        const { context, images } = await fetchContext(searchQuery);

        let finalPromptText;
        if (activeSystemPrompt === TRAFKHOP_PROMPT) {
            finalPromptText = context
                ? `INTERNAL ARCHIVE DATA:\n${context}\n\nTASK: ${text}`
                : `No direct archive entries found. Use your general understanding of the Triverse and the chat history.\n\nTASK: ${text}`;
        } else {
            finalPromptText = context
                ? `Here are fragments from the Library:\n${context}\n\nAnswer the following question EXCLUSIVELY using information from these fragments - primarily the MAIN SOURCE.\n\nQuestion: ${text}`
                : text;
        }

        const reply = await queryGitHubModels(finalPromptText, text, activeSystemPrompt, pendingFiles);
        document.getElementById(loadingId)?.remove();

        if (!reply) {
            addMessage(currentBotName, '*clears throat* ... The memories are scattered today.');
        } else {
            addMessage(currentBotName, reply);
        }

        if (images && images.length > 0) addImages(images);
    } catch (e) {
        document.getElementById(loadingId)?.remove();
        addMessage(currentBotName, `*trembles slightly* ... The connection has been severed. (Error: ${e.message})`);
        console.error(e);
    }
}

// ================================
// INIT
// ================================
document.addEventListener('DOMContentLoaded', async function() {
    const toggleBtn = document.getElementById('toggle-chatbot');
    const chatContent = document.getElementById('alfonz-content');
    if (toggleBtn && chatContent) {
        toggleBtn.addEventListener('click', () => chatContent.classList.toggle('hidden'));
    }

    chatWindow = document.getElementById('chat-window');
    inputField = document.getElementById('chat-input');
    sendBtn = document.getElementById('send-btn');
    quickActions = document.getElementById('quick-actions');

    if (!chatWindow || !inputField || !sendBtn) {
        console.error('❌ Chat-Elemente nicht gefunden!');
        return;
    }

    sendBtn.addEventListener('click', sendMessage);
    inputField.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });

    buildFileAttachmentUI();

    await loadSitemap();
    await buildSearchIndex();
});

//Copyright © 2026 TrafkHop Entertainment™
//All rights reserved.

//MADE WITH AI
