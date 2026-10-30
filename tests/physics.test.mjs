import test from 'node:test';
import assert from 'node:assert/strict';
import { freshModel, run, rng } from './helpers.mjs';
import { dewPointC, captureEfficiency, sorptionTempFactor, config, SIM_DT_H } from '../src/config.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} ± ${tol}`);

test('проектная точка: расход, ΔP, разрежение, HF, мощность в проектных пределах', async () => {
    const m = await freshModel(); run(m, 3000);
    const O = m.state.out;
    near(O.normalFlow, 220000, 6000, 'Qn');
    near(O.avgFilterDP, 1.16, 0.12, 'ΔP фильтра');
    near(O.calcDraft, -150, 8, 'разрежение');
    assert.ok(O.hfOut > 0.15 && O.hfOut < 0.5, `HF на трубе ${O.hfOut}`);
    near(O.hfIn, 183, 8, 'HF на входе');
    assert.ok(O.fanPowerKW > 450 && O.fanPowerKW < 750, `мощность ${O.fanPowerKW}`);
    near(O.fanEff, 0.76, 0.03, 'КПД дымососа в проектной точке');
    assert.ok(O.captureEff > 0.995, `захват ${O.captureEff}`);
    assert.equal(O.status, 'НОРМА');
});

test('закон сохранения массы потоков: Σq_i = Q от корпусов, Q от корпусов + подсос = Q общий', async () => {
    const m = await freshModel();
    Object.assign(m.state.inputs, { dilutionValve: 60 });
    m.state.inputs.pipes[1].damper = 40; m.state.inputs.pipes[3].damper = 70;
    run(m, 500);
    const O = m.state.out;
    const sum = O.pipeFlows.reduce((a, p) => a + p.flow, 0);
    near(sum, O.potroomFlow, 1, 'Σq_i');
    near(O.potroomFlow + O.dilutionFlow, O.normalFlow, 1, 'pot+dil');
});

test('укрытие и шибер — последовательные сопротивления: доли потока = G_i = 1/√(h + (1−h)/g²)', async () => {
    const m = await freshModel();
    m.state.inputs.pipes[1].damper = 40; run(m, 400);
    const O = m.state.out;
    const h = Math.abs(config.refDraft) / (config.pipeDP * 1000);
    const G = d => { const g = Math.pow(d / 100, 1.35); return 1 / Math.sqrt(h + (1 - h) / (g * g)); };
    near(O.pipeFlows[1].flow / O.pipeFlows[0].flow, G(40) / G(100), 0.002, 'q1B/q1A');
    // при той же настройке прежняя модель (q ∝ g) дала бы 0.287; последовательное сопротивление укрытия делает ветвь менее чувствительной
    assert.ok(O.pipeFlows[1].flow / O.pipeFlows[0].flow > 0.35);
});

test('закрытый шибер → выбивание в этой ветви, соседние ветви получают больше разрежения', async () => {
    const m = await freshModel();
    m.state.inputs.pipes[0].damper = 15; run(m, 400);
    const O = m.state.out;
    assert.ok(O.pipeFlows[0].fugitive, 'ветвь 1A должна выбивать');
    assert.ok(Math.abs(O.pipeFlows[1].draft) > 150, 'соседняя ветвь перегружена');
    assert.ok(O.captureEff < 0.97, 'общий захват должен упасть');
    assert.ok(O.hfFugitiveKgH > 0.3, 'часть HF уходит в корпус');
});

test('точка росы: формула Магнуса + 5°C кислых газов (контрольные значения)', () => {
    near(dewPointC(5) - config.acidDewShift, 33.2, 0.5, '5%');
    near(dewPointC(10) - config.acidDewShift, 46.1, 0.5, '10%');
    near(dewPointC(20) - config.acidDewShift, 60.3, 0.5, '20%');
    let prev = -Infinity;
    for (let h = 0; h <= 20; h += 1) { const d = dewPointC(h); assert.ok(d >= prev); prev = d; }
    // старая формула 52+1.9H завышала T_росы при 5% на 28°C
    assert.ok(dewPointC(5) < 45);
});

test('захват укрытием: монотонно растёт с разрежением, ≈99.8% при −150 Па, 0 при нуле', () => {
    assert.equal(captureEfficiency(0), 0);
    let prev = -1;
    for (let d = 0; d <= 400; d += 10) { const c = captureEfficiency(-d); assert.ok(c >= prev); prev = c; }
    assert.ok(captureEfficiency(-150) > 0.997);
    near(captureEfficiency(-30), 0.73, 0.03, '−30 Па');
    near(captureEfficiency(-15), 0.37, 0.03, '−15 Па');
});

