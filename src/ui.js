// ═══════════════════════════════════════════════════════════════════════
//  ANTIGRAVITY СГОУ — UI MODULE v8.1
//  Привязка органов управления, интерактивные подсказки «Физика процесса»,
//  обновление телеметрии с пиковым детектором, Chart.js тренды, советчик APM.
// ═══════════════════════════════════════════════════════════════════════

import { config, PHYSICS_HINTS, getTornBagsInSection } from './config.js';

let charts = {};
let uiCallbacks = null;
const TREND_SIZE = 60;

// ── Отображение обучающей подсказки по физике параметра ──
function clampInt(v, lo, hi) {
    return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0));
}

// ── «Живая» строка под подсказкой: текущее значение параметра и величины, на которые он влияет ──
// Карточка стоит под схемой, далеко от ползунков, поэтому показываем результат сразу в ней.
const f0 = (v) => Number.isFinite(v) ? Math.round(v) : '—';
const f1 = (v) => Number.isFinite(v) ? v.toFixed(1) : '—';
const f2 = (v) => Number.isFinite(v) ? v.toFixed(2) : '—';
const kn = (v) => Number.isFinite(v) ? Math.round(v / 1000) : '—';
export const HINT_LIVE = {
    fanRPM:        (I, O) => `<b>RPM ${f0(I.fanRPM)}%</b> → расход <b>${kn(O.normalFlow)}</b> тыс. нм³/ч · ток <b>${f0(O.fanAmps)} А</b> · мощность <b>${f0(O.fanPowerKW)} кВт</b>`,
    guideVane:     (I, O) => `<b>НА ${f0(I.guideVane)}%</b> → расход <b>${kn(O.normalFlow)}</b> тыс. нм³/ч · v_f <b>${f2(O.filtVelocity * 100)} см/с</b> · τ <b>${f1(O.contactTime)} с</b> · HF на трубе <b>${f2(O.hfOut)}</b> мг/нм³ · ток <b>${f0(O.fanAmps)} А</b>`,
    gasTempSP:     (I, O) => `<b>уставка ${f0(I.gasTempSP)}°C</b> → T реактора <b>${f0(O.actualTemp)}°C</b> · запас до росы <b>${f0(O.dewPointMargin)}°C</b> · улавливание HF <b>${f2(O.effHF)}%</b>`,
    gasHumidity:   (I, O) => `<b>H ${f0(I.gasHumidity)}%</b> → T росы <b>${f0(O.dewPointTemp)}°C</b> · запас <b>${f0(O.dewPointMargin)}°C</b> · продувок <b>${f0(O.regenCyclesPerHour)} ц/ч</b>`,
    inletDraft:    (I, O) => `<b>уставка ${f0(I.inletDraft)} Па</b> → факт <b>${f0(O.calcDraft)} Па</b> · захват <b>${f1(O.captureEff * 100)}%</b> · HF в корпус <b>${f1(O.hfFugitiveKgH)} кг/ч</b>`,
    dilutionValve: (I, O) => `<b>клапан ${f0(I.dilutionValve)}%</b> → доля подсоса <b>${f0(O.dilutionFrac * 100)}%</b> · T реактора <b>${f0(O.actualTemp)}°C</b> · разрежение <b>${f0(O.calcDraft)} Па</b>`,
    freshFeed:     (I, O) => `<b>свежий ${f1(I.freshFeed)} т/ч</b> → F во вторичном <b>${f2(O.fContent)} wt%</b> · η₁ <b>${f1(O.effReactor)}%</b> · HF на трубе <b>${f2(O.hfOut)}</b> мг/нм³`,
    recircFeed:    (I, O) => `<b>рецирк ${f1(I.recircFeed)} т/ч</b> (${f1(I.freshFeed > 0.05 ? I.recircFeed / I.freshFeed : 0)}× от свежего) → активность пирога <b>${f0(O.cakeActivity * 100)}%</b> · η₂ <b>${f1(O.effCake)}%</b>`,
    regenSP:       (I, O) => `<b>уставка ${f2(I.regenSP)} кПа</b> → ΔP фильтра <b>${f2(O.avgFilterDP)} кПа</b> · продувок <b>${f0(O.regenCyclesPerHour)} ц/ч</b> · η₂ <b>${f1(O.effCake)}%</b> · ресивер <b>${f2(O.receiverP)} МПа</b>`,
    timeSpeed:     (I) => `<b>${f0(I.timeSpeed)}×</b> → 1 с реального времени = <b>${f0(I.timeSpeed)} мин</b> процесса`,
    tornBags:      (I, O) => `<b>порвано ${f0(I.tornBags)} из ${config.totalBags}</b> → пыль на трубе <b>${f1(O.dustOut)}</b> мг/нм³ (пик ${f1(O.peakDustDisplay)}) · HF <b>${f2(O.hfOut)}</b> мг/нм³`,
    pipesDamper:   (I, O) => `шиберы ${I.pipes.map(p => `${p.id} ${f0(p.damper)}%`).join(' · ')} → разрежение по ветвям <b>${O.pipeFlows.map(p => f0(p.draft)).join(' / ')} Па</b>`,
    outdoorTemp:   (I, O) => `<b>${f0(I.outdoorTemp)}°C</b> → самотяга трубы <b>${f0(O.stackDraft * 1000)} Па</b> · T реактора <b>${f0(O.actualTemp)}°C</b> · расход <b>${kn(O.normalFlow)}</b> тыс. нм³/ч`,
};

