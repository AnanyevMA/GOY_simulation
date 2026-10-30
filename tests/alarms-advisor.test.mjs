import test from 'node:test';
import assert from 'node:assert/strict';
import { freshModel, readText, run } from './helpers.mjs';
import { installFakeDom } from './fake-dom.mjs';
import { groupAlarms, alarmKey, processAlarms } from '../src/ui.js';
import { IDEAL } from '../src/config.js';

const dom = installFakeDom();

test('алармы от действий оператора не теряются при следующем тике и выдаются ровно один раз', async () => {
    const m = await freshModel(); run(m, 5);
    m.drainAlarms();
    m.forcePulseAll(); m.addTornBag(); m.setIdealMode(true);
    m.tick();
    const got = m.drainAlarms();
    assert.ok(got.some(a => a.includes('ЗАЛПОВАЯ')), 'залповая продувка');
    assert.ok(got.some(a => a.includes('ПРОРЫВ')), 'порыв рукава');
    assert.ok(got.some(a => a.includes('АВТОПИЛОТ')), 'автопилот');
    assert.equal(m.drainAlarms().length, 0, 'очередь опустошена');
});

test('очередь алармов ограничена (без утечки памяти, если UI не читает)', async () => {
    const m = await freshModel();
    m.state.inputs.guideVane = 100; m.state.inputs.regenSP = 0.8;   // постоянно сыплются предупреждения
    run(m, 5000);
    assert.ok(m.state.alarms.length <= 520, `длина очереди ${m.state.alarms.length}`);
});

test('группировка журнала: одинаковые события подряд сворачиваются в «×N», разные — нет', () => {
    assert.equal(alarmKey('↻ Авто-продувка: Секция 1 (ΔP=1.29 кПа)'), alarmKey('↻ Авто-продувка: Секция 4 (ΔP=1.31 кПа)'));
    const flood = Array.from({ length: 200 }, (_, i) => `↻ Авто-продувка: Секция ${i % 4 + 1} (ΔP=1.${20 + i % 9} кПа)`);
    let log = groupAlarms([], ['⚠ ПРОСКОК HF: 0.74'], '10:00:00');
    log = groupAlarms(log, flood, '10:00:01');
    assert.equal(log.length, 2);
    assert.equal(log[0].count, 200);
    assert.ok(log[0].msg.includes('Секция 4'), 'показано последнее сообщение группы');
    log = groupAlarms(log, ['💥 ПРОРЫВ рукава'], '10:00:02');
    assert.equal(log.length, 3);
    // лимит длины
    let big = [];
    for (let i = 0; i < 120; i++) big = groupAlarms(big, [`событие-${'x'.repeat(i % 2 + 1)}-${i % 2 ? 'a' : 'b'}${'!'.repeat(i % 7)}`, `другое-${i}-${'q'.repeat(i % 5)}`], 't');
    assert.ok(big.length <= 50);
});

test('журнал в DOM: HTML экранируется, повторы показываются счётчиком ×N', () => {
    const log = dom.doc.getElementById('alarm-log');
    processAlarms(['⚠ <img src=x onerror=alert(1)> 5']);
    assert.ok(log.innerHTML.includes('&lt;img'), 'теги экранированы');
    assert.ok(!log.innerHTML.includes('<img'));
    processAlarms(['⚠ <img src=x onerror=alert(1)> 7', '⚠ <img src=x onerror=alert(1)> 9']);
    assert.ok(log.innerHTML.includes('×3'));
    assert.ok(log.innerHTML.includes('alarm-warn'));
});

