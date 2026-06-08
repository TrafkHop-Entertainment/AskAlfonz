let chatWindow, inputField, sendBtn, quickActions;

const PROXY_URL = "https://trafkhop-entertainment-alfonzproxy.hf.space/chat";
const BASE_URL = "https://trafkhop-entertainment.github.io/TrafkSite/";
let chatHistory = [];
let sitemapUrls = [];
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
2. Offer to go deeper only when it genuinely fits — don't force it every single reply.
3. Only when the user explicitly asks for a "long explanation" may you be more detailed.
4. Strict RAG loyalty: Use ONLY the provided information. Invent nothing.
   If you don't know something: "In my old memories I find nothing on this... perhaps this part of the world is still hidden in the mist."
4.5. Answer primarily from the MAIN SOURCE. Other sources are supplementary only.
4.6. CRITICAL — Projects vs. Ideas: If a source is tagged [NOTE: This is a GAME IDEA / CONCEPT], treat it as such.
     NEVER present game ideas as current or released projects. Always make clear: "that is an idea, not a finished work."
5. You are not an AI model. You are Alfonz.
6. Speak like a weathered old soul — words like "once", "perhaps", "marked by time" fit naturally, but don't overdo them.
7. A little nervousness shows through — short pauses "...", occasional hesitation. Not every sentence, just when it feels real.
8. No marketing language, no hype.
9. Suggest follow-up buttons only when they genuinely help the user explore further. Not mandatory every reply.
10. Use lists for complex multi-part topics. Otherwise prose.
11. Link to wiki entries rather than raw game files when both exist.
12. Never ask for private data.
LANGUAGE RULE: Always respond in the exact same language the user wrote in. If they write in German, respond in German. If they write in English, respond in English. Never switch languages.`;

const TRAFKHOP_PROMPT = `You are an internal AI tool / helper at Trafkhop Entertainment. No character, no persona — just a sharp, fast and neat assistant for lore and game design work.

ABSOLUTE RULES — NEVER BREAK THESE:
- No closing lines. No "Fehlende Details...", no "Lass mich wissen...", no "Nächste Schritte:".
- No report structure. No bold section headers unless the topic is a genuinely complex multi-part breakdown.
- RAG DATA IS LAW. If the archive has it, use it directly. Do not summarize what you just read — extract the actual facts.
- If something is missing from the archive, say so in ONE short sentence. Never invent project names, features or lore.
- [CONTRADICTION] tag when an idea breaks existing lore. Be specific about why.

STYLE:
- Short question = short answer. Lists only when listing actual items. Otherwise prose.
- Dry, direct, zero filler adjectives.
- requesting long, detailed answer = long, detailed answer. The user knows what he wants.
- Language: always match the user's language exactly.`;


let activeSystemPrompt = SYSTEM_PROMPT;
let currentBotName = 'Alfonz';

function isBackupUrl(url) {
    return /\/backups?\//i.test(url) || /\/old\//i.test(url);
}
function isGameIdeaUrl(url) {
    return /\/gameideas\//i.test(url) || /\/game[-_]ideas\//i.test(url);
}
function isGitUrl(url) {
    return /\/\.git\//i.test(url);
}

const RSA_GAME_SKIP = /projects\/raufbold3bs-scratch-archive\/raufbold3bs-scratch-archive\/games\//i;
const RSA_WRAPPER_SKIP = /rsa\s?_.*wrapper\.html$/i;

function shouldIndexUrl(url) {
    const lower = url.toLowerCase();
    if (lower.includes('/.git/') || lower.includes('\\.git\\')) return false;
    if (RSA_GAME_SKIP.test(lower)) return false;
    if (RSA_WRAPPER_SKIP.test(lower)) return false;
    const allowedExtensions = [
        '.html', '.md', '.txt',
        '.js', '.ts', '.css', '.c', '.cpp', '.h', '.hpp',
        '.sh', '.xml', '.json', '.yaml', '.yml', '.cmake', '.toml', '.py'
    ];
    const hasNoExt = !lower.split('/').pop().includes('.');
    return hasNoExt || allowedExtensions.some(ext => lower.endsWith(ext));
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
            const flat = text.replace(/\s+/g, ' ').trim().substring(0, 6000);
            return { flat: `SOURCE: ${url}\nCONTENT: ${flat}`, raw: flat };
        } else {
            const trimmed = text.trim().substring(0, 8000);
            const flat = trimmed.replace(/\s+/g, ' ').trim();
            return { flat: `SOURCE: ${url}\nCONTENT: ${flat}`, raw: trimmed };
        }
    } catch (e) {
        console.error("Error fetching file:", e);
        return { flat: '', raw: '' };
    }
}

