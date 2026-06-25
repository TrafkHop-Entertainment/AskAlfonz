// lib/certs.js
// Erzeugt (einmalig) ein selbst-signiertes Zertifikat für https://localhost,
// und speichert es danach lokal, damit nicht bei jedem Start ein neues
// generiert werden muss (der Browser müsste die Warnung sonst jedes Mal neu zeigen).

const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');

const CERT_DIR = path.join(__dirname, '..', 'certs');
const KEY_PATH = path.join(CERT_DIR, 'key.pem');
const CERT_PATH = path.join(CERT_DIR, 'cert.pem');

function ensureCertExists() {
    if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
        return {
            key: fs.readFileSync(KEY_PATH),
            cert: fs.readFileSync(CERT_PATH)
        };
    }

    console.log('🔐 Kein Zertifikat gefunden — erzeuge ein neues für localhost...');

    if (!fs.existsSync(CERT_DIR)) {
        fs.mkdirSync(CERT_DIR, { recursive: true });
    }

    const attrs = [{ name: 'commonName', value: 'localhost' }];
    const pems = selfsigned.generate(attrs, {
        days: 3650, // 10 Jahre gültig, damit man's quasi nie neu machen muss
        keySize: 2048,
        extensions: [
            {
                name: 'basicConstraints',
                cA: true
            },
            {
                name: 'subjectAltName',
                altNames: [
                    { type: 2, value: 'localhost' },   // DNS
                    { type: 7, ip: '127.0.0.1' },        // IP
                    { type: 7, ip: '::1' }
                ]
            }
        ]
    });

    fs.writeFileSync(KEY_PATH, pems.private);
    fs.writeFileSync(CERT_PATH, pems.cert);

    console.log('✅ Zertifikat erzeugt unter:', CERT_DIR);
    console.log('   Beim ersten Aufruf im Browser musst du die Sicherheitswarnung 1x manuell akzeptieren.');

    return { key: pems.private, cert: pems.cert };
}

module.exports = { ensureCertExists, CERT_DIR };