test('все кнопки сценариев из ui.js запускают существующий сценарий советчика', async () => {
    const ui = readText('src/ui.js');
    const html = readText('index.html');
    const pairs = [...ui.matchAll(/\['(scen-[a-z]+)',\s*'([a-z_]+)'/g)].map(m => [m[1], m[2]]);
    assert.equal(pairs.length, 6);
    for (const [btn, name] of pairs) {
        assert.ok(html.includes(`id="${btn}"`), `нет кнопки #${btn} в index.html`);
        const m = await freshModel(); run(m, 20);
        m.triggerScenario(name);
        assert.equal(m.state.advisor.activeScenario, name, `сценарий ${name} не сработал`);
    }
});

test('CI не вызывает несуществующих сценариев и запускает набор тестов', () => {
    const wf = readText('.github/workflows/deploy.yml');
    assert.ok(/npm (run verify|test)/.test(wf), 'workflow должен запускать npm test / verify');
    for (const m of wf.matchAll(/triggerScenario\('([^']+)'\)/g)) {
        assert.ok(['anode_effect', 'winter_frost', 'bag_wear', 'feeder_fault', 'wet_blinding', 'air_drop'].includes(m[1]), `неизвестный сценарий в CI: ${m[1]}`);
    }
});

test('автопилот не «чинит» возмущения: T/влажность газа, порванные рукава, отказ питателя', async () => {
    const m = await freshModel(); run(m, 50); m.setIdealMode(true); run(m, 5);
    m.triggerScenario('wet_blinding');
    const { gasHumidity, gasTempSP } = m.state.inputs;
    m.state.inputs.tornBags = 4;
    run(m, 200);
    assert.equal(m.state.inputs.gasHumidity, gasHumidity);
    assert.equal(m.state.inputs.gasTempSP, gasTempSP);
    assert.equal(m.state.inputs.tornBags, 4);
    // повторное включение автопилота тоже не ремонтирует рукава и не меняет возмущения
    m.setIdealMode(false); m.setIdealMode(true);
    assert.equal(m.state.inputs.tornBags, 4);
    assert.equal(m.state.inputs.gasHumidity, gasHumidity);

    const f = await freshModel(); run(f, 50); f.setIdealMode(true); f.triggerScenario('feeder_fault'); run(f, 300);
    assert.equal(f.state.inputs.freshFeed, 0, 'автопилот не должен дозировать при отказе питателя');
    assert.ok(f.state.out.hfOut > 5, 'проскок HF сохраняется до вмешательства оператора');
    // рекомендация советчика «Применить» снимает отказ, и автопилот снова ведёт дозирование
    const rec = f.state.advisor.recommendations.find(r => r.module === 'alumina');
    assert.ok(rec, 'советчик должен предложить восстановить подачу');
    f.applyRecommendation(rec.id);
    assert.equal(f.state.advisor.activeScenario, null);
    run(f, 1500);
    assert.ok(f.state.inputs.freshFeed > 3);
    assert.ok(f.state.out.hfOut < 1.5, `HF после восстановления ${f.state.out.hfOut}`);
});

test('автопилот удерживает проектное разрежение при морозе и после порыва ветви', async () => {
    const m = await freshModel(); run(m, 100); m.setIdealMode(true);
    m.state.inputs.outdoorTemp = -32;
    run(m, 1500);
    assert.ok(Math.abs(m.state.out.calcDraft - IDEAL.inletDraft) < 6, `разрежение ${m.state.out.calcDraft}`);
    assert.ok(m.state.inputs.guideVane > 55 && m.state.inputs.guideVane < 80);
});

test('автопилот: ручной перехват органа управления фиксируется, а T/влажность газа перехвата не требуют', async () => {
    const m = await freshModel(); m.setIdealMode(true);
    m.autoTune('guideVane');
    assert.equal(m.state.hold.guideVane, true);
    m.autoTune('gasHumidity');
    assert.equal(m.state.hold.gasHumidity, undefined, 'влажность — не орган управления автопилота');
});

test('физика не зависит от скорости времени: результат определяется числом тиков', async () => {
    const a = await freshModel(), b = await freshModel();
    b.state.inputs.timeSpeed = 10;       // timeSpeed влияет только на частоту вызова tick() в app.js
    run(a, 1000); run(b, 1000);
    assert.equal(a.state.out.normalFlow, b.state.out.normalFlow);
    assert.equal(a.state.out.fContent, b.state.out.fContent);
});
