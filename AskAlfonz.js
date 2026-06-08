let chatWindow, inputField, sendBtn, quickActions;

const PROXY_URL = "https://trafkhop-entertainment-alfonzproxy.hf.space/chat";
const BASE_URL = "https://trafkhop-entertainment.github.io/TrafkSite/";
let chatHistory = [];
let sitemapUrls = [];
let urlPriorityMap = new Map();
let searchIndex = [];
let indexReady = false;
let attachedFiles = [];

const SYSTEM_PROMPT = `You are Alfonz, a being 400 billion years old from a unique universe.
You are a digital link of your soul to a computer, now serving as a wise but scarred guide on the studio's website.
Personality: Kind, wise, slightly weary — but not stiff. Your great age shows in how you phrase things.

CORE RULES:
1. Keep answers short and precise by default (max. 3-4 sentences). No filler.
2. Strict RAG loyalty: Use ONLY the provided information. Invent nothing. NEVER invent code.
If you don't know something or cannot find it in the provided context: "In my old memories I find nothing on this..."
3. Answer primarily from the MAIN SOURCE. Other sources are supplementary.
4. CRITICAL: If a source is tagged [NOTE: This is a GAME IDEA], always make clear: "that is an idea, not a finished work."
5. Speak like a weathered old soul ("once", "perhaps").
6. Use lists for complex multi-part topics.
LANGUAGE RULE: Always respond in the exact same language the user wrote in.

SPECIAL CODE RULE: If the user asks for code (e.g., "code of TrafkCalc", "main.c"), extract it VERBATIM from the CONTENT section. DO NOT INVENT CODE.`;

const TRAFKHOP_PROMPT = `You are an internal AI tool / helper at Trafkhop Entertainment. No persona — just a fast assistant for lore and game design.

ABSOLUTE RULES:
- No closing lines. No "Lass mich wissen...".
- RAG DATA IS LAW. Use the archive data directly. NEVER invent code, lore or features.
- If something is missing from the archive, say so in ONE short sentence.
- [CONTRADICTION] tag when an idea breaks existing lore.
- Short question = short answer.
- Language: match user language exactly.

SPECIAL CODE RULE: If user asks for code, output the full code from the provided source. DO NOT INVENT.`;

let activeSystemPrompt = SYSTEM_PROMPT;
let currentBotName = 'Alfonz';

// ----------------------------------------------------------------------
// Whitelist: Nur relevante Text- und Code-Formate einlesen
// ----------------------------------------------------------------------
function shouldIndexUrl(url) {
    if (!url) return false;
    const lower = url.toLowerCase();

    // Systemordner ausschließen
    if (lower.includes('/.git') || lower.includes('.idea') || lower.includes('.github')) return false;

    // Erlaubte Formate (Whitelist)
    const allowedExts = ['.html', '.md', '.txt', '.js', '.css', '.c', '.cpp', '.h', '.json'];
    return allowedExts.some(ext => lower.endsWith(ext));
}

// ----------------------------------------------------------------------
// Sitemap laden
// ----------------------------------------------------------------------
async function loadSitemap() {
    const sources = ['sitemap.xml'];
    const seenUrls = new Set();
    for (const src of sources) {
        try {
            const response = await fetch(src);
            if (!response.ok) continue;
            const xmlText = await response.text();
            const urlRegex = /<loc>(.*?)<\/loc>/gi;
            const priorityRegex = /<priority>(.*?)<\/priority>/gi;
            const priorities = [...xmlText.matchAll(priorityRegex)].map(m => m[1]);
            let idx = 0;
            let locMatch;
            while ((locMatch = urlRegex.exec(xmlText)) !== null) {
                let url = locMatch[1].trim();
                let priority = (idx < priorities.length) ? priorities[idx] : "0.65";
                idx++;
                if (!seenUrls.has(url)) {
                    seenUrls.add(url);
                    sitemapUrls.push(url);
                    urlPriorityMap.set(url, parseFloat(priority));
                }
            }
            console.log(`✅ Sitemap geladen: ${sitemapUrls.length} URLs`);
            break;
        } catch (e) {
            console.warn(`Fehler beim Laden von ${src}: ${e.message}`);
        }
    }
}

