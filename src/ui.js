// ═══════════════════════════════════════════════════════════════════════
//  ANTIGRAVITY СГОУ — UI MODULE
//  Привязка слайдеров, обновление телеметрии, Chart.js тренды, журнал алармов
// ═══════════════════════════════════════════════════════════════════════

let charts = {};
const TREND_SIZE = 60; // 60 точек (~60 сек при обновлении 1/сек)

// ── Инициализация контролов ──
export function initUI(state, callbacks) {
    // Привязка ползунков с поддержкой идеального режима
    const bind = (iid, lid, key, suf, obj, parser = parseFloat) => {
        const el = document.getElementById(iid);
        const lbl = document.getElementById(lid);
        if (!el || !lbl) return;
        el.addEventListener('input', e => {
            const v = parser(e.target.value);
            obj[key] = v;
            lbl.textContent = `${v} ${suf}`;
            // В идеальном режиме: при изменении одного параметра пересчитать остальные
            if (callbacks.onParamChange) callbacks.onParamChange(key);
        });
    };

    const I = state.inputs;
    bind('I-rpm',    'L-rpm',    'fanRPM',      '%', I, parseInt);
    bind('I-vane',   'L-vane',   'guideVane',    '%', I, parseInt);
    bind('I-temp',   'L-temp',   'gasTempSP',   '°C', I, parseInt);
    bind('I-hum',    'L-hum',    'gasHumidity',  '%', I, parseInt);
    bind('I-draft',  'L-draft',  'inletDraft',  'Па', I, parseInt);
    bind('I-fresh',  'L-fresh',  'freshFeed',   'т/ч', I);
    bind('I-recirc', 'L-recirc', 'recircFeed',  'т/ч', I);
    bind('I-regenSP','L-regenSP','regenSP',     'кПа', I);
    bind('I-timeSpeed','L-timeSpeed','timeSpeed','x', I, parseInt);
    bind('I-outdoor', 'L-outdoor', 'outdoorTemp', '°C', I, parseInt);

    // Порванные рукава (числовое поле)
    const tornEl = document.getElementById('I-torn');
    if (tornEl) {
        tornEl.addEventListener('input', e => {
            I.tornBags = Math.max(0, parseInt(e.target.value) || 0);
            if (callbacks.onParamChange) callbacks.onParamChange('tornBags');
        });
    }

    // Шиберы 4 труб
    ['1A', '1B', '2A', '2B'].forEach((id, i) => {
        const sl = document.getElementById(`I-pipe-${id}`);
        const lbl = document.getElementById(`L-pipe-${id}`);
        if (sl && lbl) {
            sl.addEventListener('input', e => {
                const v = parseInt(e.target.value);
                I.pipes[i].damper = v;
                lbl.textContent = `${v}%`;
                if (callbacks.onParamChange) callbacks.onParamChange('pipes');
            });
        }
    });

    // Кнопки
    document.getElementById('btn-pulse')?.addEventListener('click', () => {
        callbacks.onForcePulse();
        const b = document.getElementById('btn-pulse');
        b.textContent = '✓ OK'; setTimeout(() => b.textContent = '⚠ Авар. продувка', 800);
    });

    document.getElementById('btn-rupture')?.addEventListener('click', () => {
        callbacks.onBagRupture();
        const b = document.getElementById('btn-rupture');
        b.textContent = `💥 ${I.tornBags} шт!`;
        document.getElementById('I-torn').value = I.tornBags;
        setTimeout(() => b.textContent = '💥 Прорыв рукава', 1200);
    });

    // ── Кнопка «Идеальная ГОУ» ──
    const idealBtn = document.getElementById('btn-ideal');
    if (idealBtn) {
        idealBtn.addEventListener('click', () => {
            state.idealMode = !state.idealMode;
            callbacks.onIdealToggle(state.idealMode);
            idealBtn.textContent = state.idealMode ? '✨ ИДЕАЛЬНАЯ ГОУ: ВКЛ' : '✨ Идеальная ГОУ';
            idealBtn.className = state.idealMode ? 'btn btn-ideal active' : 'btn btn-ideal';
            if (state.idealMode) syncSlidersToState(state);
        });
    }
}

/**
 * syncSlidersToState() — обновляет ВСЕ ползунки и лейблы в DOM
 * на основе текущих значений state.inputs.
 * Вызывается после autoTune(), чтобы UI отражал пересчитанные значения.
 */