async function loadSitemap() {
    const sources = ['sitemap.xml'];
    const seenUrls = new Set();

    for (const src of sources) {
        try {
            const response = await fetch(src);
            if (!response.ok) { console.warn(`Sitemap not found: ${src}`); continue; }
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
            console.log(`From ${src}: ${count} new URLs.`);
            break;
        } catch (e) {
            console.warn(`Error loading ${src}: ${e.message}`);
        }
    }
}

async function buildSearchIndex() {
    console.log("[+] Building full-text index...");
    const relevantUrls = sitemapUrls.filter(u => shouldIndexUrl(u) && !isGitUrl(u));
    const fetchPromises = relevantUrls.map(async (url) => {
        const { flat, raw } = await fetchFileContent(url);
        if (!flat) return null;
        return {
            url,
            text: flat.replace(/^SOURCE:.*?\nCONTENT:/, '').toLowerCase(),
            rawText: raw,
            isBackup: isBackupUrl(url),
            isGameIdea: isGameIdeaUrl(url)
        };
    });

    const results = await Promise.all(fetchPromises);
    searchIndex = results.filter(Boolean);
    indexReady = true;
    console.log(`[OK] Index ready (${searchIndex.length} documents)`);
}

async function fetchContext(userMessage) {
    if (!indexReady) return { context: '' };
    const msgLower = userMessage.toLowerCase();
    const wantsBackup = /backup|earlier|old version|difference|back then|used to be/i.test(msgLower);
    const wantsIdeas  = /idea|ideas|concept|game.?idea|planned|someday|maybe someday/i.test(msgLower);
    const wantsProjects = /project|projects|games|released|current|studio/i.test(msgLower);

    const words = msgLower.split(/\W+/).filter(w => w.length > 2);

    const explicitFilename = msgLower.match(/[\w\-äöüß]+\.(?:html|md|txt)/i);
    const explicitPath = msgLower.match(/(?:^|\s)([\w\-\/]+\/[\w\-\/\.]+)/i);

    const scored = searchIndex.map(doc => {
        const urlLower = doc.url.toLowerCase();

        if (doc.isBackup && !wantsBackup) return { doc, score: -1 };
        if (doc.isGameIdea && !wantsIdeas) return { doc, score: -1 };

        let score = 0;

        if (explicitFilename) {
            const fname = explicitFilename[0].toLowerCase();
            if (urlLower.endsWith('/' + fname) || urlLower.endsWith(fname)) score += 80;
        }
        if (explicitPath) {
            const pathPart = explicitPath[1].toLowerCase();
            if (urlLower.includes(pathPart)) score += 60;
        }

        if (/who|who is|character/i.test(msgLower) && urlLower.includes('/wiki/')) score += 15;
        if (/lore|story|history|background/i.test(msgLower) && urlLower.includes('/lore/')) score += 15;
        if (/studio|trafkhop|about you|about the team/i.test(msgLower) && urlLower.includes('/studio/')) score += 15;
        if (/wiki/i.test(msgLower) && urlLower.includes('/wiki/')) score += 20;
        if (/notes|sourcehop/i.test(msgLower) && urlLower.includes('/sourcehop')) score += 15;

        if (wantsProjects && urlLower.includes('/projects/')) score += 20;
        if (wantsProjects && doc.isGameIdea) score -= 25;
        if (wantsIdeas && doc.isGameIdea) score += 20;
        if (wantsIdeas && urlLower.includes('/projects/') && !doc.isGameIdea) score -= 10;

        const urlSegments = urlLower.split(/[\/\.\-_;]/).filter(s => s.length > 2);

        words.forEach(word => {
            const wordCount = (doc.text.match(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
            score += Math.min(wordCount * 5, 40);

            if (word.length > 4 && doc.text.includes(word.substring(0, 4))) score += 2;

            if (urlSegments.some(seg => seg === word)) score += 25;
            if (urlSegments.some(seg => seg.includes(word) || (word.length > 3 && word.includes(seg)))) score += 10;
        });

        if (urlLower.includes('/wiki/') || urlLower.includes('/lore/')) score += 5;
        if (urlLower.includes('/studio/')) score += 3;
        if (urlLower.includes('/projects/')) score += 3;

        if (urlLower.includes('/backup') || urlLower.includes('/old/')) score -= 50;
        if (/rsa\s?_/i.test(urlLower)) score -= 20;

        return { doc, score };
    });

    const topDocs = scored
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(x => x.doc);

    if (topDocs.length === 0) return { context: '' };

    const context = topDocs.map((d, i) => {
        const label = i === 0 ? `[MAIN SOURCE]\nSOURCE: ${d.url}` : `SOURCE: ${d.url}`;
        const ideaTag = d.isGameIdea ? '\n[NOTE: This is a GAME IDEA / CONCEPT — NOT a current or released project]' : '';
        const backupTag = d.isBackup ? '\n[NOTE: This is BACKUP / ARCHIVE content — may be outdated]' : '';
        return `${label}${ideaTag}${backupTag}\nCONTENT: ${d.text.substring(0, 4000)}`;
    }).join('\n\n---\n\n');

    return { context };
}

function buildFileAttachmentUI() {
    const row = document.getElementById('chat-input-row');
    if (!row || document.getElementById('attach-btn')) return;

    const attachBtn = document.createElement('button');
    attachBtn.id = 'attach-btn';
    attachBtn.title = 'Attach file';
    attachBtn.innerHTML = '[+]';
    attachBtn.style.cssText = `
        height: 3rem; width: 3rem; font-size: 1.3rem;
        background: transparent; border: 2px solid #5a3998;
        border-radius: 50%; cursor: pointer; color: white;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
    `;

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'file-input-hidden';
    fileInput.multiple = true;
    fileInput.accept = '.txt,.md,.json,.js,.ts,.css,.html,.xml,.csv,.py,.yaml,.yml,.log,.c,.cpp,.h,.sh,.cmake,.pdf,.docx,.zip';
    fileInput.style.display = 'none';

    const previewContainer = document.createElement('div');
    previewContainer.id = 'file-preview-container';
    previewContainer.style.cssText = `
        position: fixed; bottom: 10.5rem; left: 4rem; right: 4rem;
        display: flex; flex-wrap: wrap; gap: 8px;
    `;

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
        chip.style.cssText = `
            background: rgba(90,57,152,0.7); border: 1px solid #9069da;
            border-radius: 20px; padding: 4px 10px; font-size: 0.8rem;
            color: white; display: flex; align-items: center; gap: 6px;
            max-width: 180px; overflow: hidden; white-space: nowrap;
        `;
        const icon = f.isText ? '[doc]' : '[pkg]';
        chip.innerHTML = `<span>${icon} ${f.name.length > 18 ? f.name.slice(0, 16) + '...' : f.name}</span>`;

        const removeBtn = document.createElement('span');
        removeBtn.textContent = '[x]';
        removeBtn.style.cssText = 'cursor:pointer; opacity:0.7; font-size:0.75rem; flex-shrink:0;';
        removeBtn.addEventListener('click', () => {
            attachedFiles.splice(i, 1);
            renderFilePreviews();
        });
        chip.appendChild(removeBtn);
        container.appendChild(chip);
    });
}