let hintState = null;      // ссылка на state для «живой» строки (задаётся в initUI)
let currentHintKey = null;

function renderHintLive() {
    const liveEl = document.getElementById('hint-live');
    if (!liveEl) return;
    const fn = HINT_LIVE[currentHintKey];
    liveEl.innerHTML = (fn && hintState) ? `▶ Сейчас: ${fn(hintState.inputs, hintState.out)}` : '';
}

export function showPhysicsHint(paramKey) {
    const hint = PHYSICS_HINTS[paramKey];
    if (!hint) return;
    currentHintKey = paramKey;
    const titleEl = document.getElementById('hint-title');
    const formEl = document.getElementById('hint-formula');
    const effEl = document.getElementById('hint-effect');
    if (titleEl) titleEl.textContent = `📘 Физика: ${hint.title}`;
    if (formEl) formEl.textContent = hint.formula;
    if (effEl) effEl.textContent = hint.effect;
    renderHintLive();
}

// ── Инициализация контролов ──
export function initUI(state, callbacks) {
    uiCallbacks = callbacks;
    hintState = state;

    const bind = (iid, lid, key, suf, obj, parser = parseFloat) => {
        const el = document.getElementById(iid);
        const lbl = document.getElementById(lid);
        if (!el || !lbl) return;
        el.addEventListener('input', e => {
            const v = parser(e.target.value);
            obj[key] = v;
            lbl.textContent = `${v} ${suf}`;
            showPhysicsHint(key);
            if (callbacks.onParamChange) callbacks.onParamChange(key);
        });
    };

    const I = state.inputs;
    bind('I-rpm',       'L-rpm',       'fanRPM',        '%',   I, parseInt);
    bind('I-vane',      'L-vane',      'guideVane',     '%',   I, parseFloat);
    bind('I-temp',      'L-temp',      'gasTempSP',     '°C',  I, parseInt);
    bind('I-hum',       'L-hum',       'gasHumidity',   '%',   I, parseInt);
    bind('I-draft',     'L-draft',     'inletDraft',    'Па',  I, parseInt);
    bind('I-dilution',  'L-dilution',  'dilutionValve', '%',   I, parseInt);
    bind('I-fresh',     'L-fresh',     'freshFeed',     'т/ч', I, parseFloat);
    bind('I-recirc',    'L-recirc',    'recircFeed',    'т/ч', I, parseFloat);
    bind('I-regenSP',   'L-regenSP',   'regenSP',       'кПа', I, parseFloat);
    bind('I-timeSpeed', 'L-timeSpeed', 'timeSpeed',     'x',   I, parseInt);
    bind('I-outdoor',   'L-outdoor',   'outdoorTemp',   '°C',  I, parseInt);

    // Наведение курсора на блоки ползунков — показывает физическую формулу и описание
    document.querySelectorAll('[data-hint]').forEach(el => {
        const show = () => {
            const key = el.getAttribute('data-hint');
            if (key) showPhysicsHint(key);
        };
        el.addEventListener('mouseenter', show);
        el.addEventListener('focusin', show);          // подсказка и при навигации с клавиатуры / тач-фокусе
        el.addEventListener('touchstart', show, { passive: true });
    });

    // Порванные рукава (числовое поле)
    const tornEl = document.getElementById('I-torn');
    if (tornEl) {
        tornEl.addEventListener('input', e => {
            I.tornBags = clampInt(parseInt(e.target.value), 0, config.totalBags);
            showPhysicsHint('tornBags');
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
                showPhysicsHint('pipesDamper');
                if (callbacks.onParamChange) callbacks.onParamChange('pipes');
            });
        }
    });

    // Кнопки продувки и порыва
    document.getElementById('btn-pulse')?.addEventListener('click', () => {
        callbacks.onForcePulse();
        const b = document.getElementById('btn-pulse');
        b.textContent = '✓ ИМПУЛЬС!';
        setTimeout(() => { b.textContent = '⚠ Залп. продувка'; }, 800);
    });

    document.getElementById('btn-rupture')?.addEventListener('click', () => {
        callbacks.onBagRupture();
        const b = document.getElementById('btn-rupture');
        b.textContent = `💥 ${I.tornBags} шт!`;
        const tInput = document.getElementById('I-torn');
        if (tInput) tInput.value = I.tornBags;
        setTimeout(() => { b.textContent = '💥 Порыв рукава'; }, 1200);
    });

    // Кнопка «Идеальная ГОУ (Автопилот)»
    const idealBtn = document.getElementById('btn-ideal');
    if (idealBtn) {
        idealBtn.addEventListener('click', () => {
            const nextState = !state.idealMode;
            callbacks.onIdealToggle(nextState);
            idealBtn.textContent = state.idealMode ? '✨ АВТОПИЛОТ: ВКЛЮЧЁН' : '✨ Идеальная ГОУ (Автопилот)';
            idealBtn.className = state.idealMode ? 'btn btn-ideal active' : 'btn btn-ideal';
            if (state.idealMode) syncSlidersToState(state);
        });
    }

    // 6 обучающих экспресс-сценариев аномалий
    const scenarioButtons = [
        ['scen-anode',  'anode_effect', '#f85149'],
        ['scen-winter', 'winter_frost', '#79c0ff'],
        ['scen-wear',   'bag_wear',     '#d29922'],
        ['scen-feeder', 'feeder_fault', '#f85149'],
        ['scen-wet',    'wet_blinding', '#79c0ff'],
        ['scen-air',    'air_drop',     '#d29922'],
    ];
    scenarioButtons.forEach(([btnId, scenName, highlightCol]) => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.addEventListener('click', () => {
                callbacks.onScenario?.(scenName);
                btn.style.borderColor = highlightCol;
                setTimeout(() => { btn.style.borderColor = ''; }, 1500);
            });
        }
    });
}