export function syncSlidersToState(state) {
    const I = state.inputs;
    const sync = (iid, lid, val, suf) => {
        const el = document.getElementById(iid);
        const lbl = document.getElementById(lid);
        if (el) el.value = val;
        if (lbl) lbl.textContent = `${val} ${suf}`;
    };
    sync('I-rpm',     'L-rpm',     I.fanRPM,      '%');
    sync('I-vane',    'L-vane',    I.guideVane,    '%');
    sync('I-temp',    'L-temp',    I.gasTempSP,    '°C');
    sync('I-hum',     'L-hum',     I.gasHumidity,  '%');
    sync('I-draft',   'L-draft',   I.inletDraft,   'Па');
    sync('I-fresh',   'L-fresh',   I.freshFeed,   'т/ч');
    sync('I-recirc',  'L-recirc',  I.recircFeed,  'т/ч');
    sync('I-regenSP', 'L-regenSP', I.regenSP,     'кПа');
    sync('I-timeSpeed','L-timeSpeed', I.timeSpeed,'x');
    sync('I-outdoor', 'L-outdoor', I.outdoorTemp, '°C');

    const tornEl = document.getElementById('I-torn');
    if (tornEl) tornEl.value = I.tornBags;

    ['1A', '1B', '2A', '2B'].forEach((id, i) => {
        const sl = document.getElementById(`I-pipe-${id}`);
        const lbl = document.getElementById(`L-pipe-${id}`);
        if (sl) sl.value = I.pipes[i].damper;
        if (lbl) lbl.textContent = `${I.pipes[i].damper}%`;
    });
}

// ── Обновление телеметрии ──
export function updateTelemetry(state, econ) {
    const O = state.out;
    const I = state.inputs;
    const set = (id, text, cls) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = text;
        if (cls !== undefined) el.className = 'tval ' + cls;
    };

    set('T-flow',    `${Math.round(O.gasFlow).toLocaleString('ru-RU')} м³/ч`);
    set('T-vel',     `${O.gasVelocity.toFixed(1)} м/с`);
    set('T-dpFilt',  `${O.avgFilterDP.toFixed(2)} кПа`, O.avgFilterDP > I.regenSP * 1.3 ? 'warn' : (O.avgFilterDP > I.regenSP * 0.8 ? 'caution' : ''));
    set('T-dpDuct',  `${(O.ductDP * 1000).toFixed(0)} Па`);
    set('T-dpTotal', `${O.totalDP.toFixed(2)} кПа`, O.totalDP > 3.0 ? 'warn' : '');
    set('T-amps',    `${Math.round(O.fanAmps)} А`, O.fanAmps > 350 * 0.9 ? 'warn' : '');
    set('T-power',   `${Math.round(O.fanPowerKW)} кВт`);
    set('T-temp',    `${O.actualTemp.toFixed(0)} °C`, O.actualTemp > 160 ? 'warn' : (O.actualTemp > 130 ? 'caution' : ''));

    set('T-hfIn',    `${O.hfIn.toFixed(1)} мг/нм³`);
    set('T-hfOut',   `${O.hfOut.toFixed(2)} мг/нм³`, O.hfOut > 1.0 ? 'warn' : (O.hfOut > 0.5 ? 'caution' : ''));
    set('T-dustOut', `${O.dustOut.toFixed(1)} мг/нм³`, O.dustOut > 10 ? 'warn' : (O.dustOut > 5 ? 'caution' : ''));

    set('T-eff1',    `${O.effReactor.toFixed(1)} %`, O.effReactor < 40 ? 'warn' : (O.effReactor < 55 ? 'caution' : 'ok'));
    set('T-eff2',    `${O.effCake.toFixed(1)} %`,    O.effCake < 90 ? 'warn' : (O.effCake < 95 ? 'caution' : 'ok'));
    set('T-effHF',   `${O.effHF.toFixed(1)} %`,      O.effHF < 95 ? 'warn' : (O.effHF < 98 ? 'caution' : 'ok'));
    set('T-effDust', `${O.effDust.toFixed(1)} %`,     O.effDust < 98 ? 'warn' : 'ok');
    set('T-fContent',`${O.fContent.toFixed(2)} wt%`,  O.fContent > 2.0 ? 'caution' : '');
    set('T-contact', `${O.contactTime.toFixed(1)} с`,  O.contactTime < 1.5 ? 'warn' : (O.contactTime < 2.0 ? 'caution' : 'ok'));
    set('T-vfilt',   `${(O.filtVelocity * 100).toFixed(1)} см/с`);
    set('T-regenCycles', `${O.regenCyclesPerHour} ц/ч`, O.regenCyclesPerHour > 70 ? 'warn' : (O.regenCyclesPerHour > 60 ? 'caution' : ''));
    set('T-draft',   `${Math.round(O.calcDraft)} Па`,  O.calcDraft > -50 ? 'warn' : (O.calcDraft > -100 ? 'caution' : 'ok'));

    set('T-airP',    `${O.receiverP.toFixed(2)} МПа`, O.receiverP < 0.35 ? 'warn' : (O.receiverP < 0.45 ? 'caution' : 'ok'));

    const stEl = document.getElementById('T-status');
    if (stEl) { stEl.textContent = O.status; stEl.className = 'tval ' + (O.status === 'НОРМА' ? 'ok' : 'warn'); }

    // Секции фильтра (мини-индикаторы)
    state.sections.forEach((sec, i) => {
        const fl = document.getElementById('SF-' + i);
        const lb = document.getElementById('SL-' + i);
        if (!fl || !lb) return;
        const d = Math.min(1, (sec.dp - 0.45) / (I.regenSP * 1.5 - 0.45));
        fl.style.height = (d * 100) + '%';
        if (sec.isRegen) {
            fl.style.background = '#58a6ff';
            lb.textContent = `С${i+1}↻`;
        } else {
            const r = Math.floor(63 + 185 * d), g = Math.floor(185 * (1 - d)), b = Math.floor(80 * (1 - d));
            fl.style.background = `rgb(${r},${g},${b})`;
            lb.textContent = `С${i+1} ${sec.dp.toFixed(1)}`;
        }
    });

    // Экономика
    if (econ) {
        set('E-power',   `${econ.powerKW} кВт`);
        set('E-costH',   `${econ.energyCostPerHour} ₽/ч`);
        set('E-costS',   `${econ.energyCostShift} ₽/смена`);
        set('E-fluorH',  `${econ.fluorLossCostH} ₽/ч`, econ.fluorLossCostH > 0 ? 'caution' : '');
        set('E-penaltyH',`${econ.penaltyCostH} ₽/ч`, econ.isPenalty ? 'warn' : 'ok');
    }
}

