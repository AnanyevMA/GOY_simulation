// ═══════════════════════════════════════════════════════════════════════
//  ANTIGRAVITY СГОУ — ОРКЕСТРАТОР v8.0 (ES6 Entry Point)
//  Связывает model, advisor, config, renderer, ui, economics.
//  Физика: 10 Гц × timeSpeed. Рендер: 60 FPS. Тренды/Телеметрия: 1 Гц (с Peak Hold).
// ═══════════════════════════════════════════════════════════════════════

import {
    state,
    config,
    tick,
    forcePulseAll,
    addTornBag,
    setIdealMode,
    autoTune,
    triggerScenario,
    applyRecommendation,
    consumePeakMetrics,
} from './model.js';
import { initRenderer, render, burstDust } from './renderer.js';
import { initUI, updateTelemetry, initCharts, updateCharts, processAlarms, syncSlidersToState } from './ui.js';
import { calcEconomics } from './economics.js';

document.addEventListener('DOMContentLoaded', () => {
    const cv = document.getElementById('cv');
    initRenderer(cv);

    initUI(state, {
        onForcePulse: () => forcePulseAll(),
        onBagRupture: () => { addTornBag(); burstDust(); },
        onIdealToggle: (on) => setIdealMode(on),
        onScenario: (name) => {
            triggerScenario(name);
            syncSlidersToState(state);
        },
        onApplyRec: (recId) => {
            applyRecommendation(recId);
            syncSlidersToState(state);
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
    syncSlidersToState(state);
    updateTelemetry(state, calcEconomics(state.out, 0), consumePeakMetrics());

    // ── Физическая симуляция (10 Гц базовая, ускоряется ползунком timeSpeed) ──
    setInterval(() => {
        const speed = state.inputs.timeSpeed || 1;
        for (let i = 0; i < speed; i++) {
            tick();
            processAlarms(state.alarms);
        }
    }, 100);

    // ── Обновление телеметрии и трендов (1 Гц с пиковым детектором регенерации) ──
    setInterval(() => {
        const speed = state.inputs.timeSpeed || 1;
        const peaks = consumePeakMetrics();
        const econ = calcEconomics(state.out, speed / 60);
        updateTelemetry(state, econ, peaks);
        updateCharts(state, peaks);
    }, 1000);

    // ── Рендер Canvas (60 FPS) ──
    function renderLoop() {
        render(state, config);
        requestAnimationFrame(renderLoop);
    }
    requestAnimationFrame(renderLoop);

    console.log('🏭 ANTIGRAVITY СГОУ Digital Twin v8.0 — запущен');
});
