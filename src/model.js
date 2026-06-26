// ═══════════════════════════════════════════════════════════════════════
//  ANTIGRAVITY СГОУ — ФИЗИЧЕСКИЙ ДВИЖОК v4.1
//  Аналитическая рабочая точка, N=Q·ΔP/η, время контакта через V/Q,
//  HF∝T, ΔP=f(vf,W), импульсный сброс, F% экспоненциальный фильтр.
// ═══════════════════════════════════════════════════════════════════════

// ── Конфигурация установки (константы) ──
export const config = {
    totalBags:       800,        // Всего рукавов (4 секции × 200)
    bagsPerSection:  200,
    numSections:     4,
    ductArea:        8.0,        // Сечение газохода (м²)
    nominalFlow:     350000,     // Номинальный расход (нм³/ч)
    maxFanPressure:  4.5,        // Макс. напор дымососа при 100% (кПа)
    fanMaxAmps:      350,        // Ном. ток (А)
    fanVoltage:      6.0,        // Напряжение (кВ)
    fanCosF:         0.85,       // cosφ двигателя
    fanEfficiency:   0.75,       // КПД дымососа
    baseDP:          0.45,       // ΔP чистого фильтра (кПа)
    potroomCurrent:  300,        // Ток серии (кА)

    // Генерация загрязнителей
    hfGenFactor:     0.03,       // кг HF / кА·ч  → 9 кг/ч при 300 кА
    dustGenFactor:   0.08,       // кг пыли / кА·ч → 24 кг/ч при 300 кА

    // Адсорбция
    maxReactorEff:   0.70,       // Макс. η₁ реактора
    maxCakeEff:      0.995,      // Макс. η₂ пирога
    reactorK:        0.12,       // Константа Лэнгмюра для реактора
    cakeK:           3.5,        // Константа filsorption
    recircEfficiency: 0.40,      // Эффективность рецирк. Al₂O₃ (40% от свежего)
    maxFContent:     2.5,        // Макс. содержание F (wt%)
    reactorVolume:   120,        // Объём реактора (м³)
    optimalContactTime: 2.5,     // Оптимальное время контакта (сек)

    // Газоходы (Дарси-Вейсбах)
    ductLength:      200,        // Длина газоходов (м)
    ductDiameter:    3.2,        // Эквивалентный диаметр (м)
    ductFriction:    0.02,       // Коэфф. трения λ
    reactorDP:       0.15,       // ΔP реактора (кПа, const)

    // Фильтр
    filterArea:      5000,       // Общая площадь фильтрации (м²)
    cakeResistance:  8000,       // Коэфф. сопротивления пирога (Па·с/кг·м)
    residualCake:    1.0,        // Остаточная масса пирога после продувки (кг/м²)
    pulseBlowEff:    0.80,       // Доля пирога, сбитого при нормальной продувке
    pulseBlowEffLow: 0.40,      // То же при низком давлении воздуха

    // Сжатый воздух
    pulseVolume:     0.05,       // м³ воздуха на 1 рукав за импульс
    airPressureNom:  0.60,       // Номинальное давление в ресивере (МПа)
    airRecoveryRate: 0.005,      // Скорость восстановления давления (МПа/тик)
    airPressureDrop: 0.008,      // Падение давления за продувку 1 секции (МПа)

    // Тепловая инерция
    thermalK:        0.008,      // Коэфф. теплообмена (безразмерный, на тик)
};

