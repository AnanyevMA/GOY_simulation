// ═══════════════════════════════════════════════════════════════════════
//  ANTIGRAVITY СГОУ — ОРКЕСТРАТОР (ES6 Entry Point)
//  Связывает model, renderer, ui, economics.
//  Физика: 10 тиков/сек. Рендер: 60 FPS. Тренды: 1/сек.
// ═══════════════════════════════════════════════════════════════════════

import { state, config, tick, forcePulseAll, addTornBag, setIdealMode, autoTune } from './model.js';
import { initRenderer, render, burstDust } from './renderer.js';
import { initUI, updateTelemetry, initCharts, updateCharts, processAlarms, syncSlidersToState } from './ui.js';
import { calcEconomics } from './economics.js';

// ── Инициализация ──
document.addEventListener('DOMContentLoaded', () => {
    // Canvas
    const cv = document.getElementById('cv');
    initRenderer(cv);

    // UI контролы
    initUI(state, {
        onForcePulse: () => forcePulseAll(),
        onBagRupture: () => { addTornBag(); burstDust(); },
        onIdealToggle: (on) => setIdealMode(on),
        // При изменении любого параметра в идеальном режиме → пересчёт
        onParamChange: (paramName) => {
            if (state.idealMode) {
                autoTune(paramName);
                syncSlidersToState(state);
            }
        },
    });

    // Chart.js тренды
    initCharts();

    // ── Физическая симуляция (10 Гц) ──
    setInterval(() => {
        tick();
        // Алармы
        processAlarms(state.alarms);
    }, 100);

    // ── Обновление телеметрии и трендов (1 Гц) ──
    setInterval(() => {
        const econ = calcEconomics(state.out);
        updateTelemetry(state, econ);
        updateCharts(state);
    }, 1000);

    // ── Рендер Canvas (60 FPS) ──
    function renderLoop() {
        render(state, config);
        requestAnimationFrame(renderLoop);
    }
    requestAnimationFrame(renderLoop);

    console.log('🏭 ANTIGRAVITY СГОУ Digital Twin v4.0 — запущен');
});
