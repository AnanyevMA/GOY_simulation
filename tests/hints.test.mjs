import test from 'node:test';
import assert from 'node:assert/strict';
import { freshModel, readText, run } from './helpers.mjs';
import { installFakeDom } from './fake-dom.mjs';
import { PHYSICS_HINTS, config, dewPointC, captureEfficiency } from '../src/config.js';
import { initUI, showPhysicsHint, syncSlidersToState } from '../src/ui.js';

const dom = installFakeDom();

test('каждый элемент data-hint в разметке имеет описание в PHYSICS_HINTS', () => {
    const keys = [...dom.html.matchAll(/data-hint="([^"]+)"/g)].map(m => m[1]);
    assert.ok(keys.length >= 12, `найдено ${keys.length} подсказок в index.html`);
    for (const k of keys) assert.ok(PHYSICS_HINTS[k], `нет подсказки для data-hint="${k}"`);
});

test('все параметры управления из ui.js (bind) имеют подсказку', () => {
    const ui = readText('src/ui.js');
    const keys = [...ui.matchAll(/bind\('[^']+',\s*'[^']+',\s*'([A-Za-z]+)'/g)].map(m => m[1]);
    assert.ok(keys.length === 11, `bind-параметров: ${keys.length}`);
    for (const k of [...keys, 'pipesDamper', 'tornBags']) assert.ok(PHYSICS_HINTS[k], `нет подсказки для ${k}`);
});

test('каждая подсказка заполнена: заголовок, формула и эффект (не пустые, не заглушки)', () => {
    for (const [k, h] of Object.entries(PHYSICS_HINTS)) {
        for (const f of ['title', 'formula', 'effect']) {
            assert.equal(typeof h[f], 'string', `${k}.${f}`);
            assert.ok(h[f].trim().length >= 12, `${k}.${f} слишком короткий`);
        }
        assert.ok(!/[T]ODO|undefined|NaN/.test(JSON.stringify(h)), `${k}: артефакты в тексте`);
    }
});

test('панель подсказки существует в разметке, showPhysicsHint заполняет её', () => {
    for (const id of ['hint-title', 'hint-formula', 'hint-effect']) assert.ok(dom.ids.has(id), `нет #${id}`);
    for (const [k, h] of Object.entries(PHYSICS_HINTS)) {
        showPhysicsHint(k);
        assert.ok(dom.doc.getElementById('hint-title').textContent.includes(h.title), k);
        assert.equal(dom.doc.getElementById('hint-formula').textContent, h.formula);
        assert.equal(dom.doc.getElementById('hint-effect').textContent, h.effect);
    }
    // неизвестный ключ не затирает панель
    const before = dom.doc.getElementById('hint-title').textContent;
    showPhysicsHint('нет-такого-параметра');
    assert.equal(dom.doc.getElementById('hint-title').textContent, before);
});

test('наведение (mouseenter), фокус и касание на каждом блоке с data-hint показывают нужную подсказку', async () => {
    const m = await freshModel();
    initUI(m.state, { onForcePulse() {}, onBagRupture() {}, onIdealToggle() {}, onScenario() {}, onApplyRec() {}, onParamChange() {} });
    assert.ok(dom.hintEls.length >= 12);
    for (const el of dom.hintEls) {
        const key = el.getAttribute('data-hint');
        for (const ev of ['mouseenter', 'focusin', 'touchstart']) {
            dom.doc.getElementById('hint-title').textContent = '';
            el.fire(ev);
            assert.ok(dom.doc.getElementById('hint-title').textContent.includes(PHYSICS_HINTS[key].title), `${ev} → ${key}`);
        }
    }
});

test('движение каждого ползунка меняет состояние модели и показывает подсказку параметра', async () => {
    const m = await freshModel();
    const changed = [];
    initUI(m.state, { onForcePulse() {}, onBagRupture() {}, onIdealToggle() {}, onScenario() {}, onApplyRec() {}, onParamChange: k => changed.push(k) });
    const cases = [
        ['I-rpm', 'fanRPM', '80', 80], ['I-vane', 'guideVane', '55', 55], ['I-temp', 'gasTempSP', '120', 120],
        ['I-hum', 'gasHumidity', '9', 9], ['I-draft', 'inletDraft', '-200', -200], ['I-dilution', 'dilutionValve', '30', 30],
        ['I-fresh', 'freshFeed', '6.5', 6.5], ['I-recirc', 'recircFeed', '25', 25], ['I-regenSP', 'regenSP', '1.4', 1.4],
        ['I-timeSpeed', 'timeSpeed', '5', 5], ['I-outdoor', 'outdoorTemp', '-15', -15],
    ];
    for (const [id, key, raw, val] of cases) {
        dom.doc.getElementById('hint-title').textContent = '';
        dom.doc.getElementById(id).fire('input', { target: { value: raw } });
        assert.equal(m.state.inputs[key], val, key);
        assert.ok(dom.doc.getElementById('hint-title').textContent.includes(PHYSICS_HINTS[key].title), `подсказка ${key}`);
        assert.ok(changed.includes(key));
    }
    // шиберы и порванные рукава (с ограничением ввода 0…800)
    dom.doc.getElementById('hint-title').textContent = '';
    dom.doc.getElementById('I-pipe-1B').fire('input', { target: { value: '35' } });
    assert.equal(m.state.inputs.pipes[1].damper, 35);
    assert.ok(dom.doc.getElementById('hint-title').textContent.includes(PHYSICS_HINTS.pipesDamper.title));
    dom.doc.getElementById('I-torn').fire('input', { target: { value: '99999' } });
    assert.equal(m.state.inputs.tornBags, config.totalBags);
    dom.doc.getElementById('I-torn').fire('input', { target: { value: '-5' } });
    assert.equal(m.state.inputs.tornBags, 0);
    dom.doc.getElementById('I-torn').fire('input', { target: { value: 'abc' } });
    assert.equal(m.state.inputs.tornBags, 0);
    syncSlidersToState(m.state);
    assert.equal(dom.doc.getElementById('L-vane').textContent, '55 %');
});

test('числа в текстах подсказок соответствуют модели (формулы не «врут»)', async () => {
    const h = PHYSICS_HINTS;
    // точка росы
    assert.ok(h.gasHumidity.effect.includes('38°C') && Math.abs(dewPointC(5) - 38) < 1);
    assert.ok(h.gasHumidity.effect.includes('65°C') && Math.abs(dewPointC(20) - 65) < 1);
    // захват
    assert.ok(h.inletDraft.effect.includes('73%') && Math.abs(captureEfficiency(-30) - 0.73) < 0.02);
    assert.ok(h.inletDraft.effect.includes('37%') && Math.abs(captureEfficiency(-15) - 0.37) < 0.02);
    // температура сорбции — по фактической температуре реактора
    const res = {};
    for (const sp of [135, 150, 200]) { const m = await freshModel(); m.state.inputs.gasTempSP = sp; run(m, 5000); res[sp] = m.state.out; }
    assert.ok(h.gasTempSP.effect.includes('127°C → 99.4%') && Math.abs(res[135].actualTemp - 127) < 2 && Math.abs(res[135].effHF - 99.4) < 0.4);
    assert.ok(h.gasTempSP.effect.includes('141°C → 98.2%') && Math.abs(res[150].actualTemp - 141) < 2 && Math.abs(res[150].effHF - 98.2) < 0.8);
    assert.ok(h.gasTempSP.effect.includes('187°C → 80%') && Math.abs(res[200].actualTemp - 187) < 3 && Math.abs(res[200].effHF - 80) < 4);
    // показатель степени мощности
    assert.ok(h.guideVane.formula.includes('Q^2.0…2.6'));
});