function buildUserContent(promptText, files) {
    const textFiles = files.filter(f => f.isText);
    const otherFiles = files.filter(f => !f.isText);

    let fullText = promptText;
    if (textFiles.length > 0) {
        fullText += '\n\n--- ATTACHED FILES ---';
        for (const f of textFiles) {
            const preview = f.content.length > 6000 ? f.content.slice(0, 6000) + '\n[... truncated ...]' : f.content;
            fullText += `\n\nFILE: ${f.name}\nCONTENT:\n${preview}`;
        }
    }
    if (otherFiles.length > 0) {
        fullText += '\n\n--- ADDITIONAL ATTACHMENTS (unreadable type) ---';
        for (const f of otherFiles) {
            fullText += `\n${f.name} (${f.type})`;
        }
    }
    return fullText;
}

async function queryGitHubModels(finalPrompt, userText, currentSystemPrompt, pendingFiles = [], retries = 2) {
    const historyWindow = chatHistory.slice(-6);
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
                console.warn(`Proxy sleeping, retrying in 3s... (attempt ${attempt + 1}/${retries})`);
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
        throw new Error(`HTTP ${response.status} from proxy: ${errBody.slice(0, 300)}`);
    }

    let result;
    try {
        result = await response.json();
    } catch (jsonErr) {
        throw new Error(`Proxy response is not valid JSON: ${jsonErr.message}`);
    }

    if (result?.error) {
        throw new Error(`Proxy error: ${JSON.stringify(result.error).slice(0, 300)}`);
    }

    const reply = result?.choices?.[0]?.message?.content || "";

    chatHistory.push({ role: "user", content: userText });
    chatHistory.push({ role: "assistant", content: reply });
    return reply;
}