test('температура сорбции: плавное падение, без обрыва; ≥99% улавливания при T реактора ≤ 120°C', async () => {
    const eff = {};
    for (const sp of [105, 126, 135, 150, 200]) {
        const m = await freshModel(); m.state.inputs.gasTempSP = sp; run(m, 5000);
        eff[sp] = { T: m.state.out.actualTemp, eHF: m.state.out.effHF, hf: m.state.out.hfOut };
    }
    assert.ok(eff[126].eHF > 99.2, `126: ${eff[126].eHF}`);
    near(eff[135].eHF, 99.4, 0.4, 'уставка 135°C (реактор ≈127°C)');
    near(eff[150].eHF, 98.2, 0.8, 'уставка 150°C (реактор ≈141°C)');
    near(eff[200].eHF, 80, 4, 'уставка 200°C (реактор ≈187°C)');
    const seq = [105, 126, 135, 150, 200].map(k => eff[k].eHF);
    for (let i = 1; i < seq.length; i++) assert.ok(seq[i] < seq[i - 1], 'эффективность монотонно падает');
    // температурный множитель действует только выше tempKStart
    assert.equal(sorptionTempFactor(config.tempKStart), 1);
    assert.ok(sorptionTempFactor(150) < sorptionTempFactor(130));
});

test('генерация HF не зависит от уставки температуры газов (T — следствие, не причина)', async () => {
    const hf = [];
    for (const sp of [80, 105, 150, 200]) { const m = await freshModel(); m.state.inputs.gasTempSP = sp; run(m, 3000); hf.push(m.state.out.hfTotalGenKgH); }
    assert.ok(hf.every(v => Math.abs(v - hf[0]) < 1e-9), hf.join(','));
});

test('ΔP чистой ткани ∝ скорости фильтрации (закон Дарси)', async () => {
    const dpFabric = async (vane) => {
        const m = await freshModel(); m.state.inputs.guideVane = vane; run(m, 1500);
        m.state.sections.forEach(s => { s.cakeMass = 0; s.isRegen = false; });
        m.state.inputs.regenSP = 2; m.tick();
        const vf = m.state.out.filtVelocity;
        return { dp: m.state.out.avgFilterDP, vf };
    };
    const a = await dpFabric(40), b = await dpFabric(80);
    near((b.dp / a.dp) / (b.vf / a.vf), 1, 0.03, 'ΔP/v');
    near(b.dp, config.baseDP * b.vf / ((config.refFlow * 378 / 273 / 3600) / config.filterArea), 0.03, 'ΔP абсолютное');
});

test('баланс фтора: стационарное F% = F_улов / Q_свеж при любой кратности рециркуляции', async () => {
    for (const recirc of [0, 11, 22, 44]) {
        const m = await freshModel(); m.state.inputs.recircFeed = recirc; run(m, 12000);
        const O = m.state.out;
        const captured = O.hfGenKgH * (O.effHF / 100) * 19 / 20;
        const expected = captured / (m.state.inputs.freshFeed * 1000) * 100;
        near(O.fContent, expected, expected * 0.03, `F% при рецирк=${recirc}`);
    }
});

test('замкнутый баланс HF: захвачено + в корпус = сгенерировано', async () => {
    for (const vane of [20, 35, 50, 69, 100]) {
        const m = await freshModel(); m.state.inputs.guideVane = vane; run(m, 800);
        const O = m.state.out;
        near(O.hfGenKgH + O.hfFugitiveKgH, O.hfTotalGenKgH, 1e-9, `vane=${vane}`);
    }
});

test('остановка дымососа: весь HF уходит в корпус (захват 0), «выбивание» во всех ветвях', async () => {
    const m = await freshModel(); run(m, 300); m.state.inputs.fanRPM = 0; run(m, 300);
    const O = m.state.out;
    assert.equal(O.captureEff, 0);
    near(O.hfFugitiveKgH, O.hfTotalGenKgH, 1e-9);
    assert.ok(O.hfTotalGenKgH > 40);
    assert.ok(O.pipeFlows.every(p => p.fugitive));
});

test('прострел при залповой продувке считается по ВСЕМ продутым секциям, а не по последней', async () => {
    const peak = async (mode) => {
        const m = await freshModel(); run(m, 30); m.state.inputs.tornBags = 3;     // порывы в С1, С2, С3; С4 — целая
        if (mode === 'force') m.forcePulseAll();
        else { const s = m.state.sections[0]; s.isRegen = true; s.regenTimer = s.regenTimerMax = 15; }
        let pk = 0;
        for (let i = 0; i < 14; i++) { m.tick(); pk = Math.max(pk, m.state.out.dustOut); }
        return { pk, tc: m.state.phys.spikeTornCount };
    };
    const f = await peak('force'), s = await peak('single');
    assert.equal(f.tc, 3);
    assert.equal(s.tc, 1);
    assert.ok(f.pk > s.pk, `залп ${f.pk} должен быть выше одиночного импульса ${s.pk}`);
});