// ── Chart.js тренды ──
export function initCharts() {
    // Проверяем наличие Chart
    if (typeof Chart === 'undefined') { console.warn('Chart.js не загружен'); return; }

    Chart.defaults.color = '#8b949e';
    Chart.defaults.font.family = 'Consolas, monospace';
    Chart.defaults.font.size = 10;

    const make = (id, label, color, sugMax, refLine) => {
        const el = document.getElementById(id);
        if (!el) return null;
        const datasets = [{
            label, data: Array(TREND_SIZE).fill(null),
            borderColor: color, borderWidth: 1.5, tension: 0.3, pointRadius: 0, fill: false,
        }];
        if (refLine !== undefined) {
            datasets.push({
                label: 'Уставка', data: Array(TREND_SIZE).fill(refLine),
                borderColor: '#f8514955', borderWidth: 1, borderDash: [4, 4],
                pointRadius: 0, fill: false,
            });
        }
        return new Chart(el.getContext('2d'), {
            type: 'line',
            data: { labels: Array(TREND_SIZE).fill(''), datasets },
            options: {
                responsive: true, maintainAspectRatio: false, animation: false,
                scales: {
                    y: { suggestedMin: 0, suggestedMax: sugMax, grid: { color: '#21262d' } },
                    x: { display: false },
                },
                plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 10 } } },
            },
        });
    };

    charts.dp   = make('chart-dp',   'ΔP фильтра (кПа)', '#58a6ff', 2.5, 1.2);
    charts.hf   = make('chart-hf',   'HF выход (мг/нм³)', '#f85149', 2.0, 0.5);
    charts.amps = make('chart-amps', 'Ток (А)',           '#d29922', 400);
}

export function updateCharts(state) {
    const push = (chart, val) => {
        if (!chart) return;
        chart.data.datasets[0].data.shift();
        chart.data.datasets[0].data.push(val);
        // Обновляем refline (уставку) если есть
        if (chart.data.datasets[1]) {
            chart.data.datasets[1].data.shift();
            chart.data.datasets[1].data.push(chart.data.datasets[1].data[0]);
        }
        chart.update('none'); // 'none' = без анимации
    };
    push(charts.dp,   state.out.avgFilterDP);
    push(charts.hf,   state.out.hfOut);
    push(charts.amps, state.out.fanAmps);

    // Обновляем линию уставки ΔP
    if (charts.dp && charts.dp.data.datasets[1]) {
        charts.dp.data.datasets[1].data = Array(TREND_SIZE).fill(state.inputs.regenSP);
    }
}

// ── Журнал алармов ──
let alarmLog = [];
const MAX_ALARMS = 50;

export function processAlarms(alarms) {
    if (!alarms || alarms.length === 0) return;
    const now = new Date().toLocaleTimeString('ru-RU');
    const logEl = document.getElementById('alarm-log');
    if (!logEl) return;

    alarms.forEach(msg => {
        const entry = `[${now}] ${msg}`;
        alarmLog.unshift(entry);
    });
    if (alarmLog.length > MAX_ALARMS) alarmLog.length = MAX_ALARMS;

    logEl.innerHTML = alarmLog.map(e => {
        const isWarn = e.includes('⚠') || e.includes('🔥') || e.includes('💥');
        return `<div class="alarm-entry${isWarn ? ' alarm-warn' : ''}">${e}</div>`;
    }).join('');
}
