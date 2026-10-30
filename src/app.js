// ═══════════════════════════════════════════════════════════════════════
//  ANTIGRAVITY СГОУ — ОРКЕСТРАТОР v8.1 (ES6 Entry Point)
//  Связывает model, advisor, config, renderer, ui, economics.
//  Физика: фиксированный шаг 10 Гц × timeSpeed с аккумулятором по реальному времени
//  (модельные часы не «отстают» в фоновой вкладке). Рендер: 60 FPS.
//  Тренды/Телеметрия: 1 Гц (с Peak Hold). Экономика интегрируется на каждом тике.
// ═══════════════════════════════════════════════════════════════════════

import {
    state,
    config,
    SIM_DT_H,
    tick,
    forcePulseAll,
    addTornBag,
    setIdealMode,
    autoTune,
    triggerScenario,
    applyRecommendation,
    consumePeakMetrics,
    drainAlarms,
} from './model.js';
import { initRenderer, render, burstDust } from './renderer.js';
import { initUI, updateTelemetry, initCharts, updateCharts, processAlarms, syncSlidersToState } from './ui.js';
import { accumulate, getEconomics } from './economics.js';

const TICK_MS = config.tickRealSec * 1000;      // период одного тика при скорости 1×
const MAX_ELAPSED_MS = 2000;                    // верхняя граница «догоняющего» интервала (после паузы вкладки)
const MAX_TICKS_PER_STEP = 200;                 // защита от лавины тиков

/** Выгружает накопленные алармы в журнал UI (действия оператора + события физики). */
function flushAlarms() {
    processAlarms(drainAlarms());
}

document.addEventListener('DOMContentLoaded', () => {
    const cv = document.getElementById('cv');
    initRenderer(cv);

    initUI(state, {
        onForcePulse: () => { forcePulseAll(); flushAlarms(); },
        onBagRupture: () => { addTornBag(); burstDust(); flushAlarms(); },
        onIdealToggle: (on) => { setIdealMode(on); flushAlarms(); },
        onScenario: (name) => {
            triggerScenario(name);
            syncSlidersToState(state);
            flushAlarms();
        },
        onApplyRec: (recId) => {
            applyRecommendation(recId);
            syncSlidersToState(state);
            flushAlarms();
        },
        onParamChange: (paramName) => {
            if (state.idealMode) {
                autoTune(paramName);
                syncSlidersToState(state);
            }
        },
    });

    initCharts();

    // Начальный тик для немедленного отображения телеметрии при старте
    tick();
    flushAlarms();
    syncSlidersToState(state);
    updateTelemetry(state, getEconomics(state.out), consumePeakMetrics());

    // ── Физическая симуляция: фиксированный шаг, ускоряется ползунком timeSpeed ──
    let lastMs = performance.now();
    let accMs = 0;
    setInterval(() => {
        const now = performance.now();
        const speed = state.inputs.timeSpeed || 1;
        accMs += Math.min(now - lastMs, MAX_ELAPSED_MS) * speed;
        lastMs = now;

        const batch = [];
        let steps = 0;
        while (accMs >= TICK_MS && steps < MAX_TICKS_PER_STEP) {
            tick();
            accumulate(state.out, SIM_DT_H);
            batch.push(...drainAlarms());
            accMs -= TICK_MS;
            steps++;
        }
        if (steps === MAX_TICKS_PER_STEP) accMs = 0;   // не накапливаем долг бесконечно
        if (batch.length) processAlarms(batch);
    }, 50);

    // ── Обновление телеметрии и трендов (1 Гц с пиковым детектором регенерации) ──
    setInterval(() => {
        const peaks = consumePeakMetrics();
        updateTelemetry(state, getEconomics(state.out), peaks);
        updateCharts(state, peaks);
    }, 1000);

    // ── Рендер Canvas (60 FPS) ──
    function renderLoop() {
        render(state, config);
        requestAnimationFrame(renderLoop);
    }
    requestAnimationFrame(renderLoop);

    console.log('🏭 ANTIGRAVITY СГОУ Digital Twin v8.1 — запущен');
});
