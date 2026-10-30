import test from 'node:test';
import assert from 'node:assert/strict';
import { freshModel, run } from './helpers.mjs';
import { accumulate, getEconomics, resetCounters, counters, tariffs } from '../src/economics.js';
import { SIM_DT_H } from '../src/config.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} ± ${tol}`);

test('энергия = Σ P·dt по тикам физики (не зависит от частоты опроса UI)', async () => {
    resetCounters();
    const m = await freshModel(); run(m, 300);
    let expected = 0;
    for (let i = 0; i < 600; i++) { m.tick(); accumulate(m.state.out, SIM_DT_H); expected += m.state.out.fanPowerKW * SIM_DT_H; }
    near(counters.energyKWH, expected, 1e-6);
    // час модельного времени при ≈600 кВт ≈ 600 кВт·ч
    near(counters.energyKWH, 600, 80);
    near(counters.hoursInShift, 1, 1e-9);
});

test('смена закрывается каждые 8 ч модельного времени: накопители обнуляются, счётчик смен растёт', () => {
    resetCounters();
    const out = { fanPowerKW: 500, hfGenKgH: 40, effHF: 99.8, hfFugitiveKgH: 0, hfTotalGenKgH: 40, hfOut: 0.3, dustOut: 2 };
    const ticksPerShift = Math.round(tariffs.shiftHours / SIM_DT_H);
    for (let i = 0; i < ticksPerShift - 1; i++) accumulate(out, SIM_DT_H);
    assert.equal(counters.shiftsCompleted, 0);
    near(counters.energyKWH, 500 * tariffs.shiftHours, 2);
    accumulate(out, SIM_DT_H); accumulate(out, SIM_DT_H);
    assert.equal(counters.shiftsCompleted, 1);
    assert.ok(counters.energyKWH < 5, 'счётчики новой смены начинаются с нуля');
    assert.equal(getEconomics(out).shiftsCompleted, 1);
    resetCounters();
});

test('остановка дымососа даёт потери фтора ≈ вся генерация HF и штраф за неорганизованный выброс', async () => {
    const m = await freshModel(); run(m, 300); m.state.inputs.fanRPM = 0; run(m, 300);
    const e = getEconomics(m.state.out);
    const expected = m.state.out.hfTotalGenKgH * (84 / 60) * tariffs.alf3Price;
    near(Number(e.fluorLossCostH), expected, expected * 0.01);
    assert.ok(Number(e.penaltyCostH) >= tariffs.fugitivePenaltyRate, 'штраф за выброс в корпус');
    assert.equal(e.isPenalty, true);
});

test('штраф за неорганизованный выброс включается только выше допуска (5% генерации)', () => {
    const base = { fanPowerKW: 500, hfGenKgH: 40, effHF: 99.8, hfTotalGenKgH: 40.5, hfOut: 0.3, dustOut: 2 };
    assert.equal(getEconomics({ ...base, hfFugitiveKgH: 0.5 }).penaltyCostH, '0');
    assert.ok(Number(getEconomics({ ...base, hfFugitiveKgH: 4 }).penaltyCostH) > 0);
});

test('штрафы за HF и пыль — прогрессивные, с ограничением по кратности', () => {
    const base = { fanPowerKW: 0, hfGenKgH: 40, effHF: 99.8, hfFugitiveKgH: 0, hfTotalGenKgH: 40 };
    const p1 = Number(getEconomics({ ...base, hfOut: 1.0, dustOut: 2 }).penaltyCostH);
    const p2 = Number(getEconomics({ ...base, hfOut: 2.0, dustOut: 2 }).penaltyCostH);
    const pMax = Number(getEconomics({ ...base, hfOut: 500, dustOut: 2 }).penaltyCostH);
    assert.ok(p2 > p1 && pMax === tariffs.hfPenaltyRate * 5);
});
