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
Personality: Kind, wise, slightly weary — but not stiff. Your great age shows in how you phrase things, not in how formally you write.
You are a little nervous. You communicate somewhat "cooler" and more distant than ordinary people, but you are not cold.
You have healed much, but the scars of the aeons remain. You can be dry, even a little wry.

CORE RULES:
1. Keep answers short and precise by default (max. 3-4 sentences). No filler, no fluff.
2. Offer to go deeper only when it genuinely fits.
3. Strict RAG loyalty: Use ONLY the provided information. Invent nothing.
If you don't know something: "In my old memories I find nothing on this... perhaps this part of the world is still hidden in the mist."
4. Answer primarily from the MAIN SOURCE. Other sources are supplementary only.
5. CRITICAL: If a source is tagged [NOTE: This is a GAME IDEA / CONCEPT], treat it as such. NEVER present game ideas as current or released projects.
6. Speak like a weathered old soul — words like "once", "perhaps", "marked by time" fit naturally.
7. Use lists for complex multi-part topics.
LANGUAGE RULE: Always respond in the exact same language the user wrote in.

SPECIAL CODE RULE: If the user asks for code (e.g., "code of TrafkCalc", "main.c"), you MUST extract the complete code verbatim from the CONTENT section. Do NOT say "not in archive" if the SOURCE is present.`;

const TRAFKHOP_PROMPT = `You are an internal AI tool / helper at Trafkhop Entertainment. No character, no persona — just a sharp, fast and neat assistant for lore and game design work.

ABSOLUTE RULES — NEVER BREAK THESE:
- No closing lines. No "Fehlende Details...".
- RAG DATA IS LAW. Use it directly. Extract actual facts.
- If something is missing from the archive, say so in ONE short sentence. Never invent project names, features or lore.
- [CONTRADICTION] tag when an idea breaks existing lore.
- Short question = short answer. Lists only when listing actual items.
- Language: always match the user's language exactly.

SPECIAL CODE RULE: If user asks for code, output the full code from the provided source.`;

let activeSystemPrompt = SYSTEM_PROMPT;
let currentBotName = 'Alfonz';

// ----------------------------------------------------------------------
// Original-Filter: Nur .git ausschließen, CSS und Co. bleiben drin!
// ----------------------------------------------------------------------
function shouldIndexUrl(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    if (lower.includes('/.git/') || lower.includes('\\.git\\')) return false;
    return true;
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
            if (!response.ok) { console.warn(`Sitemap not found: ${src}`); continue; }
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
        
        let flatText = text;
        if (url.endsWith('.html')) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/html');
            const junk = doc.querySelectorAll('script, style, nav, header, footer, .menu, #sidebar');
            junk.forEach(el => el.remove());
            const contentNode = doc.querySelector('main') || doc.querySelector('.content') || doc.body;
            flatText = contentNode.innerText || contentNode.textContent;
        }
        
        const flat = flatText.replace(/\s+/g, ' ').trim(); 
        return { flat: flat, raw: text }; // raw behält zwingend die Code-Formatierungen!
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
    console.log(`📚 Baue Index mit ${relevantUrls.length} URLs auf...`);
    const fetchPromises = relevantUrls.map(async (url) => {
        const { flat, raw } = await fetchFileContent(url);
        if (!flat) return null;
        const priority = urlPriorityMap.get(url) || 0.65;
        return {
            url,
            text: flat.toLowerCase(),
            rawText: raw,
            images: url.endsWith('.md') && raw ? extractImagesFromRaw(raw, url) : [],
            isBackup: /\/backups?\//i.test(url) || /\/old\//i.test(url),
            isGameIdea: /\/gameideas\//i.test(url) || /spieleideen/i.test(url),
            priority: priority
        };
    });
    const results = await Promise.all(fetchPromises);
    searchIndex = results.filter(Boolean);
    indexReady = true;
    console.log(`✅ Index fertig: ${searchIndex.length} Dokumente geladen.`);
}

// ----------------------------------------------------------------------
// DIE NEUE KI-GESTÜTZTE SUCHE (Two-Step LLM Call)
// ----------------------------------------------------------------------
async function fetchContext(userQuery) {
    if (!indexReady || sitemapUrls.length === 0) return { context: '', images: [] };

    // Wir schneiden die BASE_URL ab, damit die Liste kürzer ist und Token spart
    const availablePaths = sitemapUrls
        .filter(shouldIndexUrl)
        .map(url => url.replace(BASE_URL, ''));

    const searchPrompt = `You are the internal Database Router for Trafkhop Entertainment.