test('КПД дымососа: максимум у BEP, падает при уходе и при закрытии НА; мощность растёт с расходом', async () => {
    const eff = [], kw = [];
    for (const vane of [30, 50, 69, 85, 100]) { const m = await freshModel(); m.state.inputs.guideVane = vane; run(m, 1500); eff.push(m.state.out.fanEff); kw.push(m.state.out.fanPowerKW); }
    assert.ok(eff.every(e => e >= config.fanEffMin && e <= config.fanEfficiency));
    assert.ok(eff[0] < eff[2], 'при НА 30% КПД ниже, чем в проектной точке');
    for (let i = 1; i < kw.length; i++) assert.ok(kw[i] > kw[i - 1]);
    // показатель степени N ∝ Q^k лежит в разумных пределах 2…3
    const m1 = await freshModel(), m2 = await freshModel();
    m1.state.inputs.guideVane = 69; m2.state.inputs.guideVane = 100; run(m1, 1500); run(m2, 1500);
    const k = Math.log(m2.state.out.fanPowerKW / m1.state.out.fanPowerKW) / Math.log(m2.state.out.normalFlow / m1.state.out.normalFlow);
    assert.ok(k > 2 && k < 3, `k=${k}`);
});

test('подсосы после фильтра: расход на всасе дымососа больше расхода через фильтр на 1/(1−f)', async () => {
    const m = await freshModel(); run(m, 300);
    const O = m.state.out;
    near(O.stackFlow / O.normalFlow, 1 / (1 - config.falseAirFrac), 1e-9);
});

test('фаззинг (детерминированный, 150 прогонов): нет NaN/∞, физические инварианты соблюдены', async () => {
    const r = rng(20261030);
    const U = (a, b) => a + r() * (b - a);
    for (let k = 0; k < 150; k++) {
        const m = await freshModel(); const I = m.state.inputs;
        Object.assign(I, {
            fanRPM: U(0, 100), guideVane: U(5, 100), gasTempSP: U(60, 200), gasHumidity: U(0, 20),
            inletDraft: U(-400, -50), dilutionValve: U(0, 100), freshFeed: U(0, 10), recircFeed: U(0, 40),
            regenSP: U(0.8, 2), tornBags: Math.floor(U(0, 900)), outdoorTemp: U(-45, 45),
        });
        I.pipes.forEach(p => { p.damper = r() < 0.3 ? U(0, 100) : 100; });
        if (r() < 0.25) m.triggerScenario(['anode_effect', 'air_drop', 'feeder_fault', 'wet_blinding'][k % 4]);
        const ctx = JSON.stringify({ k, ...I, pipes: I.pipes.map(p => Math.round(p.damper)) });
        for (let i = 0; i < 600; i++) {
            m.tick(); m.drainAlarms();
            const O = m.state.out, P = m.state.phys;
            const vals = [O.normalFlow, O.potroomFlow, O.gasFlow, O.hfIn, O.hfOut, O.dustOut, O.effHF, O.fanAmps, O.fanPowerKW, O.fanEff,
                O.avgFilterDP, O.totalDP, O.calcDraft, O.contactTime, O.fContent, O.captureEff, O.hfFugitiveKgH, P.actualTemp, P.receiverPressure,
                ...m.state.sections.map(s => s.cakeMass), ...m.state.sections.map(s => s.dp)];
            assert.ok(vals.every(Number.isFinite), `не число: ${ctx} i=${i}`);
            assert.ok(O.normalFlow >= 0 && O.captureEff >= 0 && O.captureEff <= 1, ctx);
            near(O.potroomFlow + O.dilutionFlow, O.normalFlow, 1, ctx);
            assert.ok(O.effHF >= 0 && O.effHF <= 100, `effHF ${O.effHF} ${ctx}`);
            assert.ok(O.hfFugitiveKgH >= -1e-9 && O.hfFugitiveKgH <= O.hfTotalGenKgH + 1e-9, ctx);
            assert.ok(m.state.sections.every(s => s.cakeMass >= 0), ctx);
            assert.ok(O.calcDraft <= 1e-9, ctx);
            assert.ok(O.fContent >= 0.05 && O.fContent <= config.maxFContent + 1e-9, ctx);
        }
    }
});

test('единое модельное время тика: SIM_DT_H = 6 с', () => {
    near(SIM_DT_H * 3600, 6, 1e-9);
});
