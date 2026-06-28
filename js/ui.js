// js/ui.js
// Alles, was DOM-Elemente erzeugt oder verändert. Nutzt ausschließlich die
// bestehenden Design-Variablen (--Kraft, --Trafk, etc.) aus Standard.css /
// AskAlfonz.css, damit die Seite optisch unverändert bleibt und sich die
// neuen Elemente einfügen statt aufzufallen.

const UI = (() => {

    let chatWindow, inputField, sendBtn, statusDot, modelSelect, thinkToggle;

    // ----------------------------------------------------------------
    // Neue Status-Leiste: schmaler fixer Bereich zwischen Header und
    // #chat-window. Enthält: Helper-Status-Punkt, Modell-Auswahl,
    // Thinking-Toggle, Export-Button, Import-Button.
    // ----------------------------------------------------------------
    function buildStatusBar() {
        const bar = document.createElement('div');
        bar.id = 'alfonz-status-bar';

        // Status-Punkt + Label
        const statusWrap = document.createElement('div');
        statusWrap.className = 'alfonz-status-group';
        statusDot = document.createElement('span');
        statusDot.id = 'alfonz-status-dot';
        statusDot.title = 'Helper-Status wird geprüft...';
        const statusLabel = document.createElement('span');
        statusLabel.id = 'alfonz-status-label';
        statusLabel.textContent = 'Helper...';
        statusWrap.appendChild(statusDot);
        statusWrap.appendChild(statusLabel);

        // Modell-Auswahl — wird initial mit dem Fallback befüllt, und
        // sobald Ollama erreichbar ist von main.js per populateModelDropdown()
        // mit den ECHTEN installierten Modellen ersetzt (siehe HelperClient.listModels).
        modelSelect = document.createElement('select');
        modelSelect.id = 'alfonz-model-select';
        populateModelDropdown(FALLBACK_MODELS.map(m => m.id));

        // Thinking-Toggle — Standard AUS, da Thinking auf schwacher
        // Hardware oft mehrere Minuten zusätzlich braucht, bevor die
        // sichtbare Antwort überhaupt kommt (siehe helperClient.js).
        const thinkWrap = document.createElement('label');
        thinkWrap.id = 'alfonz-think-wrap';
        thinkToggle = document.createElement('input');
        thinkToggle.type = 'checkbox';
        thinkToggle.id = 'alfonz-think-toggle';
        thinkToggle.checked = false;
        const thinkLabel = document.createElement('span');
        thinkLabel.textContent = '🧠 Denken';
        thinkWrap.title = 'Wenn an: Alfonz überlegt sichtbar, bevor er antwortet (deutlich langsamer)';
        thinkWrap.appendChild(thinkToggle);
        thinkWrap.appendChild(thinkLabel);

        // Export / Import Buttons
        const exportBtn = document.createElement('button');
        exportBtn.id = 'alfonz-export-btn';
        exportBtn.className = 'do alfonz-bar-btn';
        exportBtn.textContent = 'Chat speichern';
        exportBtn.title = 'Gespräch als Markdown-Datei speichern';

        const importBtn = document.createElement('button');
        importBtn.id = 'alfonz-import-btn';
        importBtn.className = 'do alfonz-bar-btn';
        importBtn.textContent = 'Chat laden';
        importBtn.title = 'Gespräch aus Markdown-Datei laden';

        const infoBtn = document.createElement('button');
        infoBtn.id = 'alfonz-info-btn';
        infoBtn.className = 'do alfonz-bar-btn';
        infoBtn.textContent = 'ℹ️';
        infoBtn.title = 'Datenschutz & wie man Alfonz benutzt';

        bar.appendChild(statusWrap);
        bar.appendChild(thinkWrap);
        bar.appendChild(modelSelect);
        bar.appendChild(exportBtn);
        bar.appendChild(importBtn);
        bar.appendChild(infoBtn);

        const main = document.querySelector('main');
        main.insertBefore(bar, chatWindow);

        return { exportBtn, importBtn, infoBtn };
    }

    function setStatus(ok, label) {
        if (!statusDot) return;
        statusDot.classList.toggle('alfonz-status-ok', ok);
        statusDot.classList.toggle('alfonz-status-bad', !ok);
        statusDot.title = label;
        document.getElementById('alfonz-status-label').textContent = label;
    }

    // Befüllt das Modell-Dropdown mit einer Liste von Modell-Namen (Strings,
    // z.B. ["qwen3:4b", "qwen3:8b"] — direkt von Ollama, also kein
    // separates "label" nötig, der Modell-Name selbst ist aussagekräftig).
    // Behält die aktuelle Auswahl bei, falls das Modell noch in der neuen
    // Liste enthalten ist; sonst wählt es einfach das erste verfügbare.
    function populateModelDropdown(modelNames) {
        if (!modelSelect || !modelNames || modelNames.length === 0) return;

        const previousValue = modelSelect.value;
        modelSelect.innerHTML = '';

        modelNames.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            modelSelect.appendChild(opt);
        });

        if (modelNames.includes(previousValue)) {
            modelSelect.value = previousValue;
        } else {
            modelSelect.value = modelNames[0];
        }
    }

    function getSelectedModel() {
        return modelSelect ? modelSelect.value : (FALLBACK_MODELS[0]?.id || '');
    }

    function setSelectedModel(modelId) {
        if (modelSelect) modelSelect.value = modelId;
    }

    function isThinkingEnabled() {
        return thinkToggle ? thinkToggle.checked : false;
    }

    // ----------------------------------------------------------------
    // Chat-Nachrichten (Logik 1:1 vom alten Code übernommen)
    // thinking: optionaler Denkprozess-Text (nur wenn der Thinking-Toggle
    // an war) — wird als eingeklapptes <details>-Element direkt VOR der
    // eigentlichen Antwort eingefügt, damit man bei Bedarf nachschauen
    // kann, ohne dass es den Chat standardmäßig zumüllt.
    // ----------------------------------------------------------------
    function addMessage(sender, text, thinking = null) {
        const msgDiv = document.createElement('div');
        msgDiv.style.marginBottom = '15px';
        msgDiv.style.lineHeight = '25px';
        let formattedText = text
            .replace(/\[Button:\s*(.*?)\]/g, (match, buttonText) =>
                `<a class="do" style="display:inline-block; margin:5px; background:#9069da; padding:5px 10px; border-radius:10px; cursor:pointer;" onclick="document.getElementById('chat-input').value='${buttonText.replace(/'/g, "\\'")}'; document.getElementById('send-btn').click();">${buttonText}</a>`)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');

        let thinkingHtml = '';
        if (thinking && thinking.trim()) {
            const escaped = thinking
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/\n/g, '<br>');
            thinkingHtml = `<details class="alfonz-thinking"><summary>🧠 Gedankengang anzeigen</summary><div>${escaped}</div></details>`;
        }

        if (sender === 'Traveler') {
            msgDiv.innerHTML = `<b style="color:#7FFFD4;">Traveler:</b> <p>${text}</p>`;
        } else {
            msgDiv.innerHTML = `<b style="color:#C41E3A;">${sender}:</b> ${thinkingHtml}<p>${formattedText}</p>`;
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
            // Bilder kommen jetzt über den Helper (lokale Platte) statt direkt von der Website
            imgEl.src = `${HELPER_URL}/api/files/read-binary?path=${encodeURIComponent(img.relPath)}`;
            imgEl.alt = img.label;
            imgEl.title = img.label;
            imgEl.style.cssText = `
                max-width: 280px;
                max-height: 220px;
                border-radius: 6px;
                border: 1px solid #5a3998;
                cursor: pointer;
                object-fit: contain;
                background: #1a0a2e;
            `;
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

    function addLoadingMessage(id, botName, think = false) {
        const loadingDiv = document.createElement('div');
        loadingDiv.id = id;
        const text = think
            ? '...thinking it through, this may take a while...'
            : '...searching the faded pages...';
        loadingDiv.innerHTML = `<b style="color:#9069da;">${botName}:</b> <p><em>${text}</em></p>`;
        chatWindow.appendChild(loadingDiv);
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    function removeLoadingMessage(id) {
        document.getElementById(id)?.remove();
    }

    function clearChatWindow() {
        chatWindow.innerHTML = '';
    }

    // ----------------------------------------------------------------
    // Init
    // ----------------------------------------------------------------
    function init() {
        chatWindow = document.getElementById('chat-window');
        inputField = document.getElementById('chat-input');
        sendBtn = document.getElementById('send-btn');

        if (!chatWindow || !inputField || !sendBtn) {
            console.error('❌ Chat-Elemente nicht gefunden!');
            return null;
        }

        const { exportBtn, importBtn, infoBtn } = buildStatusBar();
        return { chatWindow, inputField, sendBtn, exportBtn, importBtn, infoBtn };
    }

    return {
        init, setStatus, getSelectedModel, setSelectedModel, isThinkingEnabled, populateModelDropdown,
        addMessage, addImages, addLoadingMessage, removeLoadingMessage, clearChatWindow
    };
})();