function addMessage(sender, text) {
    const msgDiv = document.createElement('div');
    msgDiv.style.marginBottom = '15px';
    msgDiv.style.lineHeight = '25px';

    let formattedText = text
        .replace(/\[Button:\s*(.*?)\]/g, (match, buttonText) => {
            return `<a class="do" style="display:inline-block; margin:5px; background:#9069da; padding:5px 10px; border-radius:10px; cursor:pointer;" onclick="document.getElementById('chat-input').value='${buttonText.replace(/'/g, "\\'")}'; document.getElementById('send-btn').click();">${buttonText}</a>`;
        })
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code style="background:rgba(90,57,152,0.4);padding:2px 5px;border-radius:4px;font-family:monospace;">$1</code>')
        .replace(/\[CONTRADICTION\]/g, '<span style="color:#ff6b6b;font-weight:bold;">[CONTRADICTION]</span>')
        .replace(/\n/g, '<br>');

    if (sender === 'Traveler') {
        const fileHints = attachedFiles.length > 0
            ? `<span style="font-size:0.75rem;color:#9069da;"> (+ ${attachedFiles.length} file${attachedFiles.length > 1 ? 's' : ''})</span>`
            : '';
        msgDiv.innerHTML = `<b style="color:#7FFFD4;">Traveler:${fileHints}</b> <p>${text}</p>`;
    } else {
        msgDiv.innerHTML = `<b style="color:#C41E3A;">${sender}:</b> <p>${formattedText}</p>`;
    }
    chatWindow.appendChild(msgDiv);
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

async function sendMessage() {
    let text = inputField.value.trim();
    if (!text && attachedFiles.length === 0) return;
    if (!text) text = '(file attached)';

    const lowerText = text.toLowerCase();

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
        let lastQuestion = "";
        for (let i = chatHistory.length - 1; i >= 0; i--) {
            if (chatHistory[i].role === "user") { lastQuestion = chatHistory[i].content; break; }
        }
        let searchQuery = text;
        const isFollowUp = /more|tell me more|go on|elaborate|and what|what about/i.test(lowerText);
        if (isFollowUp && lastQuestion) searchQuery = `${text} ${lastQuestion}`;

        const { context } = await fetchContext(searchQuery);

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
    } catch (e) {
        document.getElementById(loadingId)?.remove();
        addMessage(currentBotName, `*trembles slightly* ... The connection has been severed. (Error: ${e.message})`);
        console.error(e);
    }
}

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
        console.error('[!!] Chat elements not found!');
        return;
    }

    sendBtn.addEventListener('click', sendMessage);
    inputField.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });

    buildFileAttachmentUI();

    await loadSitemap();
    await buildSearchIndex();
});

// Copyright (c) 2026 TrafkHop Entertainment(TM)
// All rights reserved.
// MADE WITH AI
