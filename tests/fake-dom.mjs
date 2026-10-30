// Минимальная имитация DOM для проверки привязок ui.js без браузера: элементы берутся из index.html,
// поэтому отсутствующий в разметке id вернёт null — как в настоящем документе.
import { readText } from './helpers.mjs';

export class El {
    constructor(id, attrs = {}) {
        this.id = id; this.attrs = attrs; this.listeners = {};
        this.textContent = ''; this.value = ''; this.innerHTML = ''; this.className = ''; this.style = {};
    }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    getAttribute(n) { return this.attrs[n] ?? null; }
    fire(type, ev = {}) { (this.listeners[type] || []).forEach(f => f({ target: this, ...ev })); }
    querySelectorAll() { return []; }
}

export function installFakeDom() {
    const html = readText('index.html');
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
    const els = new Map();
    const hintEls = [...html.matchAll(/<(?:div|span|label)\b[^>]*\bdata-hint="([^"]+)"[^>]*>/g)].map(m => new El(null, { 'data-hint': m[1] }));
    const doc = {
        getElementById(id) {
            if (!ids.has(id)) return null;
            if (!els.has(id)) els.set(id, new El(id));
            return els.get(id);
        },
        querySelectorAll(sel) { return sel === '[data-hint]' ? hintEls : []; },
    };
    globalThis.document = doc;
    return { doc, ids, els, hintEls, html };
}