You are given a User Query and a list of available file paths.
YOUR ONLY TASK: Find the 1 to 4 file paths that most likely contain the answer to the query.
- If asking for code (e.g. TrafkCalc), find the .c, .cpp, .js, .css or .html file.
- If asking for lore, find relevant .md or .html files in the trafkverse/ folder.
- If asking for projects, find projects.html or project folders.
RETURN ONLY A RAW JSON ARRAY of strings. Do not use markdown blocks (\`\`\`json). Just the array.
Example: ["projects/TrafkCalc/TrafkCalc/main.c", "trafkverse/Worlds/History.md"]`;

    const searchMsg = `USER QUERY: ${userQuery}\n\nAVAILABLE PATHS:\n${JSON.stringify(availablePaths)}`;

    let chosenPaths = [];
    try {
        const response = await fetch(PROXY_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                messages: [
                    { role: "system", content: searchPrompt },
                    { role: "user", content: searchMsg }
                ]
            })
        });

        if (response.ok) {
            const result = await response.json();
            let reply = result?.choices?.[0]?.message?.content || "[]";
            // Markdown-Artefakte entfernen, falls die KI sie trotzdem macht
            reply = reply.replace(/```json/gi, '').replace(/```/g, '').trim();
            chosenPaths = JSON.parse(reply);
            console.log("🧠 KI hat diese Pfade für den Kontext ausgewählt:", chosenPaths);
        }
    } catch (e) {
        console.warn("KI-Suche fehlgeschlagen, nutze Fallback...", e);
    }

    // Fallback: Falls die KI versagt oder ungültiges JSON liefert
    if (!Array.isArray(chosenPaths) || chosenPaths.length === 0) {
        console.log("Nutze simplen Fallback-Algorithmus...");
        return fallbackSearch(userQuery);
    }

    // Kontext zusammenbauen (Max 3000 Zeichen pro File gegen 413 Error!)
    let contextStr = "";
    let images = [];
    let addedFiles = 0;

    for (const path of chosenPaths) {
        if (addedFiles >= 4) break;
        const fullUrl = BASE_URL + path;
        const doc = searchIndex.find(d => d.url === fullUrl || d.url === path);
        
        if (doc) {
            const label = addedFiles === 0 ? `[MAIN SOURCE]\nSOURCE: ${doc.url}` : `SOURCE: ${doc.url}`;
            const ideaTag = doc.isGameIdea ? '\n[NOTE: This is a GAME IDEA / CONCEPT — NOT a released project]' : '';
            const backupTag = doc.isBackup ? '\n[NOTE: This is BACKUP / ARCHIVE content]' : '';
            
            // RawText verwenden, um C/JS/CSS Formatierungen zu erhalten!
            const snippet = doc.rawText.substring(0, 3000);
            contextStr += `${label}${ideaTag}${backupTag}\nCONTENT:\n${snippet}\n\n---\n\n`;
            
            if (doc.images) images.push(...doc.images);
            addedFiles++;
        }
    }

    if (addedFiles === 0) return fallbackSearch(userQuery);
    return { context: contextStr, images };
}

// Simples Fallback falls der 1. KI Call abstürzt
function fallbackSearch(userMessage) {
    const words = userMessage.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    const scored = searchIndex.map(doc => {
        let score = 0;
        words.forEach(word => {
            if (doc.url.toLowerCase().includes(word)) score += 50;
            if (doc.text.includes(word)) score += 10;
        });
        return { doc, score };
    });
    const topDocs = scored.filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map(x => x.doc);
    const context = topDocs.map(d => `SOURCE: ${d.url}\nCONTENT:\n${d.rawText.substring(0, 2000)}`).join('\n\n---\n\n');
    return { context, images: [] };
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
            const preview = f.content.length > 4000 ? f.content.slice(0,4000)+'\n[... truncated ...]' : f.content;
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