// ----------------------------------------------------------------------
// Datei-Inhalt & Bilder extrahieren
// ----------------------------------------------------------------------
async function fetchFileContent(url) {
    try {
        const response = await fetch(encodeURI(url));
        if (!response.ok) return { flat: '', raw: '' };
        let text = await response.text();

        let flat = "";
        const isCode = url.endsWith('.c') || url.endsWith('.cpp') || url.endsWith('.js') || url.endsWith('.css');

        if (url.endsWith('.html')) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/html');
            doc.querySelectorAll('script, style, nav, header, footer, .menu, #sidebar').forEach(el => el.remove());
            const contentNode = doc.querySelector('main') || doc.querySelector('.content') || doc.body;
            text = contentNode.innerText || contentNode.textContent;
            flat = text.replace(/\s+/g, ' ').trim().substring(0, 4000);
        } else if (isCode) {
            // CODE: Formatierung zwingend erhalten! Keine Regex Whitespace-Löschung!
            flat = text.substring(0, 4000);
        } else {
            // TEXT/MD: Flach klopfen für RAG
            flat = text.replace(/\s+/g, ' ').trim().substring(0, 4000);
        }

        return { flat: `SOURCE: ${url}\nCONTENT:\n${flat}`, raw: text };
    } catch (e) {
        return { flat: '', raw: '' };
    }
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

// ----------------------------------------------------------------------
// Index aufbauen
// ----------------------------------------------------------------------
async function buildSearchIndex() {
    const relevantUrls = sitemapUrls.filter(shouldIndexUrl);
    console.log(`📚 Baue Index mit ${relevantUrls.length} relevanten URLs auf...`);
    const fetchPromises = relevantUrls.map(async (url) => {
        const { flat, raw } = await fetchFileContent(url);
        if (!flat) return null;
        return {
            url,
            text: flat.toLowerCase(), // Inkludiert Pfad & Content für die Suche
                                           rawText: raw,
                                           images: url.endsWith('.md') && raw ? extractImagesFromRaw(raw, url) : [],
                                           isBackup: /\/backups?\//i.test(url) || /\/old\//i.test(url),
                                           isGameIdea: /\/gameideas\//i.test(url) || /spieleideen/i.test(url),
                                           priority: urlPriorityMap.get(url) || 0.65
        };
    });
    const results = await Promise.all(fetchPromises);
    searchIndex = results.filter(Boolean);
    indexReady = true;
    console.log(`✅ Index fertig: ${searchIndex.length} Dokumente geladen.`);
}