// ── Мутабельное состояние симуляции ──
export const state = {
    // Входные параметры (управляются из UI)
    inputs: {
        fanRPM:      100,     // % оборотов (обычно 100 — пост. скорость)
        guideVane:   80,      // % открытия НА (5–100) — ОСНОВНОЙ регулятор
        gasTempSP:   110,     // Уставка температуры газа (°C)
        gasHumidity: 5,       // Влажность (%)
        inletDraft:  -150,    // Смещение разрежения (Па) — «подсос/утечка»
        freshFeed:   5.0,     // Свежий Al₂O₃ (т/ч)
        recircFeed:  20,      // Рецирк. AlF₃ (т/ч)
        regenSP:     1.2,     // Уставка авто-продувки (кПа)
        tornBags:    0,       // Порвано рукавов
        timeSpeed:   1,       // Скорость симуляции
        pipes: [
            { id: '1A', damper: 100 },
            { id: '1B', damper: 100 },
            { id: '2A', damper: 100 },
            { id: '2B', damper: 100 },
        ]
    },

    // Секции фильтра (4 шт)
    sections: [
        { dp: 0.55, cakeMass: 5,   isRegen: false, regenTimer: 0, regenTimerMax: 15 },
        { dp: 0.60, cakeMass: 6,   isRegen: false, regenTimer: 0, regenTimerMax: 15 },
        { dp: 0.50, cakeMass: 4,   isRegen: false, regenTimer: 0, regenTimerMax: 15 },
        { dp: 0.58, cakeMass: 5.5, isRegen: false, regenTimer: 0, regenTimerMax: 15 },
    ],

    // Внутреннее состояние физики
    phys: {
        fanAngle:       0,
        regenCooldown:  0,
        fContentAccum:  0.3,
        actualTemp:     110,     // Фактическая T° газа (с инерцией)
        receiverPressure: 0.60,  // Давление в ресивере (МПа)
        tickCount:      0,
        networkK:       8e-12,   // Удельное сопротивление сети (кПа·ч²/м⁶) ~0.7кПа/(300000)²
    },

    // Выходные параметры (рассчитываются каждый тик)
    out: {
        gasFlow:      0,      // Факт. расход (м³/ч при раб. T°)
        normalFlow:   0,      // Нормальный расход (нм³/ч при 0°C)
        gasVelocity:  0,      // Скорость в газоходе (м/с)
        filtVelocity: 0,      // Скорость фильтрации (м/с)
        fanAmps:      0,      // Ток дымососа (А)
        fanPowerKW:   0,      // Мощность дымососа (кВт)
        avgFilterDP:  0,      // ΔP фильтра (кПа)
        ductDP:       0,      // ΔP газоходов (кПа)
        totalDP:      0,      // Общее ΔP тракта (кПа)
        calcDraft:    0,      // Расчётное разрежение (Па)
        hfIn:         0,      // HF на входе (мг/нм³)
        hfOut:        0,      // HF на выходе (мг/нм³)
        hfGenKgH:     0,      // Генерация HF (кг/ч)
        dustOut:      0,      // Пыль на выходе (мг/нм³)
        effReactor:   0,      // η₁ реактора (%)
        effCake:      0,      // η₂ пирога (%)
        effHF:        0,      // Общая η по HF (%)
        effDust:      0,      // η пылеулавливания (%)
        fContent:     0,      // Содержание F в глинозёме (wt%)
        actualTemp:   110,    // Фактическая T° (с инерцией)
        contactTime:  2.5,    // Время контакта в реакторе (сек)
        airConsumption: 0,    // Расход сжатого воздуха (нм³/ч)
        receiverP:    0.60,   // Давление в ресивере (МПа)
        status:       'НОРМА',
        // Потоки по трубам (для UI)
        pipeFlows: [
            { id: '1A', flow: 0, draft: 0, fugitive: false },
            { id: '1B', flow: 0, draft: 0, fugitive: false },
            { id: '2A', flow: 0, draft: 0, fugitive: false },
            { id: '2B', flow: 0, draft: 0, fugitive: false },
        ],
        // Для рендерера: какие секции только что получили импульс
        pulseFlash: [false, false, false, false],
    },

    // Алармы текущего тика (массив строк)
    alarms: [],

    // Режим «Идеальная ГОУ»
    idealMode: false,
};

