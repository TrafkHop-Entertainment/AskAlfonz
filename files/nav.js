function initNav() {
    const navContainer = document.getElementById('sidebar-nav');
    if (!navContainer) return;

    fetch('sitemap.xml')
    .then(r => r.text())
    .then(str => {
        const xml = new window.DOMParser().parseFromString(str, "text/xml");
        const urls = Array.from(xml.querySelectorAll("loc"))
        .map(el => el.textContent.trim())
        .filter(u => u.endsWith('.html'));

        console.log("HTML URLs gefunden:", urls.length, urls.slice(0, 5));

        const tree = buildTree(urls);
        collapseSelf(tree);
        console.log("Tree root keys:", Object.keys(tree));
        renderTree(tree, navContainer, true);
    })
    .catch(err => {
        console.error("Sitemap Fehler:", err);
        navContainer.innerHTML = '<p style="color:red">Fehler: ' + err.message + '</p>';
    });

    function buildTree(urls) {
        const root = {};

        urls.forEach(url => {
            try {
                const u = new URL(url);
                const parts = u.pathname.split('/').filter(Boolean).slice(1);

                let level = root;
                parts.forEach((part, i) => {
                    const isLast = i === parts.length - 1;
                    const display = decodeURIComponent(part).replace(/\.html$/, '');
                    if (!level[part]) {
                        level[part] = { name: display, path: null, children: {} };
                    }
                    if (isLast) level[part].path = url;
                    level = level[part].children;
                });
            } catch(e) { console.warn(e); }
        });

        return root;
    }

    function collapseSelf(node) {
        Object.keys(node).forEach(key => {
            const n = node[key];

            collapseSelf(n.children);

            const childKeys = Object.keys(n.children);

            const selfKey = childKeys.find(ck =>
            ck === key ||
            ck === key + '.html' ||
            decodeURIComponent(ck).replace(/\.html$/, '') === n.name
            );

            if (selfKey && !n.path) {
                const selfChild = n.children[selfKey];
                n.path = selfChild.path;
                Object.assign(n.children, selfChild.children);
                delete n.children[selfKey];
            }
        });
    }

    function renderTree(node, parentEl, isRoot = false) {
        const ul = document.createElement('ul');
        ul.className = isRoot ? 'tree-ul root-ul' : 'tree-ul';

        Object.keys(node).sort((a, b) => {
            const aK = Object.keys(node[a].children).length > 0;
            const bK = Object.keys(node[b].children).length > 0;
            if (aK && !bK) return -1;
            if (!aK && bK) return 1;
            return a.localeCompare(b);
        }).forEach(key => {
            const n = node[key];
            const hasKids = Object.keys(n.children).length > 0;

            const li = document.createElement('li');
            li.className = 'tree-li';

            const div = document.createElement('div');
            div.className = 'tree-item';

            const bubble = document.createElement('div');
            bubble.className = 'nav';

            const link = document.createElement('a');
            link.className = 'do';
            link.href = n.path || '#';
            link.textContent = n.name;
            link.title = n.name;
            bubble.appendChild(link);
            div.appendChild(bubble);

            if (hasKids) {
                const arrow = document.createElement('span');
                arrow.className = 'arrow';
                arrow.innerHTML = '&#9654;';
                arrow.onclick = e => {
                    e.stopPropagation();
                    li.querySelector('.tree-ul').classList.toggle('open');
                    arrow.classList.toggle('open');
                };
                div.appendChild(arrow);
            }

            li.appendChild(div);
            if (hasKids) renderTree(n.children, li);
            ul.appendChild(li);
        });

        parentEl.appendChild(ul);
    }
}

/*This was made with ai*/