/**
 * Синхронизирует все ползунки и поля ввода с текущими значениями state.inputs
 */
export function syncSlidersToState(state) {
    const I = state.inputs;
    const sync = (iid, lid, val, suf) => {
        const el = document.getElementById(iid);
        const lbl = document.getElementById(lid);
        if (el) el.value = val;
        if (lbl) lbl.textContent = `${val} ${suf}`;
    };
    sync('I-rpm',       'L-rpm',       I.fanRPM,               '%');
    sync('I-vane',      'L-vane',      Math.round(I.guideVane), '%');
    sync('I-temp',      'L-temp',      I.gasTempSP,            '°C');
    sync('I-hum',       'L-hum',       I.gasHumidity,          '%');
    sync('I-draft',     'L-draft',     I.inletDraft,           'Па');
    sync('I-dilution',  'L-dilution',  I.dilutionValve,        '%');
    sync('I-fresh',     'L-fresh',     I.freshFeed,            'т/ч');
    sync('I-recirc',    'L-recirc',    I.recircFeed,           'т/ч');
    sync('I-regenSP',   'L-regenSP',   I.regenSP,              'кПа');
    sync('I-timeSpeed', 'L-timeSpeed', I.timeSpeed,            'x');
    sync('I-outdoor',   'L-outdoor',   I.outdoorTemp,          '°C');

    const tornEl = document.getElementById('I-torn');
    if (tornEl) tornEl.value = I.tornBags;

    ['1A', '1B', '2A', '2B'].forEach((id, i) => {
        const sl = document.getElementById(`I-pipe-${id}`);
        const lbl = document.getElementById(`L-pipe-${id}`);
        if (sl) sl.value = I.pipes[i].damper;
        if (lbl) lbl.textContent = `${I.pipes[i].damper}%`;
    });
}