// ══════════════════════════════════════════════════════════════════════
//  tick() — один шаг физической симуляции (вызывается 10 раз/сек)
// ══════════════════════════════════════════════════════════════════════
export function tick() {
    const I = state.inputs;
    const C = config;
    const P = state.phys;
    const O = state.out;
    P.tickCount++;
    state.alarms = []; // Сброс алармов на этот тик
    O.pulseFlash = [false, false, false, false];

    // ── 1. ТЕПЛОВАЯ ИНЕРЦИЯ (Ньютон-Рихман) ──
    // T_actual += (T_setpoint - T_actual) × k × dt
    // При k=0.008 и 10 тиков/сек: τ ≈ 12.5 секунд (63% за ~12 сек)
    P.actualTemp += (I.gasTempSP - P.actualTemp) * C.thermalK;
    O.actualTemp = P.actualTemp;
    const T = P.actualTemp;

    // ── 2. СРЕДНЕЕ ΔP ФИЛЬТРА ──
    O.avgFilterDP = state.sections.reduce((a, s) => a + s.dp, 0) / C.numSections;

    // ── 3. СОПРОТИВЛЕНИЕ ГАЗОХОДОВ (Дарси-Вейсбах) ──
    // ΔP_duct = λ × (L/D) × (ρ × v²/2) / 1000 (кПа)
    const rhoGas = 1.29 * 273 / (T + 273);
    const vPrev = O.gasVelocity || 8;
    O.ductDP = C.ductFriction * (C.ductLength / C.ductDiameter) * (rhoGas * vPrev * vPrev / 2) / 1000;

    // ── 4. ОБЩЕЕ ΔP ТРАКТА ──
    O.totalDP = O.avgFilterDP + O.ductDP + C.reactorDP;

    // ── 5. ДЫМОСОС + НАПРАВЛЯЮЩИЙ АППАРАТ ──
    // [FIX 1] Аналитическая рабочая точка
    const n = I.fanRPM / 100;
    const alpha = I.guideVane / 100;

    const Qmax = C.nominalFlow * n * alpha;           // м³/ч (при норм. усл.)
    const Pmax = C.maxFanPressure * n * n * Math.pow(alpha, 1.5); // кПа

    // Температурный фактор (Гей-Люссак)
    const tempFactor = (T + 273) / 273;

    // Рабочая точка: Q = Qmax / √(1 + k·Qmax²/Pmax)
    let gasFlowNorm = 0;
    if (Pmax > 0.01 && n > 0) {
        const denom = 1 + P.networkK * Qmax * Qmax / Pmax;
        gasFlowNorm = denom > 0 ? Qmax / Math.sqrt(denom) : 0;
    }

    // Обновление удельного сопротивления сети: k = ΔP_total / Q²
    // Используем gasFlowNorm текущего тика для корректировки k к следующему
    if (gasFlowNorm > 100) {
        const newK = O.totalDP / (gasFlowNorm * gasFlowNorm);
        if (isFinite(newK) && newK > 0) {
            P.networkK += (newK - P.networkK) * 0.1; // Сглаживание
        }
    }

    O.gasFlow = gasFlowNorm * tempFactor;
    if (n <= 0) O.gasFlow = 0;
    O.normalFlow = gasFlowNorm;
    O.gasVelocity = (O.gasFlow / 3600) / C.ductArea;

    // [FIX 5] Скорость фильтрации (для ΔP пирога и рендера)
    O.filtVelocity = O.gasFlow > 0 ? (O.gasFlow / 3600) / C.filterArea : 0;

    // ── 6. [FIX 2] МОЩНОСТЬ = Q × ΔP / η, ток через мощность ──
    // N_shaft = Q(м³/с) × ΔP(Па) / η_fan
    const Q_m3s = O.gasFlow / 3600;
    const dpPa = O.totalDP * 1000;
    const N_shaft = Q_m3s * dpPa / C.fanEfficiency; // Вт
    O.fanPowerKW = N_shaft / 1000;

    // I = P / (U × √3 × cosφ)
    const U_v = C.fanVoltage * 1000; // В
    O.fanAmps = O.fanPowerKW > 0 ? (O.fanPowerKW * 1000) / (U_v * 1.732 * C.fanCosF) : 0;
    if (n <= 0) { O.fanAmps = 0; O.fanPowerKW = 0; }

    // ── 7. ПОТОКИ ПО 4 ТРУБАМ ──
    // [FIX 8] Разрежение — расчётная величина
    // P_fan_residual = Pmax - totalDP → это запас тяги дымососа
    const fanResidual = Math.max(0, Pmax - O.totalDP); // кПа
    // Расчётное разрежение на входном газоходе (+ пользовательское смещение)
    O.calcDraft = -(fanResidual * 1000) + (I.inletDraft + 150); // Па (смещение от -150 нормы)

    O.pipeFlows.forEach((pf, i) => {
        const damper = I.pipes[i].damper / 100;
        const pipeDraft = fanResidual * damper * 1000; // кПа → Па
        pf.draft = -pipeDraft + (I.inletDraft + 150); // со смещением
        pf.flow = O.normalFlow * damper / 4;
        pf.fugitive = Math.abs(pf.draft) < 50; // < 50 Па → выбивание
        pf.id = I.pipes[i].id;
    });

    // ── 8. [FIX 4] ГЕНЕРАЦИЯ ЗАГРЯЗНИТЕЛЕЙ — зависит от T ──
    // При анодных эффектах (T > 140°C) генерация HF возрастает до 4×
    const hfTempFactor = T > 140 ? 1 + (T - 140) * 0.05 : 1.0;
    const hfGen = C.hfGenFactor * C.potroomCurrent * Math.min(4, hfTempFactor);
    const dustGen = C.dustGenFactor * C.potroomCurrent;
    O.hfGenKgH = hfGen;
    O.hfIn = O.normalFlow > 0 ? (hfGen * 1e6) / O.normalFlow : 0;

    // ── 9. [FIX 3] ДВУХСТУПЕНЧАТАЯ АДСОРБЦИЯ HF ──

    // Температурный штраф: >120°C → экспоненциальное падение
    let tempPenalty = 1.0;
    if (T > 120) tempPenalty = Math.exp(-0.012 * (T - 120));

    // Влажность: улучшает адсорбцию (+20% при 20%)
    const humBonus = 1.0 + (I.gasHumidity / 100) * 0.2;

    // [FIX 3] Время контакта через объём реактора
    const contactTimeSec = O.gasFlow > 0 ? (C.reactorVolume / (O.gasFlow / 3600)) : 999;
    O.contactTime = Math.min(99, contactTimeSec);
    const contactF = 1 - Math.exp(-contactTimeSec / C.optimalContactTime);

    // η₁ — Реактор (свежий + рецирк × 0.4)
    const effAlumina = I.freshFeed * 1.0 + I.recircFeed * C.recircEfficiency;
    const rRatio = hfGen > 0 ? effAlumina / hfGen : 0;
    let eta1 = C.maxReactorEff * (1 - Math.exp(-C.reactorK * rRatio)) * tempPenalty * contactF * humBonus;
    eta1 = Math.max(0, Math.min(C.maxReactorEff, eta1));

    // η₂ — Пирог на рукавах (filsorption)
    const avgCake = state.sections.reduce((a, s) => a + s.cakeMass, 0) / C.numSections;
    // avgCake это удельная масса W (кг/м²). Нормализуем для константы (3.0 кг/м² — хороший пирог)
    const cRatio = avgCake / 3.0;
    let eta2 = C.maxCakeEff * (1 - Math.exp(-C.cakeK * cRatio)) * tempPenalty;
    eta2 = Math.max(0, Math.min(C.maxCakeEff, eta2));

    // Каскад: η_total = 1 - (1-η₁)(1-η₂)
    const effTotal = 1 - (1 - eta1) * (1 - eta2);

    O.effReactor = eta1 * 100;
    O.effCake = eta2 * 100;
    O.effHF = effTotal * 100;
    O.hfOut = O.hfIn * (1 - effTotal);

    // ── 10. ФИЛЬТРАЦИЯ ПЫЛИ ──
    const tornFrac = Math.min(I.tornBags / C.totalBags, 0.25);
    let dustEff = 99.95 - tornFrac * 100 * 0.5 + I.gasHumidity * 0.02;
    O.effDust = Math.max(50, Math.min(99.99, dustEff));
    const totalMassIn = dustGen + (I.freshFeed + I.recircFeed) * 1000;
    O.dustOut = O.normalFlow > 0
        ? (totalMassIn * (1 - O.effDust / 100) * 1e6) / O.normalFlow : 0;

    // ── 11. [FIX 5+6] НАКОПЛЕНИЕ ПИРОГА НА СЕКЦИЯХ ──
    const mps = O.gasFlow > 0 ? totalMassIn / C.numSections : 0;
    let airUsedThisTick = 0;
    const sectionArea = C.filterArea / C.numSections;
    const vf = O.filtVelocity;

    state.sections.forEach((sec, i) => {
        if (sec.isRegen) {
            // [FIX 6] Импульсная регенерация: одноразовый сброс на первом тике
            if (sec.regenTimer === sec.regenTimerMax) {
                // Первый тик продувки — резкий удар сжатого воздуха
                const airOk = P.receiverPressure > 0.3;
                const blowEff = airOk ? C.pulseBlowEff : C.pulseBlowEffLow;
                sec.cakeMass = sec.cakeMass * (1 - blowEff) + C.residualCake;
                O.pulseFlash[i] = true; // Сигнал рендереру для визуального эффекта
            }
            sec.regenTimer--;
            // Пересчёт ΔP после сброса
            const W = sec.cakeMass; // cakeMass уже в кг/м²
            sec.dp = C.baseDP + (C.cakeResistance * vf * W * (1 + I.gasHumidity * 0.01)) / 1000;
            if (sec.regenTimer <= 0) {
                sec.isRegen = false;
                sec.dp = Math.max(C.baseDP, sec.dp);
            }
        } else if (O.gasFlow > 0) {
            // Накопление пирога (прирост W = (масса/сек) / площадь)
            // mps — кг/ч. Для интерактивности симуляции ускоряем накопление в 60 раз (1 сек = 1 мин реального времени)
            const simTimeFactor = 60;
            const deltaW = (mps * 0.1 * simTimeFactor / 3600) / sectionArea;
            sec.cakeMass += deltaW;

            // [FIX 5] ΔP через скорость фильтрации и поверхностную нагрузку
            const W = sec.cakeMass; // кг/м²
            const tInSec = Math.min(I.tornBags, C.bagsPerSection) / C.bagsPerSection;
            const tornReduction = (1 - tInSec * 0.4); // порванные рукава снижают ΔP
            sec.dp = C.baseDP + (C.cakeResistance * vf * W * tornReduction * (1 + I.gasHumidity * 0.01)) / 1000;
        }
    });

    // ── 12. АВТО-РЕГЕНЕРАЦИЯ (секционная, по очереди) ──
    if (P.regenCooldown > 0) P.regenCooldown--;
    if (P.regenCooldown <= 0) {
        let worstIdx = -1, worstDP = 0;
        state.sections.forEach((s, i) => {
            if (!s.isRegen && s.dp >= I.regenSP && s.dp > worstDP) {
                worstDP = s.dp; worstIdx = i;
            }
        });
        if (worstIdx >= 0) {
            const sec = state.sections[worstIdx];
            sec.isRegen = true;
            sec.regenTimerMax = 15;
            sec.regenTimer = 15;
            P.regenCooldown = 45;

            // Расход сжатого воздуха
            const airVol = C.bagsPerSection * C.pulseVolume;
            airUsedThisTick += airVol;
            P.receiverPressure -= C.airPressureDrop;

            state.alarms.push(`↻ Авто-продувка: Секция ${worstIdx + 1} (ΔP=${worstDP.toFixed(2)} кПа)`);
        }
    }

    // ── 13. СЖАТЫЙ ВОЗДУХ ──
    P.receiverPressure += C.airRecoveryRate;
    P.receiverPressure = Math.min(C.airPressureNom, Math.max(0, P.receiverPressure));
    O.receiverP = P.receiverPressure;
    O.airConsumption = airUsedThisTick * 10 * 60;

    // ── 14. [FIX 7] СОДЕРЖАНИЕ F В ГЛИНОЗЁМЕ ──
    // Чистый экспоненциальный фильтр (τ ≈ 5 мин = 3000 тиков)
    const hfCaptured = hfGen * effTotal;         // кг/ч HF уловлено
    const fCaptured = hfCaptured * (19 / 20);     // кг/ч F (атомная масса F/HF)
    const totAlumina = (I.freshFeed + I.recircFeed) * 1000; // кг/ч
    if (totAlumina > 0) {
        const instantF = (fCaptured / totAlumina) * 100; // wt%
        // Экспоненциальное сглаживание: τ ≈ 5 мин
        P.fContentAccum += (instantF - P.fContentAccum) * 0.003;
        O.fContent = Math.min(C.maxFContent, Math.max(0, P.fContentAccum));
    } else {
        O.fContent = 0;
    }

    // ── 15. СТАТУС И АЛАРМЫ ──
    const bits = [];
    if (O.avgFilterDP > I.regenSP * 1.5) {
        bits.push('КРИТИЧ. ΔP');
        state.alarms.push(`⚠ КРИТИЧЕСКОЕ ΔP фильтра: ${O.avgFilterDP.toFixed(2)} кПа`);
    } else if (O.avgFilterDP > I.regenSP) {
        bits.push('ВЫСОКИЙ ΔP');
    }
    if (I.tornBags > 0) bits.push(`ПРОРЫВ: ${I.tornBags} рук.`);
    if (O.effHF < 95) {
        bits.push('ПРОСКОК HF');
        state.alarms.push(`⚠ ПРОСКОК HF: η=${O.effHF.toFixed(1)}%`);
    }
    // [FIX 8] Используем расчётное разрежение
    if (O.calcDraft > -50) bits.push('ВЫБИВАНИЕ');
    if (n === 0) bits.push('ДЫМОСОС СТОП');
    if (T > 160) {
        bits.push('ПЕРЕГРЕВ');
        state.alarms.push(`🔥 ПЕРЕГРЕВ: T=${T.toFixed(0)}°C`);
    }
    if (alpha < 0.20) bits.push('НА ПРИКРЫТ');
    if (P.receiverPressure < 0.35) {
        bits.push('НИЗКОЕ ДАВЛ. ВОЗДУХА');
        state.alarms.push(`⚠ Давление в ресивере: ${P.receiverPressure.toFixed(2)} МПа`);
    }
    O.status = bits.length > 0 ? bits.join(' | ') : 'НОРМА';

    // Вращение лопастей дымососа
    P.fanAngle += n * alpha * 0.4;
}

