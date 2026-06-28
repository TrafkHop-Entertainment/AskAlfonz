// lib/filesApi.js
// Stellt zwei Endpunkte bereit:
//   GET /api/files/list?subpath=...   -> listet Dateien/Ordner rekursiv auf (wie eine Mini-Sitemap)
//   GET /api/files/read?path=...      -> liefert den Inhalt einer einzelnen Datei
//
// Sicherheitsprinzip: ALLES bleibt innerhalb von config.rootFolder.
// Jeder Pfad wird normalisiert und geprüft, dass er nach der Auflösung
// immer noch unterhalb des Root-Ordners liegt (Schutz gegen "../../" Tricks).

const fs = require('fs');
const path = require('path');

function buildFilesRouter(config) {
    const router = require('express').Router();
    const ROOT = path.resolve(config.rootFolder);

    if (!fs.existsSync(ROOT)) {
        console.warn(`⚠️  WARNUNG: Root-Ordner existiert nicht: ${ROOT}`);
        console.warn('   Trag den richtigen Pfad in helper/config.json unter "rootFolder" ein.');
    }

    const allowedExt = new Set((config.allowedExtensions || []).map(e => e.toLowerCase()));
    const excludeFolders = new Set(config.excludeFolders || []);

    // Löst einen vom Client gesendeten relativen Pfad sicher auf.
    // Gibt null zurück, wenn der Pfad versucht, den Root-Ordner zu verlassen.
    function safeResolve(relativePath) {
        const cleaned = (relativePath || '').replace(/^[/\\]+/, '');
        const resolved = path.resolve(ROOT, cleaned);
        if (!resolved.startsWith(ROOT)) return null;
        return resolved;
    }

    function isExcluded(name) {
        return excludeFolders.has(name) || name.startsWith('.');
    }

    // Rekursiv den Ordnerbaum auflisten (ähnlich wie die alte sitemap.xml,
    // aber live von der Festplatte statt einer statischen Datei).
    function walk(dir, baseForRelative) {
        const results = [];
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (e) {
            return results;
        }

        for (const entry of entries) {
            if (isExcluded(entry.name)) continue;
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                results.push(...walk(fullPath, baseForRelative));
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                if (allowedExt.size > 0 && !allowedExt.has(ext)) continue;
                const relative = path.relative(baseForRelative, fullPath).split(path.sep).join('/');
                results.push(relative);
            }
        }
        return results;
    }

    // GET /api/files/list?subpath=optional/unterordner
    router.get('/list', (req, res) => {
        const subpath = req.query.subpath || '';
        const target = safeResolve(subpath);

        if (!target) {
            return res.status(400).json({ error: 'Ungültiger Pfad (außerhalb des Root-Ordners).' });
        }
        if (!fs.existsSync(target)) {
            return res.status(404).json({ error: 'Pfad nicht gefunden.', rootFolder: ROOT });
        }

        const files = walk(target, ROOT);
        res.json({ root: ROOT, count: files.length, files });
    });

    // GET /api/files/read?path=relativer/pfad/zur/datei.html
    router.get('/read', (req, res) => {
        const relPath = req.query.path;
        if (!relPath) {
            return res.status(400).json({ error: 'Parameter "path" fehlt.' });
        }

        const target = safeResolve(relPath);
        if (!target) {
            return res.status(400).json({ error: 'Ungültiger Pfad (außerhalb des Root-Ordners).' });
        }

        const ext = path.extname(target).toLowerCase();
        if (allowedExt.size > 0 && !allowedExt.has(ext)) {
            return res.status(403).json({ error: `Dateityp "${ext}" ist nicht freigegeben.` });
        }

        fs.readFile(target, 'utf-8', (err, content) => {
            if (err) {
                return res.status(404).json({ error: 'Datei nicht gefunden oder nicht lesbar.', detail: err.message });
            }
            res.json({ path: relPath, content });
        });
    });

    // GET /api/files/read-binary?path=relativer/pfad/zum/bild.png
    // Eigener Endpunkt für Bilder (Markdown-Anhänge im RAG-Archiv): liefert
    // die rohen Bytes mit passendem Content-Type, statt sie als JSON/Text
    // zu verpacken wie /read es tut. Eigene, engere Endungs-Whitelist —
    // unabhängig von config.allowedExtensions, damit z.B. .exe niemals
    // über diesen Weg ausgeliefert werden kann.
    const IMAGE_MIME = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
        '.svg': 'image/svg+xml'
    };
    router.get('/read-binary', (req, res) => {
        const relPath = req.query.path;
        if (!relPath) {
            return res.status(400).json({ error: 'Parameter "path" fehlt.' });
        }

        const target = safeResolve(relPath);
        if (!target) {
            return res.status(400).json({ error: 'Ungültiger Pfad (außerhalb des Root-Ordners).' });
        }

        const ext = path.extname(target).toLowerCase();
        const mime = IMAGE_MIME[ext];
        if (!mime) {
            return res.status(403).json({ error: `Dateityp "${ext}" ist hier nicht erlaubt (nur Bilder).` });
        }

        fs.readFile(target, (err, data) => {
            if (err) {
                return res.status(404).json({ error: 'Datei nicht gefunden oder nicht lesbar.', detail: err.message });
            }
            res.setHeader('Content-Type', mime);
            res.send(data);
        });
    });

    return router;
}

module.exports = { buildFilesRouter };