// ── Обновление телеметрии (1 Гц) ──
export function updateTelemetry(state, econ, peaks = null) {
    const O = state.out;
    const I = state.inputs;
    const set = (id, text, cls) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = text;
        if (cls !== undefined) el.className = 'tval ' + cls;
    };

    const hfDisplay = peaks ? peaks.hfOut : O.hfOut;
    const dustDisplay = peaks ? peaks.dustOut : O.dustOut;

    set('T-flow', `${Math.round(O.normalFlow / 1000)} тыс. нм³/ч (${Math.round(O.gasFlow / 1000)} тыс. м³/ч)`);
    set('T-vel',  `${O.gasVelocity.toFixed(1)} м/с`);
    set(
        'T-temp',
        `${O.actualTemp.toFixed(0)} °C (роса ${O.dewPointTemp.toFixed(0)}°C)`,
        O.actualTemp > 145 || O.dewPointMargin < 12 ? 'warn' : (O.actualTemp > 120 || O.dewPointMargin < 20 ? 'caution' : 'ok')
    );

    set('T-dpFilt',  `${O.avgFilterDP.toFixed(2)} кПа`, O.avgFilterDP > I.regenSP * 1.3 ? 'warn' : (O.avgFilterDP > I.regenSP * 0.9 ? 'caution' : ''));
    set('T-dpDuct',  `${(O.ductDP * 1000).toFixed(0)} Па`);
    set(
        'T-dpTotal',
        `${O.totalDP.toFixed(2)} кПа (тяга +${Math.round(O.stackDraft * 1000)}Па)`,
        O.totalDP > 7.5 ? 'warn' : (O.totalDP > 6.0 ? 'caution' : '')
    );

    set('T-amps',  `${Math.round(O.fanAmps)} А`, O.fanAmps > config.fanMaxAmps ? 'warn' : (O.fanAmps > config.fanMaxAmps * 0.85 ? 'caution' : ''));
    set('T-power', `${Math.round(O.fanPowerKW)} кВт (η вент. ${(O.fanEff * 100).toFixed(0)}%)`);
    set('T-airP',  `${O.receiverP.toFixed(2)} МПа`, O.receiverP < 0.36 ? 'warn' : (O.receiverP < 0.45 ? 'caution' : 'ok'));

    set('T-hfIn',    `${O.hfIn.toFixed(1)} мг/нм³ (${O.hfGenKgH.toFixed(1)} кг/ч)`);
    set(
        'T-capture',
        `${(O.captureEff * 100).toFixed(1)} % (в корпус ${O.hfFugitiveKgH.toFixed(1)} кг/ч)`,
        O.captureEff < 0.9 ? 'warn' : (O.captureEff < 0.97 ? 'caution' : 'ok')
    );
    set('T-hfOut',   `${hfDisplay.toFixed(2)} мг/нм³`, hfDisplay > 1.0 ? 'warn' : (hfDisplay > 0.5 ? 'caution' : 'ok'));
    set('T-dustOut', `${dustDisplay.toFixed(1)} мг/нм³`, dustDisplay > 10 ? 'warn' : (dustDisplay > 5 ? 'caution' : 'ok'));

    set('T-eff1',    `${O.effReactor.toFixed(1)} %`, O.effReactor < 45 ? 'warn' : (O.effReactor < 58 ? 'caution' : 'ok'));
    set('T-eff2',    `${O.effCake.toFixed(1)} % (акт. ${(O.cakeActivity * 100).toFixed(0)}%)`, O.effCake < 95 ? 'warn' : (O.effCake < 98.5 ? 'caution' : 'ok'));
    set('T-effHF',   `${O.effHF.toFixed(2)} %`, O.effHF < 98.5 ? 'warn' : (O.effHF < 99.6 ? 'caution' : 'ok'));
    set('T-effDust', `${O.effDust.toFixed(2)} %`, O.effDust < 99.5 ? 'warn' : 'ok');
    set('T-fContent', `${O.fContent.toFixed(2)} wt%`, (O.fContent > 1.75 || O.fContent < 0.45) ? 'caution' : 'ok');
    set('T-contact', `${O.contactTime.toFixed(1)} с`, O.contactTime < 1.6 ? 'warn' : (O.contactTime < 2.0 ? 'caution' : 'ok'));
    set('T-vfilt',   `${(O.filtVelocity * 100).toFixed(2)} см/с`);
    set('T-regenCycles', `${O.regenCyclesPerHour} ц/ч`, O.regenCyclesPerHour > 70 ? 'warn' : (O.regenCyclesPerHour > 60 ? 'caution' : 'ok'));
    set(
        'T-draft',
        `${Math.round(O.calcDraft)} Па (уст ${I.inletDraft} Па)`,
        O.calcDraft > -50 ? 'warn' : (O.calcDraft > -100 ? 'caution' : 'ok')
    );

    const stEl = document.getElementById('T-status');
    if (stEl) {
        stEl.textContent = O.status;
        stEl.className = 'tval ' + (O.status === 'НОРМА' ? 'ok' : 'warn');
    }

    // Мини-индикаторы 4 секций фильтра
    state.sections.forEach((sec, i) => {
        const fl = document.getElementById('SF-' + i);
        const lb = document.getElementById('SL-' + i);
        if (!fl || !lb) return;
        const d = Math.min(1, Math.max(0, (sec.dp - 0.45) / (I.regenSP * 1.5 - 0.45)));
        fl.style.height = (d * 100) + '%';
        const tornInSec = getTornBagsInSection(i, I.tornBags, config.numSections);
        const tornMark = tornInSec > 0 ? `⚡${tornInSec}` : '';
        if (sec.isRegen) {
            fl.style.background = '#58a6ff';
            lb.textContent = `С${i + 1}↻${tornMark}`;
        } else {
            const r = Math.floor(63 + 185 * d);
            const g = Math.floor(185 * (1 - d));
            const b = Math.floor(80 * (1 - d));
            fl.style.background = tornInSec > 0 ? '#f85149' : `rgb(${r},${g},${b})`;
            lb.textContent = `С${i + 1} ${sec.dp.toFixed(1)}${tornMark}`;
        }
    });

    // Экономика
    if (econ) {
        set('E-power',    `${econ.powerKW} кВт`);
        set('E-costH',    `${econ.energyCostPerHour} ₽/ч`);
        set('E-costS',    `${econ.energyCostShift} ₽ (${econ.energyKWH} кВт·ч · ${econ.shiftHours}/8 ч)`);
        set('E-fluorH',   `${econ.fluorLossCostH} ₽/ч`, Number(econ.fluorLossCostH) > 500 ? 'caution' : '');
        set('E-penaltyH', `${econ.penaltyCostH} ₽/ч`, econ.isPenalty ? 'warn' : 'ok');
    }

    updateAdvisorUI(state);
    renderHintLive();

    if (state.idealMode) syncSlidersToState(state);
}