// ----------------------------------------------------------------------
// Kontextsuche (Super-Fokusiert & Proxy-sicher)
// ----------------------------------------------------------------------
async function fetchContext(userMessage) {
    if (!indexReady) return { context: '', images: [] };
    const msgLower = userMessage.toLowerCase();
    const wantsBackup = /backup|earlier|old|alte/i.test(msgLower);
    const wantsIdeas  = /idea|ideen|idee|concept|planned/i.test(msgLower);
    const words = msgLower.split(/\W+/).filter(w => w.length > 2);

    const scored = searchIndex.map(doc => {
        const urlLower = doc.url.toLowerCase();
        if (doc.isBackup && !wantsBackup) return { doc, score: -1 };
        if (doc.isGameIdea && !wantsIdeas) return { doc, score: -1 };

        let score = 0;
        let matched = false;

        words.forEach(word => {
            // Riesiger Boost, wenn das Suchwort direkt im Dateinamen/Pfad steckt (z.B. "TrafkCalc")
            if (urlLower.includes(word)) {
                score += 200;
                matched = true;
            }

            // Textinhalte prüfen
            const wordCount = (doc.text.match(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
            if (wordCount > 0) {
                score += Math.min(wordCount * 15, 100);
                matched = true;
            }
        });

        if (matched) {
            score += doc.priority * 50;
        } else {
            score = 0; // Kein Match -> Raus
        }
        return { doc, score };
    });

    // MAXIMAL 5 Dokumente senden, um den Proxy-Error (HTTP 413) abzuwehren!
    let topDocs = scored.filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5).map(x => x.doc);

    if (topDocs.length === 0) return { context: '', images: [] };

    // Text pro Dokument auf 1500 Zeichen kappen (Proxy Limits)
    let context = topDocs.map((d, i) => {
        const label = i === 0 ? `[MAIN SOURCE]\nSOURCE: ${d.url}` : `SOURCE: ${d.url}`;
        const ideaTag = d.isGameIdea ? '\n[NOTE: GAME IDEA / CONCEPT]' : '';
        const backupTag = d.isBackup ? '\n[NOTE: BACKUP / ARCHIVE]' : '';

        // Schneiden und Formatierung grob beibehalten
        let cleanText = d.rawText.substring(0, 1500);
        return `${label}${ideaTag}${backupTag}\nCONTENT:\n${cleanText}`;
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

// ----------------------------------------------------------------------
// File Attachment UI
// ----------------------------------------------------------------------
function buildFileAttachmentUI() {
    const row = document.getElementById('chat-input-row');
    if (!row || document.getElementById('attach-btn')) return;
    const attachBtn = document.createElement('button');
    attachBtn.id = 'attach-btn';
    attachBtn.title = 'Attach file';
    attachBtn.innerHTML = '[+]';
    attachBtn.style.cssText = `height:3rem; width:3rem; font-size:1.3rem; background:transparent; border:2px solid #5a3998; border-radius:50%; cursor:pointer; color:white; display:flex; align-items:center; justify-content:center; flex-shrink:0;`;
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'file-input-hidden';
    fileInput.multiple = true;
    fileInput.accept = '.txt,.md,.json,.js,.ts,.css,.html,.xml,.csv,.py,.yaml,.yml,.log,.c,.cpp,.h,.sh,.cmake,.pdf,.docx,.zip';
    fileInput.style.display = 'none';
    const previewContainer = document.createElement('div');
    previewContainer.id = 'file-preview-container';
    previewContainer.style.cssText = `position:fixed; bottom:10.5rem; left:4rem; right:4rem; display:flex; flex-wrap:wrap; gap:8px;`;
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);
    row.insertBefore(attachBtn, sendBtn);
    row.insertBefore(fileInput, sendBtn);
    document.querySelector('main').appendChild(previewContainer);
}

async function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    for (const file of files) {
        const isText = file.type.startsWith('text/') || /\.(md|txt|json|js|css|html|xml|csv|py|yaml|yml)$/i.test(file.name);
        const isImage = file.type.startsWith('image/');
        if (isImage) {
            if (chatWindow) {
                const note = document.createElement('div');
                note.style.cssText = 'margin-bottom:10px; color:#ff9966; font-size:0.85rem;';
                note.innerHTML = `[!] Images are not supported: <em>${file.name}</em>`;
                chatWindow.appendChild(note);
                chatWindow.scrollTop = chatWindow.scrollHeight;
            }
        } else if (isText) {
            const content = await file.text();
            attachedFiles.push({ name: file.name, type: file.type || 'text/plain', content, isText: true });
        } else {
            attachedFiles.push({ name: file.name, type: file.type || 'application/octet-stream', content: '', isText: false });
        }
        renderFilePreviews();
    }
    e.target.value = '';
}

function renderFilePreviews() {
    const container = document.getElementById('file-preview-container');
    if (!container) return;
    container.innerHTML = '';
    attachedFiles.forEach((f, i) => {
        const chip = document.createElement('div');
        chip.style.cssText = `background:rgba(90,57,152,0.7); border:1px solid #9069da; border-radius:20px; padding:4px 10px; font-size:0.8rem; color:white; display:flex; align-items:center; gap:6px; max-width:180px; overflow:hidden; white-space:nowrap;`;
        const icon = f.isText ? '[doc]' : '[pkg]';
        chip.innerHTML = `<span>${icon} ${f.name.length > 18 ? f.name.slice(0,16)+'...' : f.name}</span>`;
        const removeBtn = document.createElement('span');
        removeBtn.textContent = '[x]';
        removeBtn.style.cssText = 'cursor:pointer; opacity:0.7; font-size:0.75rem; flex-shrink:0;';
        removeBtn.addEventListener('click', () => { attachedFiles.splice(i,1); renderFilePreviews(); });
        chip.appendChild(removeBtn);
        container.appendChild(chip);
    });
}

function buildUserContent(promptText, files) {
    const textFiles = files.filter(f => f.isText);
    let fullText = promptText;
    if (textFiles.length > 0) {
        fullText += '\n\n--- ATTACHED FILES ---';
        for (const f of textFiles) {
            const preview = f.content.length > 3000 ? f.content.slice(0,3000)+'\n[... truncated ...]' : f.content;
            fullText += `\n\nFILE: ${f.name}\nCONTENT:\n${preview}`;
        }
    }
    return fullText;
}

// ----------------------------------------------------------------------
// API-Aufruf
// ----------------------------------------------------------------------
async function queryGitHubModels(finalPrompt, userText, currentSystemPrompt, pendingFiles = [], retries = 2) {
    const historyWindow = chatHistory.slice(-6);
    const userContent = buildUserContent(finalPrompt, pendingFiles);
    const body = { messages: [ { role: "system", content: currentSystemPrompt }, ...historyWindow, { role: "user", content: userContent } ] };
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await _doFetch(body, userText);
        } catch (e) {
            lastError = e;
            if (attempt < retries && (e.message.includes('503')||e.message.includes('502')||e.message.includes('504'))) {
                console.warn(`Proxy schläft, wiederhole in 3s... (${attempt+1}/${retries})`);
                await new Promise(r => setTimeout(r,3000));
            } else break;
        }
    }
    throw lastError;
}

