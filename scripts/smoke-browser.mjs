// Браузерный смоук-тест (необязательный, требует Playwright и Chromium):
//   node scripts/smoke-browser.mjs [путь/к/скриншоту.png]
// Проверяет в настоящем браузере: нет ошибок консоли и сетевых сбоев, Chart.js загружен локально,
// всплывающие подсказки появляются при наведении мыши, алармы от кнопок попадают в журнал,
// сценарии и автопилот работают, ускорение 10× не ломает отрисовку.
import http from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHYSICS_HINTS } from '../src/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.txt': 'text/plain' };
let playwright;
try { playwright = createRequire(import.meta.url)('playwright'); }
catch { console.error('Playwright не установлен: npm i -D playwright && npx playwright install chromium'); process.exit(2); }

const server = http.createServer(async (req, res) => {
    try {
        const path = new URL(req.url, 'http://x').pathname;
        const file = join(ROOT, path === '/' ? 'index.html' : decodeURIComponent(path));
        if (!file.startsWith(ROOT)) throw new Error('outside');
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
        res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/index.html`;

const failures = [];
const check = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) failures.push(msg); };

const browser = await playwright.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [], failedReq = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', r => failedReq.push(r.url()));
page.on('response', r => { if (r.status() >= 400) failedReq.push(`${r.status()} ${r.url()}`); });

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2500);

check(await page.evaluate(() => typeof Chart !== 'undefined'), 'Chart.js загружен локально (vendor/chart.umd.js)');
check(await page.evaluate(() => !!Chart.getChart('chart-dp') && !!Chart.getChart('chart-hf') && !!Chart.getChart('chart-amps')), '3 графика трендов созданы');

// 1. Всплывающие подсказки: реальное наведение мыши на каждый блок с data-hint
const hintKeys = await page.$$eval('[data-hint]', els => els.map(e => e.getAttribute('data-hint')));
let hintOk = 0;
for (const key of new Set(hintKeys)) {
    await page.evaluate(() => { document.getElementById('hint-title').textContent = ''; });
    await page.hover(`[data-hint="${key}"]`);
    const title = await page.textContent('#hint-title');
    const formula = await page.textContent('#hint-formula');
    const effect = await page.textContent('#hint-effect');
    const ok = title.includes(PHYSICS_HINTS[key].title) && formula === PHYSICS_HINTS[key].formula && effect === PHYSICS_HINTS[key].effect;
    if (ok) hintOk++; else console.log(`  ✗ подсказка «${key}»: «${title}»`);
}
check(hintOk === new Set(hintKeys).size, `подсказки при наведении: ${hintOk}/${new Set(hintKeys).size}`);

// 2. Движение ползунка меняет подсказку и значение
await page.evaluate(() => { const s = document.getElementById('I-hum'); s.value = 12; s.dispatchEvent(new Event('input', { bubbles: true })); });
check((await page.textContent('#L-hum')).includes('12'), 'ползунок влажности обновляет подпись');
check((await page.textContent('#hint-title')).includes(PHYSICS_HINTS.gasHumidity.title), 'ползунок влажности показывает подсказку');
await page.evaluate(() => { const s = document.getElementById('I-hum'); s.value = 5; s.dispatchEvent(new Event('input', { bubbles: true })); });

// 3. Алармы от кнопок оператора попадают в журнал (раньше терялись)
await page.click('#btn-pulse'); await page.click('#btn-rupture');
await page.waitForTimeout(400);
const log = await page.textContent('#alarm-log');
check(log.includes('ЗАЛПОВАЯ'), 'журнал: «Залповая продувка»');
check(log.includes('ПРОРЫВ'), 'журнал: «Прорыв рукава»');
await page.fill('#I-torn', '0'); await page.dispatchEvent('#I-torn', 'input');

// 4. Автопилот не отменяет сценарий «Сырой пирог»
await page.click('#btn-ideal'); await page.waitForTimeout(300);
await page.click('#scen-wet'); await page.waitForTimeout(2500);
check((await page.textContent('#L-hum')).trim().startsWith('20'), 'сценарий «Сырой пирог» держится при включённом автопилоте (влажность 20%)');
const temp = await page.textContent('#T-temp');
check(/роса\s*6\d/.test(temp), `T росы по Магнусу ≈ 65°C при 20% влаги: «${temp.trim()}»`);
await page.click('#btn-ideal');

// 5. Все сценарии и ускорение 10×
for (const id of ['scen-anode', 'scen-winter', 'scen-wear', 'scen-feeder', 'scen-air']) { await page.click(`#${id}`); await page.waitForTimeout(250); }
await page.evaluate(() => { const s = document.getElementById('I-timeSpeed'); s.value = 10; s.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(3500);
check((await page.textContent('#alarm-log')).includes('×'), 'журнал при 10×: повторы сгруппированы («×N»)');
const fps = await page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); (function f() { n++; performance.now() - t0 > 2000 ? res(n / 2) : requestAnimationFrame(f); })(); }));
check(fps > 25, `FPS при ускорении 10×: ${fps.toFixed(0)}`);

// 6. Раскладка: карточка «Физика процесса» стоит ПОД схемой (и её легендой) и целиком видна на типовых экранах
for (const [w, h] of [[1920, 1080], [1366, 768], [1280, 720]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(250);
    const g = await page.evaluate(() => {
        const c = document.getElementById('cv').getBoundingClientRect();
        const hb = document.getElementById('physics-hint-box').getBoundingClientRect();
        return { cBottom: c.bottom, cW: c.width, hTop: hb.top, hBottom: hb.bottom, hLeft: hb.left, cLeft: c.left, hW: hb.width, vh: innerHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
    });
    check(g.hTop >= g.cBottom - 0.5, `${w}×${h}: карточка подсказки начинается под схемой (${g.hTop.toFixed(0)} ≥ ${g.cBottom.toFixed(0)})`);
    check(g.hBottom <= g.vh + 0.5, `${w}×${h}: карточка целиком в окне (${g.hBottom.toFixed(0)} ≤ ${g.vh})`);
    check(Math.abs(g.hLeft - g.cLeft) < 1 && Math.abs(g.hW - g.cW) < 1, `${w}×${h}: карточка совпадает по ширине со схемой`);
    check(g.sw <= g.cw, `${w}×${h}: нет горизонтальной прокрутки`);
}
await page.setViewportSize({ width: 1500, height: 950 });
await page.hover('[data-hint="regenSP"]');
check((await page.textContent('#hint-live')).includes('Сейчас'), 'в карточке есть строка «Сейчас: …» с живыми значениями');

if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
check(errors.length === 0, `консоль без ошибок и предупреждений ${errors.length ? JSON.stringify(errors) : ''}`);
check(failedReq.length === 0, `нет сетевых сбоев ${failedReq.length ? JSON.stringify(failedReq) : ''}`);

await browser.close(); server.close();
if (failures.length) { console.error(`\nПровалено проверок: ${failures.length}`); process.exit(1); }
console.log('\nВсе браузерные проверки пройдены');