// ── Рендеринг виджета советчика APM ──
function updateAdvisorUI(state) {
    const adv = state.advisor;
    if (!adv) return;

    const badgeEl = document.getElementById('adv-health-badge');
    const fillEl = document.getElementById('adv-health-fill');
    if (badgeEl && fillEl) {
        let cls = 'health-ok';
        let fillCol = '#3fb950';
        if (adv.healthIndex < 70) { cls = 'health-danger'; fillCol = '#f85149'; }
        else if (adv.healthIndex < 90) { cls = 'health-warn'; fillCol = '#d29922'; }

        badgeEl.className = 'health-badge ' + cls;
        badgeEl.textContent = `${adv.healthIndex}% · ${adv.healthStatus}`;
        fillEl.style.width = adv.healthIndex + '%';
        fillEl.style.background = fillCol;
    }

    const updateChip = (chipId, modData) => {
        const valEl = document.getElementById(`chip-${chipId}-val`);
        const chipBox = document.getElementById(`chip-${chipId}`);
        if (!valEl || !modData) return;
        valEl.textContent = modData.label;
        valEl.className = `mod-chip-val mod-${modData.status}`;
        if (chipBox) chipBox.title = modData.desc || '';
    };
    updateChip('filter', adv.modules.filter);
    updateChip('alumina', adv.modules.alumina);
    updateChip('fan', adv.modules.fan);

    const container = document.getElementById('adv-recs-container');
    if (!container) return;

    const idealBanner = state.idealMode ? `
        <div class="rec-card rec-eco">
            <div class="rec-title"><span>✨ АВТОПИЛОТ СОВЕТЧИКА АКТИВЕН</span></div>
            <div class="rec-reason">НА автоматически удерживает уставку разрежения (${state.inputs.inletDraft} Па), клапан подсоса защищает фильтр от перегрева, дозаторы Al₂O₃ ведут баланс сорбции. Ручное изменение любого ползунка переводит этот контур под контроль оператора.</div>
        </div>` : '';

    if (!adv.recommendations || adv.recommendations.length === 0) {
        container.innerHTML = idealBanner || `<div class="rec-empty">✓ Техпроцесс сбалансирован, все 3 контура в технологическом оптимуме</div>`;
        return;
    }

    container.innerHTML = idealBanner + adv.recommendations.map(r => `
        <div class="rec-card rec-${r.type}">
            <div class="rec-title"><span>💡 ${r.title}</span></div>
            <div class="rec-reason">${r.reason}</div>
            <div class="rec-effect">⚡ ${r.effectText}</div>
            <div class="rec-btn-row">
                <span style="font-size:8px; color:#8b949e;">${r.actionText}</span>
                <button class="btn-apply-rec" data-rec-id="${r.id}">Применить</button>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.btn-apply-rec').forEach(btn => {
        btn.addEventListener('click', e => {
            const recId = e.target.getAttribute('data-rec-id');
            if (uiCallbacks && uiCallbacks.onApplyRec) {
                uiCallbacks.onApplyRec(recId);
                btn.textContent = '✓ ПРИНЯТО';
                btn.style.background = '#1f6feb';
                btn.style.borderColor = '#58a6ff';
            }
        });
    });
}

// ── Chart.js тренды ──
export function initCharts() {
    if (typeof Chart === 'undefined') {
        console.warn('Chart.js не загружен');
        return;
    }

    Chart.defaults.color = '#8b949e';
    Chart.defaults.font.family = 'Consolas, monospace';
    Chart.defaults.font.size = 10;

    const make = (id, label, color, sugMax, refLine, secondDataset = null) => {
        const el = document.getElementById(id);
        if (!el) return null;
        const datasets = [{
            label,
            data: Array(TREND_SIZE).fill(null),
            borderColor: color,
            borderWidth: 1.5,
            tension: 0.25,
            pointRadius: 0,
            fill: false,
        }];
        if (secondDataset) {
            datasets.push({
                label: secondDataset.label,
                data: Array(TREND_SIZE).fill(null),
                borderColor: secondDataset.color,
                borderWidth: 1.2,
                tension: 0.25,
                pointRadius: 0,
                fill: false,
            });
        }
        if (refLine !== undefined) {
            datasets.push({
                label: 'ПДК/Уст',
                data: Array(TREND_SIZE).fill(refLine),
                borderColor: '#f8514966',
                borderWidth: 1,
                borderDash: [4, 4],
                pointRadius: 0,
                fill: false,
            });
        }
        return new Chart(el.getContext('2d'), {
            type: 'line',
            data: { labels: Array(TREND_SIZE).fill(''), datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                scales: {
                    y: { suggestedMin: 0, suggestedMax: sugMax, grid: { color: '#21262d' } },
                    x: { display: false },
                },
                plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 10 } } },
            },
        });
    };

    charts.dp   = make('chart-dp',   'ΔP фильтра (кПа)', '#58a6ff', 2.2, 1.2);
    charts.hf   = make('chart-hf',   'HF вых (мг/нм³)',  '#f85149', 1.8, 0.5, { label: 'Пыль/10', color: '#fb923c' });
    charts.amps = make('chart-amps', 'Ток дымососа (А)', '#d29922', Math.round(config.fanMaxAmps * 1.1), config.fanMaxAmps);
}

export function updateCharts(state, peaks = null) {
    const hfVal = peaks ? peaks.hfOut : state.out.hfOut;
    const dustVal = peaks ? peaks.dustOut : state.out.dustOut;

    if (charts.dp) {
        charts.dp.data.datasets[0].data.shift();
        charts.dp.data.datasets[0].data.push(state.out.avgFilterDP);
        if (charts.dp.data.datasets[1]) {
            charts.dp.data.datasets[1].data = Array(TREND_SIZE).fill(state.inputs.regenSP);
        }
        charts.dp.update('none');
    }

    if (charts.hf) {
        charts.hf.data.datasets[0].data.shift();
        charts.hf.data.datasets[0].data.push(hfVal);
        // Вторая линия на графике эмиссии — Пыль / 10 (где ПДК 5 мг/нм³ = 0.5 на шкале, совпадает с линией ПДК!)
        if (charts.hf.data.datasets[1]) {
            charts.hf.data.datasets[1].data.shift();
            charts.hf.data.datasets[1].data.push(dustVal / 10);
        }
        charts.hf.update('none');
    }

    if (charts.amps) {
        charts.amps.data.datasets[0].data.shift();
        charts.amps.data.datasets[0].data.push(state.out.fanAmps);
        charts.amps.update('none');
    }
}

// ── Журнал технологических событий и алармов ──
const MAX_ALARMS = 50;
let alarmLog = [];

const escapeHtml = (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Ключ группировки: текст сообщения без чисел (чтобы «Секция 1 (ΔP=1.29)» и «Секция 3 (ΔP=1.31)» слились). */
export function alarmKey(msg) {
    return String(msg).replace(/[0-9]+([.,][0-9]+)?/g, '#');
}

/**
 * Чистая функция группировки: подряд идущие сообщения одного типа сворачиваются в одну строку «×N»
 * (при ускорении 10× журнал иначе вытесняет важные события сотнями одинаковых «Авто-продувок»).
 * @returns {Array<{key,msg,time,count}>} новый журнал (новые сверху, не длиннее MAX_ALARMS)
 */
export function groupAlarms(log, alarms, timeLabel, max = MAX_ALARMS) {
    const out = log.map(e => ({ ...e }));
    for (const msg of alarms) {
        const key = alarmKey(msg);
        if (out.length && out[0].key === key) {
            out[0].count++;
            out[0].msg = msg;
            out[0].time = timeLabel;
        } else {
            out.unshift({ key, msg, time: timeLabel, count: 1 });
        }
    }
    if (out.length > max) out.length = max;
    return out;
}

export function processAlarms(alarms) {
    if (!alarms || alarms.length === 0) return;
    const logEl = document.getElementById('alarm-log');
    if (!logEl) return;
    alarmLog = groupAlarms(alarmLog, alarms, new Date().toLocaleTimeString('ru-RU'));

    logEl.innerHTML = alarmLog.map(e => {
        const isWarn = /[⚠🔥💥⛔]/u.test(e.msg);
        const cnt = e.count > 1 ? ` <span class="alarm-count">×${e.count}</span>` : '';
        return `<div class="alarm-entry${isWarn ? ' alarm-warn' : ''}">[${escapeHtml(e.time)}] ${escapeHtml(e.msg)}${cnt}</div>`;
    }).join('');
}