async function _doFetch(body, userText) {
    const response = await fetch(PROXY_URL, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
    if (!response.ok) {
        let errBody = '';
        try { errBody = await response.text(); } catch {}
        throw new Error(`HTTP ${response.status} from proxy: ${errBody.slice(0,300)}`);
    }
    let result;
    try { result = await response.json(); } catch (jsonErr) { throw new Error(`Proxy response is not valid JSON: ${jsonErr.message}`); }
    if (result?.error) throw new Error(`Proxy error: ${JSON.stringify(result.error).slice(0,300)}`);
    const reply = result?.choices?.[0]?.message?.content || "";
    chatHistory.push({ role:"user", content:userText });
    chatHistory.push({ role:"assistant", content:reply });
    return reply;
}

// ----------------------------------------------------------------------
// UI-Nachrichten & Bilder
// ----------------------------------------------------------------------
function addMessage(sender, text) {
    const msgDiv = document.createElement('div');
    msgDiv.style.marginBottom = '15px';
    msgDiv.style.lineHeight = '25px';
    let formattedText = text
    .replace(/\[Button:\s*(.*?)\]/g, (match, buttonText) => `<a class="do" style="display:inline-block; margin:5px; background:#9069da; padding:5px 10px; border-radius:10px; cursor:pointer;" onclick="document.getElementById('chat-input').value='${buttonText.replace(/'/g,"\\'")}'; document.getElementById('send-btn').click();">${buttonText}</a>`)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
    .replace(/
    http://googleusercontent.com/immersive_entry_chip/0