// ── Управляющие функции (вызываются из UI) ──

export function forcePulseAll() {
    state.sections.forEach(s => {
        s.isRegen = true;
        s.regenTimerMax = 20;
        s.regenTimer = 20;
    });
    state.phys.receiverPressure -= config.airPressureDrop * config.numSections;
    state.alarms.push('⚡ РУЧНАЯ ПРОДУВКА всех секций');
}

export function addTornBag() {
    state.inputs.tornBags++;
    state.alarms.push(`💥 ПРОРЫВ рукава! Всего повреждено: ${state.inputs.tornBags} шт.`);
}

// ══════════════════════════════════════════════════════════════════════
//  РЕЖИМ «ИДЕАЛЬНАЯ ГОУ» — автоподстройка параметров
// ══════════════════════════════════════════════════════════════════════

const IDEAL = {
    fanRPM:     100,
    guideVane:  78,
    gasTempSP:  105,
    gasHumidity: 5,
    inletDraft: -150,
    freshFeed:  5.5,
    recircFeed: 22,
    regenSP:    1.2,
    pipesDamper: 100,
};

export function autoTune(changedParam) {
    const I = state.inputs;
    const C = config;

    const avgDamper = I.pipes.reduce((a, p) => a + p.damper, 0) / 4 / 100;
    const tempRatio = (I.gasTempSP + 273) / (IDEAL.gasTempSP + 273);
    const damperCompensation = avgDamper > 0.5 ? 1.0 : (1.0 + (1.0 - avgDamper) * 0.4);

    if (changedParam !== 'guideVane') {
        I.guideVane = Math.round(clamp(IDEAL.guideVane * tempRatio * damperCompensation, 20, 100));
    }
    if (changedParam !== 'fanRPM') {
        I.fanRPM = IDEAL.fanRPM;
    }

    const hfGen = C.hfGenFactor * C.potroomCurrent;
    const flowFraction = I.guideVane / 100;

    if (changedParam !== 'freshFeed') {
        const contactQuality = flowFraction > 0.5 ? 1.0 : (1.0 + (0.5 - flowFraction) * 0.8);
        const tornCompensation = 1.0 + (I.tornBags / 200);
        I.freshFeed = parseFloat(clamp(IDEAL.freshFeed * contactQuality * tornCompensation, 2.0, 10.0).toFixed(1));
    }
    if (changedParam !== 'recircFeed') {
        I.recircFeed = parseFloat(clamp(I.freshFeed * 4, 5, 40).toFixed(1));
    }
    if (changedParam !== 'gasTempSP') {
        if (!changedParam) I.gasTempSP = IDEAL.gasTempSP;
    }
    if (changedParam !== 'gasHumidity') {
        I.gasHumidity = IDEAL.gasHumidity;
    }
    if (changedParam !== 'inletDraft') {
        I.inletDraft = Math.round(clamp(-50 - flowFraction * 150, -400, -50));
    }
    if (changedParam !== 'regenSP') {
        const feedRatio = (I.freshFeed + I.recircFeed * C.recircEfficiency) /
                          (IDEAL.freshFeed + IDEAL.recircFeed * C.recircEfficiency);
        I.regenSP = parseFloat(clamp(IDEAL.regenSP / Math.sqrt(feedRatio), 0.8, 1.8).toFixed(2));
    }
    if (!changedParam || changedParam === 'idealReset') {
        I.pipes.forEach(p => p.damper = IDEAL.pipesDamper);
        I.tornBags = 0;
    }
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

export function setIdealMode(on) {
    state.idealMode = on;
    if (on) {
        autoTune(null);
        state.alarms.push('✨ Режим «ИДЕАЛЬНАЯ ГОУ» включён');
    } else {
        state.alarms.push('⏹ Режим «ИДЕАЛЬНАЯ ГОУ» выключен');
    }
}
