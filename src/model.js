// ═══════════════════════════════════════════════════════════════════════
//  ANTIGRAVITY СГОУ — ФИЗИЧЕСКИЙ ДВИЖОК v7.1
//  v7.1: точная рабочая точка «дымосос ∩ сеть», шиберы как параллельные ветви,
//  разрежение из расхода, порывы рукавов → пыль и HF, баланс F по массе,
//  регенерация 50–60 ц/ч, ток из мощности (дымосос 1.6 МВт), автопилот без «читов».
// ═══════════════════════════════════════════════════════════════════════

// ── Конфигурация установки (константы) ──
export const config = {
    totalBags:       800,        // Всего рукавов (4 секции × 200)
    bagsPerSection:  200,
    numSections:     4,
    ductArea:        8.0,        // Сечение газохода (м²)
    numPipes:        4,

    // Дымосос (расчётная точка: свободная подача при 100% НА, нормальные условия при T_расч)
    nominalFlow:     500000,     // Q_max дымососа при n=100%, α=100% (нм³/ч, приведён к T_расч)
    maxFanPressure:  11.5,       // Напор при нулевом расходе, n=100%, α=100% (кПа)
    refTemp:         105,        // Расчётная T газа (°C)
    refFlow:         220000,     // Проектный нормальный расход (нм³/ч) — опора для ΔP и разрежения
    falseAirFrac:    0.18,       // Доля подсасываемого наружного воздуха на всасе дымососа
    fanVoltage:      6.0,        // Напряжение (кВ)
    fanCosF:         0.85,       // cosφ двигателя
    fanEfficiency:   0.75,       // КПД дымососа
    motorEfficiency: 0.95,       // КПД электродвигателя
    fanRatedKW:      1600,       // Номинальная мощность двигателя (кВт) — по данным эксперта
    fanMaxAmps:      190,        // Ном. ток двигателя (А) = 1600 кВт / (√3·6 кВ·0.85·0.95)
    baseDP:          0.45,       // ΔP чистого фильтра (кПа)
    potroomCurrent:  300,        // Ток серии (кА)

    // Генерация загрязнителей
    hfGenFactor:     0.135,      // кг HF / кА·ч  → 40.5 кг/ч при 300 кА (≈180 мг/нм³ на входе)
    dustGenFactor:   0.08,       // кг пыли / кА·ч → 24 кг/ч при 300 кА

    // Адсорбция
    maxReactorEff:   0.70,       // Макс. η₁ реактора
    maxCakeEff:      0.997,      // Макс. η₂ пирога
    reactorK:        0.0085,     // Константа Лэнгмюра: η₁ ∝ 1−e^(−K·кг сорбента/кг HF)
    cakeK:           3.5,        // Константа filsorption
    recircEfficiency: 0.40,      // Эффективность рецирк. Al₂O₃ (40% от свежего)
    maxFContent:     2.5,        // Макс. содержание F (wt%)
    circulatingInventory: 30,    // Запас глинозёма в контуре рециркуляции (т)
    reactorVolume:   200,        // Объём реактора (м³)
    optimalContactTime: 1.2,     // Постоянная времени контакта (сек)

    // Порванные рукава
    tornGasBypass:   0.5,        // Доля газа через порванный рукав, не контактирующая с пирогом
    tornDustLeak:    0.02,       // Доля пыли, проскакивающая через порыв (остальное оседает у дыры)

    // Газоходы и сеть (Дарси-Вейсбах + местные сопротивления при refFlow)
    ductLength:      200,        // Длина газоходов (м)
    ductDiameter:    3.2,        // Эквивалентный диаметр (м)
    ductFriction:    0.02,       // Коэфф. трения λ
    reactorDP:       0.35,       // ΔP реактора (кПа при refFlow, ∝ Q²)
    pipeDP:          0.30,       // ΔP 4 труб с открытыми шиберами (кПа при refFlow, ∝ Q²)
    otherDP:         2.6,        // ΔP дымовой трубы, короба, выходного тракта (кПа при refFlow)

    // Фильтр
    filterArea:      5000,       // Общая площадь фильтрации (м²)
    cakeResistance:  8000,       // Коэфф. сопротивления пирога (Па·с/кг·м)
    residualCake:    1.0,        // Остаточная масса пирога после продувки (кг/м²)
    pulseBlowEff:    0.085,      // Доля пирога (сверх остаточного), сбиваемая одним импульсом
    regenCooldownTicks: 5,       // Пауза между импульсами соседних секций (тиков)

    // Время
    simTimeFactor:   60,         // Ускорение процессов накопления: 1 тик = 6 с модельного времени

    // Сжатый воздух
    pulseVolume:     0.05,       // нм³ воздуха на 1 рукав за импульс
    airPressureNom:  0.60,       // Номинальное давление в ресивере (МПа)
    airRecoveryRate: 0.0012,     // Производительность компрессора (МПа/тик)
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
        inletDraft:  -150,    // Проектное разрежение под укрытием при номинальном расходе (Па)
        freshFeed:   5.0,     // Свежий Al₂O₃ (т/ч)
        recircFeed:  20,      // Рецирк. AlF₃ (т/ч)
        regenSP:     1.2,     // Уставка авто-продувки (кПа)
        tornBags:    0,       // Порвано рукавов
        timeSpeed:   1,       // Скорость симуляции
        outdoorTemp: 20,      // Температура наружного воздуха (°C)
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
        fContentAccum:  0.7,
        actualTemp:     110,     // Фактическая T° газа (с инерцией)
        receiverPressure: 0.60,  // Давление в ресивере (МПа)
        tickCount:      0,
        regenCycles:    [],      // Таймстампы циклов регенерации для подсчёта ц/ч
        dustSpikeTicks: 0,       // Тики оставшегося скачка пыли при регенерации
        anodeEffectTimer: 0,     // Таймер анодного эффекта (тики)
    },

    // ── Предиктивный советчик (APM v7.0) ──
    advisor: {
        healthIndex:  100,       // 0 - 100%
        healthStatus: 'ОТЛИЧНО', // 'ОТЛИЧНО' | 'ВНИМАНИЕ' | 'ТРЕВОГА'
        modules: {
            filter:  { status: 'ok', label: 'В НОРМЕ', desc: 'Рукава целы, ΔP стабилен' },
            alumina: { status: 'ok', label: 'В НОРМЕ', desc: 'HF улавливается, F% в норме' },
            fan:     { status: 'ok', label: 'В НОРМЕ', desc: 'Тяга и ток согласованы' },
        },
        recommendations: [],     // Активные карточки рекомендаций
        activeScenario: null,   // Имя активного демо-сценария
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
        regenCyclesPerHour: 0, // Циклы регенерации в час
        outdoorTemp:  20,     // Т наружного воздуха (для отображения)
        fanInletTemp: 100,    // Т смеси на всасе дымососа (с подсосом наружного воздуха), °C
        reactorDP:    0,      // ΔP реактора (кПа)
        pipesDP:      0,      // ΔP труб с шиберами (кПа)
        outletDP:     0,      // ΔP выходного тракта: труба, короб (кПа)
        hfGenLoad:    1,      // Нагрузка по HF относительно номинала (×)
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
    hold: {},   // параметры, перехваченные оператором в режиме автопилота
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

    // ── 1. ТЕПЛОВАЯ ИНЕРЦИЯ (Ньютон-Рихман) И ТЕПЛОПОТЕРИ ──
    // Газ охлаждается в газоходах за счет теплоотдачи в окружающую среду.
    // Чем длиннее газоход и чем ниже Т наружного воздуха, тем сильнее остывает газ.
    // При скорости ~10-15 м/с потери составляют около 5-15°C в зависимости от сезона.
    const velocityFactor = O.gasVelocity > 0 ? (15 / Math.max(O.gasVelocity, 2)) : 1;
    const coolingFactor = 0.05 * velocityFactor; // Доля потери разницы температур
    let targetTemp = I.gasTempSP - coolingFactor * (I.gasTempSP - I.outdoorTemp);

    // [v7] Анодный эффект — резкий локальный перегрев от электролизеров (+50°C)
    if (P.anodeEffectTimer > 0) {
        const surgeRatio = P.anodeEffectTimer / 200;
        targetTemp += surgeRatio * 50;
    }

    // T_actual += (T_target - T_actual) × k × dt
    P.actualTemp += (targetTemp - P.actualTemp) * C.thermalK;
    O.actualTemp = P.actualTemp;
    const T = P.actualTemp;

    // ── 2. ТЕМПЕРАТУРНЫЕ ФАКТОРЫ ──
    // tf — объёмное расширение газа (нм³ → м³ при T); tFan — T смеси на всасе дымососа:
    // часть потока — подсос наружного воздуха (false air), поэтому T_наружн. влияет на плотность.
    const tf = (T + 273) / 273;
    const tFan = (1 - C.falseAirFrac) * T + C.falseAirFrac * I.outdoorTemp;
    const tfFan = (tFan + 273) / 273;
    const rhoGas = 1.29 * 273 / (T + 273);
    // ρ·v² при фиксированном нормальном расходе ∝ (T+273) → масштаб квадратичных потерь
    const sT = (T + 273) / (C.refTemp + 273);
    const sTfan = (tFan + 273) / (C.refTemp + 273);
    // Плотность газа на всасе относительно расчётной (для напора дымососа)
    const rhoFanRatio = (C.refTemp + 273) / (tFan + 273);
    O.outdoorTemp = I.outdoorTemp;
    O.fanInletTemp = tFan;

    // ── 3. ХАРАКТЕРИСТИКА СЕТИ  ΔP(Q) = c0 + b·Q + a·Q²  (Q — нм³/ч) ──
    const n = I.fanRPM / 100;
    const alpha = I.guideVane / 100;

    // 3a. 4 трубы от корпусов — параллельные ветви; закрытие шибера повышает сопротивление
    const dSum = I.pipes.reduce((s, p) => s + p.damper / 100, 0);
    const dEff = Math.max(dSum, 0.08);

    // 3b. Фильтр: Дарси для пирога — линейно по расходу. Вязкость газа ↑ с T;
    //     при T < 90°C — конденсат/залипание рукавов (рост сопротивления пирога).
    const visc = Math.pow(sT, 0.7);
    const coldBlind = T < 90 ? 1 + (90 - T) * 0.03 : 1;
    const humF = 1 + I.gasHumidity * 0.01;
    const tornPerSec = I.tornBags / C.numSections;
    const tornReduction = 1 - Math.min(1, tornPerSec / C.bagsPerSection) * 0.4;
    const cakeCoef = visc * coldBlind * humF * tornReduction;
    const avgW = state.sections.reduce((a, s) => a + s.cakeMass, 0) / C.numSections;
    const bF = C.cakeResistance * avgW * cakeCoef / 1000 * tf / (3600 * C.filterArea); // кПа / (нм³/ч)

    // 3c. Квадратичные потери: газоходы (Дарси-Вейсбах), реактор, трубы с шиберами,
    //     выходной тракт (дымовая труба, всасывающий короб)
    const vPerQ = tf / (3600 * C.ductArea);   // м/с на 1 нм³/ч
    const aDuct = C.ductFriction * (C.ductLength / C.ductDiameter) * rhoGas * 0.5 * vPerQ * vPerQ / 1000;
    const q2 = 1 / (C.refFlow * C.refFlow);
    const pipeMult = (4 / dEff) * (4 / dEff);
    const aQ = aDuct + (C.reactorDP + C.pipeDP * pipeMult) * sT * q2 + C.otherDP * sTfan * q2;

    // ── 4. ДЫМОСОС + НАПРАВЛЯЮЩИЙ АППАРАТ: точная рабочая точка ──
    // Кривая дымососа: P_fan(Q) = Pmax·(1 − (Q/Qmax)²); Qmax ∝ n·α, Pmax ∝ n²·α^1.5
    // Вентилятор — объёмная машина: объёмная производительность не зависит от плотности, поэтому
    // в нормальных м³ (Qmax) она растёт при похолодании, а напор Pmax ∝ плотности газа на всасе.
    const Qmax = n > 0 ? C.nominalFlow * n * alpha * rhoFanRatio : 0;
    const Pmax = C.maxFanPressure * n * n * Math.pow(alpha, 1.5) * rhoFanRatio;
    // Пересечение с сетью:  (a + Pmax/Qmax²)·Q² + b·Q + (c0 − Pmax) = 0
    let Qn = 0;
    if (Qmax > 1 && Pmax > C.baseDP) {
        const A = aQ + Pmax / (Qmax * Qmax);
        const disc = bF * bF + 4 * A * (Pmax - C.baseDP);
        Qn = (-bF + Math.sqrt(disc)) / (2 * A);
    }
    O.normalFlow = Qn;
    O.gasFlow = Qn * tf;                                  // м³/ч при T газа
    O.gasVelocity = (O.gasFlow / 3600) / C.ductArea;
    O.filtVelocity = (O.gasFlow / 3600) / C.filterArea;   // скорость фильтрации
    const vf = O.filtVelocity;

    // Составляющие ΔP на найденной рабочей точке
    const qr2 = (Qn * Qn) * q2;
    O.ductDP = aDuct * Qn * Qn;
    O.reactorDP = C.reactorDP * sT * qr2;
    O.pipesDP = C.pipeDP * pipeMult * sT * qr2;
    O.outletDP = C.otherDP * sTfan * qr2;

    // ── 5. ПОТОКИ И РАЗРЕЖЕНИЕ ПО 4 ТРУБАМ ──
    // Расход в ветви ∝ открытию шибера (общий перепад). Разрежение под укрытием корпуса
    // = проектное значение × (q/q_ном)²: закрытый шибер → q=0 → разрежение пропадает → выбивание.
    // Ползунок inletDraft — проектное разрежение при номинальном расходе (эталон, напр. −157…−400 Па).
    const qRefPipe = C.refFlow / 4;
    O.pipeFlows.forEach((pf, i) => {
        const d = I.pipes[i].damper / 100;
        pf.flow = dSum > 0.001 ? Qn * d / dSum : 0;
        const r = pf.flow / qRefPipe;
        pf.draft = I.inletDraft * r * r;
        pf.fugitive = Math.abs(pf.draft) < 50;
        pf.id = I.pipes[i].id;
    });
    O.calcDraft = O.pipeFlows.reduce((a, p) => a + p.draft, 0) / O.pipeFlows.length;

    // ── 6. ГЕНЕРАЦИЯ ЗАГРЯЗНИТЕЛЕЙ — зависит от T ──
    const hfNom = C.hfGenFactor * C.potroomCurrent;
    // При анодных эффектах (T > 140°C) генерация HF возрастает до 4×
    let hfTempFactor = T > 140 ? 1 + (T - 140) * 0.05 : 1.0;

    // [v7] Прямой импульс HF при активном анодном эффекте
    if (P.anodeEffectTimer > 0) {
        const surgeRatio = P.anodeEffectTimer / 200;
        hfTempFactor += surgeRatio * 2.5; // Выброс фторидов в 3.5 раза выше
        P.anodeEffectTimer--;
        if (P.anodeEffectTimer === 0 && state.advisor.activeScenario === 'anode_effect') {
            state.advisor.activeScenario = null;
            state.alarms.push('✓ Анодный эффект на серии завершился');
        }
    }
    const hfGen = hfNom * Math.min(4.5, hfTempFactor);
    const dustGen = C.dustGenFactor * C.potroomCurrent;
    O.hfGenKgH = hfGen;
    O.hfGenLoad = hfNom > 0 ? hfGen / hfNom : 1;
    O.hfIn = Qn > 0 ? (hfGen * 1e6) / Qn : 0;

    // ── 7. ДВУХСТУПЕНЧАТАЯ АДСОРБЦИЯ HF (Filsorption) ──
    // Температурный штраф: >120°C → экспоненциальное падение
    let tempPenalty = 1.0;
    if (T > 120) tempPenalty = Math.exp(-0.012 * (T - 120));
    // Влажность: улучшает адсорбцию (+20% при 20%)
    const humBonus = 1.0 + (I.gasHumidity / 100) * 0.2;
    // Время контакта через объём реактора
    const contactTimeSec = O.gasFlow > 0 ? (C.reactorVolume / (O.gasFlow / 3600)) : 999;
    O.contactTime = Math.min(99, contactTimeSec);
    const contactF = 1 - Math.exp(-contactTimeSec / C.optimalContactTime);
    // Насыщение сорбента фтором: выше ~1.8 wt% ёмкость падает (глинозём «сыт»)
    const satF = 1 - 0.6 * clamp((P.fContentAccum - 1.8) / (C.maxFContent - 1.8), 0, 1);

    // η₁ — Реактор: удельная масса сорбента на кг HF (свежий + рецирк × эффективность)
    const effAlumina = I.freshFeed + I.recircFeed * C.recircEfficiency;      // т/ч
    const sorbRatio = hfGen > 0 ? effAlumina * 1000 / hfGen : 0;             // кг/кг
    let eta1 = C.maxReactorEff * (1 - Math.exp(-C.reactorK * sorbRatio)) * tempPenalty * contactF * humBonus * satF;
    eta1 = clamp(eta1, 0, C.maxReactorEff);

    // η₂ — Пирог на рукавах. При росте нагрузки по HF ёмкость пирога расходуется быстрее.
    const cRatio = avgW / 3.0;   // 3 кг/м² — «хороший» пирог
    const loadF = Math.sqrt(Math.max(0.5, O.hfGenLoad));
    let eta2 = C.maxCakeEff * (1 - Math.exp(-C.cakeK * cRatio / loadF)) * tempPenalty * satF;
    eta2 = clamp(eta2, 0, C.maxCakeEff);

    // Порванные рукава: доля газа идёт мимо пирога (проброс газовой фазы вместе с пылью)
    const tornFrac = Math.min(I.tornBags / C.totalBags, 0.25);
    const gasBypass = tornFrac * C.tornGasBypass;
    const slipFrac = (1 - eta1) * ((1 - gasBypass) * (1 - eta2) + gasBypass);
    const effTotal = 1 - slipFrac;

    O.effReactor = eta1 * 100;
    O.effCake = eta2 * 100;
    O.effHF = effTotal * 100;
    O.hfOut = O.hfIn * slipFrac;

    // ── 8. ДИНАМИЧЕСКАЯ МОДЕЛЬ ПЫЛИ ──
    // Нагрузка на фильтр: пыль электролизёров + циркулирующий глинозём (мг/нм³)
    const totalMassIn = dustGen + (I.freshFeed + I.recircFeed) * 1000;   // кг/ч
    const dustLoading = Qn > 0 ? totalMassIn * 1e6 / Qn : 0;
    // Проскок через целый рукав зависит от толщины пирога (тоньше → больше): итого ~2–5 мг/нм³
    const cakeEtaDust = 0.99990 + 0.00008 * (1 - Math.exp(-avgW / 0.5));
    const dustBase = dustLoading * (1 - cakeEtaDust);
    // Порыв рукава: прямой пролом (доля газа × доля пыли, прошедшая через дыру)
    const dustTorn = dustLoading * tornFrac * C.tornDustLeak;
    let dustTotal = dustBase + dustTorn;
    O.effDust = dustLoading > 0 ? clamp(100 * (1 - dustTotal / dustLoading), 0, 99.9999) : 100;
    // Скачок пыли при импульсе (только при порванных рукавах — диагностический признак)
    if (P.dustSpikeTicks > 0) {
        const spikeAmplitude = I.tornBags > 0 ? (3 + I.tornBags * 0.5) : 0.2;
        dustTotal += spikeAmplitude * (P.dustSpikeTicks / 5);
        P.dustSpikeTicks--;
    }
    O.dustOut = Math.max(0, dustTotal);

    // ── 9. НАКОПЛЕНИЕ ПИРОГА И ΔP СЕКЦИЙ ──
    const mps = Qn > 0 ? totalMassIn / C.numSections : 0;
    let airUsedThisTick = 0;
    const sectionArea = C.filterArea / C.numSections;
    // Эффективность импульса зависит от давления в ресивере (плавно)
    const airFactor = clamp((P.receiverPressure - 0.25) / 0.20, 0.3, 1.0);
    const sectionDP = (W) => C.baseDP + C.cakeResistance * vf * W * cakeCoef / 1000;

    state.sections.forEach((sec, i) => {
        if (sec.isRegen) {
            // Импульсная регенерация: одноразовый сброс на первом тике.
            // Импульс сбивает лишь часть пирога СВЕРХ остаточного слоя (масса сохраняется).
            if (sec.regenTimer === sec.regenTimerMax) {
                const removed = C.pulseBlowEff * airFactor * Math.max(0, sec.cakeMass - C.residualCake);
                sec.cakeMass -= removed;
                O.pulseFlash[i] = true;
                P.dustSpikeTicks = 5; // 0.5 сек скачок
            }
            sec.regenTimer--;
            sec.dp = sectionDP(sec.cakeMass);
            if (sec.regenTimer <= 0) sec.isRegen = false;
        } else if (Qn > 0) {
            // Накопление пирога: модельное время ускорено ×60 (1 тик = 6 с)
            sec.cakeMass += (mps * 0.1 * C.simTimeFactor / 3600) / sectionArea;
            sec.dp = sectionDP(sec.cakeMass);
        } else {
            sec.dp = C.baseDP;
        }
    });

    // Итоговые ΔP тракта по фактическим ΔP секций
    O.avgFilterDP = state.sections.reduce((a, s) => a + s.dp, 0) / C.numSections;
    O.totalDP = O.avgFilterDP + O.ductDP + O.reactorDP + O.pipesDP + O.outletDP;

    // ── 10. МОЩНОСТЬ ДЫМОСОСА И ТОК ──
    // N_вал = Q(м³/с на всасе) × ΔP(Па) / η_вент;  N_эл = N_вал / η_двиг;  I = P / (√3·U·cosφ)
    const Q_fan = Qn * tfFan / 3600;
    const N_shaft = Q_fan * O.totalDP * 1000 / C.fanEfficiency;
    O.fanPowerKW = N_shaft / C.motorEfficiency / 1000;
    O.fanAmps = (O.fanPowerKW * 1000) / (C.fanVoltage * 1000 * 1.732 * C.fanCosF);
    if (n <= 0 || Qn <= 0) { O.fanAmps = 0; O.fanPowerKW = 0; }

    // ── 11. АВТО-РЕГЕНЕРАЦИЯ (секционная, по очереди, по уставке ΔP) ──
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
            P.regenCooldown = C.regenCooldownTicks;
            airUsedThisTick += C.bagsPerSection * C.pulseVolume;
            P.receiverPressure -= C.airPressureDrop;
            P.regenCycles.push(P.tickCount);   // счётчик циклов регенерации
            state.alarms.push(`↻ Авто-продувка: Секция ${worstIdx + 1} (ΔP=${worstDP.toFixed(2)} кПа)`);
        }
    }

    // ── 12. СЖАТЫЙ ВОЗДУХ ──
    // Компрессор имеет конечную производительность: при очень частых импульсах ресивер «садится»
    P.receiverPressure = clamp(P.receiverPressure + C.airRecoveryRate, 0, C.airPressureNom);
    O.receiverP = P.receiverPressure;

    // ── 13. СЧЁТЧИК ЦИКЛОВ РЕГЕНЕРАЦИИ В ЧАС ──
    // 600 тиков = 1 ч модельного времени (1 тик = 6 с)
    const windowTicks = 600;
    P.regenCycles = P.regenCycles.filter(t => P.tickCount - t < windowTicks);
    O.regenCyclesPerHour = P.regenCycles.length;
    O.airConsumption = O.regenCyclesPerHour * C.bagsPerSection * C.pulseVolume;  // нм³/ч

    // ── 14. БАЛАНС ФТОРА В ЦИРКУЛИРУЮЩЕМ ГЛИНОЗЁМЕ ──
    // Уловленный F накапливается в контуре (запас M_c), выводится с потоком свежего глинозёма
    // на электролиз:  M_c·df/dt = F_улов − f·Q_свежий.  Равновесие f = F_улов / Q_свежий:
    // меньше свежего (больше рецирк.) → F% растёт; больше свежего → разбавление.
    const fCapturedKgH = hfGen * effTotal * (19 / 20);
    const outFlowKgH = I.freshFeed * 1000;
    const dtH = C.simTimeFactor * 0.1 / 3600;       // ч модельного времени за тик
    const dF = (fCapturedKgH - P.fContentAccum / 100 * outFlowKgH) / (C.circulatingInventory * 1000) * 100 * dtH;
    P.fContentAccum = clamp(P.fContentAccum + dF, 0.01, C.maxFContent);
    O.fContent = P.fContentAccum;

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
    // Выбивание фиксируется по конкретной трубе (разрежение < 50 Па по модулю)
    const fugitivePipes = O.pipeFlows.filter(p => p.fugitive).map(p => p.id);
    if (fugitivePipes.length > 0) {
        bits.push(`ВЫБИВАНИЕ: ${fugitivePipes.join(',')}`);
        state.alarms.push(`⚠ ВЫБИВАНИЕ газа из корпуса (труба ${fugitivePipes.join(', ')}): слабое разрежение`);
    }
    if (O.fanAmps > C.fanMaxAmps) {
        bits.push('ПЕРЕГРУЗКА ДВИГАТЕЛЯ');
        state.alarms.push(`⚠ ПЕРЕГРУЗКА двигателя дымососа: ${Math.round(O.fanAmps)} А > ${C.fanMaxAmps} А`);
    }
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

    // ── 16. [v7] ПРЕДИКТИВНАЯ ДИАГНОСТИКА И СОВЕТЧИК (APM) ──
    runPredictiveDiagnostics();

    // Если активен режим «Идеальная ГОУ» (Автопилот советчика) — непрерывно подстраиваем
    if (state.idealMode) {
        autopilotStep();
    }
}

// ── Управляющие функции (вызываются из UI) ──

export function forcePulseAll() {
    state.sections.forEach(s => {
        s.isRegen = true;
        s.regenTimerMax = 20;
        s.regenTimer = 20;
    });
    state.phys.receiverPressure -= config.airPressureDrop * config.numSections;
    state.alarms.push('⚠ АВАРИЙНАЯ ПРОДУВКА всех секций (нештатный режим!)');
}

export function addTornBag() {
    state.inputs.tornBags++;
    state.alarms.push(`💥 ПРОРЫВ рукава! Всего повреждено: ${state.inputs.tornBags} шт.`);
}

// ══════════════════════════════════════════════════════════════════════
//  РЕЖИМ «ИДЕАЛЬНАЯ ГОУ» — АВТОПИЛОТ (без «читов»: только реальные актуаторы)
//  Автопилот не обнуляет неисправности и не подменяет физику. Он ведёт:
//    • НА дымососа — интегральный регулятор по нормальному расходу (держит refFlow,
//      компенсируя зиму/лето, закрытые шиберы, ΔP фильтра);
//    • подачу свежего глинозёма — по фактической нагрузке HF (анодный эффект, T газа)
//      и порывам рукавов; рециркуляцию = 4× свежего;
//    • уставку регенерации — пропорционально √нагрузки по сорбенту (частота ≈ 50–60 ц/ч);
//    • T газа, влажность, проектное разрежение, обороты — в проектные значения.
//  Параметр, который оператор двинул вручную, автопилот не трогает (state.hold).
// ══════════════════════════════════════════════════════════════════════

const IDEAL = {
    fanRPM:     100,
    guideVane:  69,
    gasTempSP:  105,
    gasHumidity: 5,
    inletDraft: -150,
    freshFeed:  5.5,
    recircFeed: 22,
    regenSP:    1.2,
    pipesDamper: 100,
};

// Параметры, которыми управляет автопилот
const AUTOPILOT_PARAMS = ['guideVane', 'fanRPM', 'freshFeed', 'recircFeed', 'gasTempSP',
                          'gasHumidity', 'inletDraft', 'regenSP'];

/**
 * Вызывается из UI при ручном изменении параметра в режиме автопилота (оператор перехватил
 * управление этим параметром), либо с null/'idealReset' — для штатного сброса в оптимум.
 */
export function autoTune(changedParam) {
    const I = state.inputs;
    if (changedParam && changedParam !== 'idealReset') {
        if (AUTOPILOT_PARAMS.includes(changedParam)) state.hold[changedParam] = true;
        return;
    }
    // Однократный возврат в проектный режим (включение «Идеальной ГОУ»)
    state.hold = {};
    I.fanRPM = IDEAL.fanRPM;
    I.guideVane = IDEAL.guideVane;
    I.gasTempSP = IDEAL.gasTempSP;
    I.gasHumidity = IDEAL.gasHumidity;
    I.inletDraft = IDEAL.inletDraft;
    I.freshFeed = IDEAL.freshFeed;
    I.recircFeed = IDEAL.recircFeed;
    I.regenSP = IDEAL.regenSP;
    I.pipes.forEach(p => p.damper = IDEAL.pipesDamper);
    I.tornBags = 0;
}

/** Один шаг автопилота (вызывается каждый тик при state.idealMode) */
function autopilotStep() {
    const I = state.inputs;
    const O = state.out;
    const C = config;
    const H = state.hold;

    if (!H.fanRPM) I.fanRPM = IDEAL.fanRPM;
    if (!H.gasTempSP) I.gasTempSP = IDEAL.gasTempSP;
    if (!H.gasHumidity) I.gasHumidity = IDEAL.gasHumidity;
    if (!H.inletDraft) I.inletDraft = IDEAL.inletDraft;

    // НА: интегральный регулятор расхода (шаг ≤0.5 %/тик, как реальный привод НА)
    if (!H.guideVane && O.normalFlow > 0) {
        const err = (C.refFlow - O.normalFlow) / C.refFlow;
        I.guideVane = clamp(I.guideVane + clamp(err * 40, -0.5, 0.5), 20, 100);
    }

    // Подача сорбента: фактическая нагрузка по HF + запас на порывы рукавов
    const load = Math.max(0.6, O.hfGenLoad || 1);
    const tornKick = 1 + I.tornBags / 100;
    if (!H.freshFeed) {
        const target = clamp(IDEAL.freshFeed * load * tornKick, 2.0, 10.0);
        I.freshFeed = parseFloat((I.freshFeed + (target - I.freshFeed) * 0.1).toFixed(2));
    }
    if (!H.recircFeed) {
        const target = clamp(I.freshFeed * 4, 5, 40);
        I.recircFeed = parseFloat((I.recircFeed + (target - I.recircFeed) * 0.1).toFixed(2));
    }
    if (!H.regenSP) {
        const feedRatio = (I.freshFeed + I.recircFeed * C.recircEfficiency) /
                          (IDEAL.freshFeed + IDEAL.recircFeed * C.recircEfficiency);
        const target = clamp(IDEAL.regenSP * Math.sqrt(feedRatio), 0.8, 2.5);
        I.regenSP = parseFloat((I.regenSP + (target - I.regenSP) * 0.1).toFixed(2));
    }
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

export function setIdealMode(on) {
    state.idealMode = on;
    if (on) {
        autoTune(null);
        state.alarms.push('✨ АВТОПИЛОТ СОВЕТЧИКА: ВКЛЮЧЁН (режим проектных уставок, НА ведёт расход)');
    } else {
        state.alarms.push('⏹ АВТОПИЛОТ СОВЕТЧИКА: ВЫКЛЮЧЕН (ручной режим оператора)');
    }
}

// ══════════════════════════════════════════════════════════════════════
//  [v7] ДВИЖОК ПРЕДИКТИВНОЙ АНАЛИТИКИ (APM ADVISOR)
// ══════════════════════════════════════════════════════════════════════

export function runPredictiveDiagnostics() {
    const I = state.inputs;
    const O = state.out;
    const P = state.phys;
    const adv = state.advisor;

    let score = 100;
    const recs = [];

    // ── 1. ДИАГНОСТИКА: РУКАВА И РЕГЕНЕРАЦИЯ ──
    let filterStatus = 'ok';
    let filterLabel = 'В НОРМЕ';
    let filterDesc = 'Рукава герметичны, перепад ΔP в норме';

    if (I.tornBags > 0) {
        const severity = I.tornBags > 5 ? 'danger' : 'warn';
        filterStatus = severity;
        filterLabel = I.tornBags > 5 ? 'АВАРИЯ' : 'ПОРЫВ РУКАВОВ';
        filterDesc = `Обнаружено ${I.tornBags} повреждённых рукавов. Проскок пыли: ${O.dustOut.toFixed(1)} мг/нм³`;
        score -= Math.min(40, I.tornBags * 8);

        recs.push({
            id: 'fix_torn_bags',
            module: 'filter',
            type: 'danger',
            title: `Разгерметизация фильтра (${I.tornBags} рук.)`,
            reason: `Выброс пыли вырос до ${O.dustOut.toFixed(1)} мг/нм³. Превышение норматива грозит экологическим штрафом и износом колеса дымососа.`,
            actionText: 'Изолировать секцию и заменить рукава',
            effectText: 'Снижение пыли до ≤5 мг/нм³, штраф 0 ₽',
            apply: () => {
                I.tornBags = 0;
                state.alarms.push('✓ Советчик: повреждённые рукава заменены');
            }
        });
    } else if (O.regenCyclesPerHour > 65) {
        filterStatus = 'warn';
        filterLabel = 'ЧАСТАЯ ПРОДУВКА';
        filterDesc = `Частота регенерации ${O.regenCyclesPerHour} ц/ч (норма 50–60). Повышенный износ ткани`;
        score -= 10;

        const optimalRegenSP = parseFloat(Math.min(2.0, I.regenSP + 0.15).toFixed(2));
        recs.push({
            id: 'opt_regen_freq',
            module: 'filter',
            type: 'warn',
            title: `Слишком частая регенерация (${O.regenCyclesPerHour} ц/ч)`,
            reason: `Импульсы срабатывают слишком часто. Это ведёт к перерасходу сжатого воздуха и истиранию фильтровального полотна.`,
            actionText: `Увеличить уставку ΔP до ${optimalRegenSP} кПа`,
            effectText: 'Возврат к норме 50–60 ц/ч, продление ресурса ткани на 30%',
            apply: () => {
                I.regenSP = optimalRegenSP;
                state.alarms.push(`✓ Советчик: уставка ΔP скорректирована до ${optimalRegenSP} кПа`);
            }
        });
    } else if (P.receiverPressure < 0.40) {
        filterStatus = 'warn';
        filterLabel = 'НИЗКОЕ ДАВЛЕНИЕ';
        filterDesc = `Давление в ресивере ${P.receiverPressure.toFixed(2)} МПа. Риск неполного сброса пирога`;
        score -= 10;
    }

    adv.modules.filter = { status: filterStatus, label: filterLabel, desc: filterDesc };

    // ── 2. ДИАГНОСТИКА: ГЛИНОЗЁМ И HF (ФТОР-БАЛАНС) ──
    let aluminaStatus = 'ok';
    let aluminaLabel = 'В НОРМЕ';
    let aluminaDesc = 'Сорбция HF эффективна, баланс сорбента оптимален';

    if (O.hfOut > 0.5) {
        const severity = O.hfOut > 1.0 ? 'danger' : 'warn';
        aluminaStatus = severity;
        aluminaLabel = O.hfOut > 1.0 ? 'ПРОСКОК HF' : 'РИСК ПДК';
        aluminaDesc = `HF на выходе ${O.hfOut.toFixed(2)} мг/нм³ превышает ПДК (0.5 мг/нм³)`;
        score -= Math.min(45, (O.hfOut - 0.5) * 40 + 20);

        let recHF;
        if (O.actualTemp > 115 || I.gasTempSP > 118) {
            recHF = {
                id: 'prevent_hf_slip', module: 'alumina', type: 'danger',
                title: `Проскок HF из-за перегрева газа (${O.actualTemp.toFixed(0)}°C)`,
                reason: `При T > 120°C хемосорбция HF на глинозёме падает (десорбция). HF на выходе ${O.hfOut.toFixed(2)} мг/нм³.`,
                actionText: 'Вернуть T газа на входе в реактор к 105°C',
                effectText: 'Восстановление хемосорбции, HF ниже 0.5 мг/нм³',
                apply: () => {
                    I.gasTempSP = 105;
                    state.alarms.push('✓ Советчик: уставка T газа возвращена к 105°C');
                }
            };
        } else if (O.normalFlow > config.refFlow * 1.1) {
            const vaneOpt = Math.round(clamp(I.guideVane + (config.refFlow - O.normalFlow) / 3000, 20, 100));
            recHF = {
                id: 'prevent_hf_slip', module: 'alumina', type: 'danger',
                title: `Проскок HF: слишком короткий контакт (τ=${O.contactTime.toFixed(1)} с)`,
                reason: `Расход ${Math.round(O.normalFlow / 1000)} тыс. нм³/ч выше проектного — газ проходит реактор быстрее, сорбент не успевает связать HF.`,
                actionText: `Прикрыть НА до ${vaneOpt}% (вернуть проектный расход)`,
                effectText: 'Рост времени контакта и η₁ реактора, HF ниже ПДК, экономия электроэнергии',
                apply: () => {
                    I.guideVane = vaneOpt;
                    state.alarms.push(`✓ Советчик: НА прикрыт до ${vaneOpt}% (контакт газ/сорбент)`);
                }
            };
        } else if (I.regenSP < 1.0 && O.regenCyclesPerHour > 65) {
            const newSP = parseFloat(clamp(I.regenSP + 0.4, 0.8, 2.5).toFixed(2));
            recHF = {
                id: 'prevent_hf_slip', module: 'alumina', type: 'danger',
                title: `Проскок HF: пирог на рукавах слишком тонкий`,
                reason: `Уставка ΔP ${I.regenSP} кПа заставляет сбрасывать пирог чаще ${O.regenCyclesPerHour} раз/ч — доочистка (η₂) падает.`,
                actionText: `Поднять уставку регенерации до ${newSP} кПа`,
                effectText: 'Рост η₂ пирога, HF ниже ПДК, экономия сжатого воздуха',
                apply: () => {
                    I.regenSP = newSP;
                    state.alarms.push(`✓ Советчик: уставка ΔP ${newSP} кПа`);
                }
            };
        } else {
            const neededFresh = parseFloat(Math.min(10.0, I.freshFeed + (O.hfOut > 1.0 ? 2.0 : 1.0)).toFixed(1));
            const neededRecirc = parseFloat(Math.min(40.0, neededFresh * 4).toFixed(1));
            recHF = {
                id: 'prevent_hf_slip', module: 'alumina', type: 'danger',
                title: `Превышение ПДК по фтористому водороду (${O.hfOut.toFixed(2)} мг/нм³)`,
                reason: `Недостаточная ёмкость глинозёма при текущей генерации HF. Риск экологических санкций (до 5000 ₽/ч).`,
                actionText: `Увеличить подачу: свежий ${neededFresh} т/ч, рецирк ${neededRecirc} т/ч`,
                effectText: 'Снижение HF на выходе ниже 0.5 мг/нм³, отмена штрафов',
                apply: () => {
                    I.freshFeed = neededFresh;
                    I.recircFeed = neededRecirc;
                    state.alarms.push(`✓ Советчик: подача сорбента увеличена до ${neededFresh}/${neededRecirc} т/ч`);
                }
            };
        }
        recs.push(recHF);
    } else if (P.tickCount > 100 && O.fContent < 0.45 && I.freshFeed > 3.0) {
        // Равновесное F = F_улов / Q_свежий → глинозём «бедный»: свежего подаётся больше необходимого
        aluminaStatus = 'warn';
        aluminaLabel = 'БЕДНЫЙ ГЛИНОЗЁМ';
        aluminaDesc = `Насыщение глинозёма ${O.fContent.toFixed(2)} wt% F (цель: 0.5–1.5%). Недоиспользование сорбента`;
        score -= 8;

        const captKgH = O.hfGenKgH * O.effHF / 100 * 19 / 20;
        const optFresh = parseFloat(clamp(captKgH / 9, 2.0, I.freshFeed).toFixed(1));  // F≈0.9%
        recs.push({
            id: 'opt_f_saturation',
            module: 'alumina',
            type: 'warn',
            title: `Низкое насыщение глинозёма фтором (${O.fContent.toFixed(2)} wt%)`,
            reason: `Свежего глинозёма подаётся больше, чем нужно для улавливания ${O.hfGenKgH.toFixed(0)} кг/ч HF — сорбент уходит в электролиз недонасыщенным.`,
            actionText: `Снизить подачу свежего до ${optFresh} т/ч (рецирк ${(optFresh * 4).toFixed(1)} т/ч)`,
            effectText: 'Рост насыщения до ~0.9 wt% F, экономия свежего глинозёма',
            apply: () => {
                I.freshFeed = optFresh;
                I.recircFeed = parseFloat(Math.min(40, optFresh * 4).toFixed(1));
                state.alarms.push(`✓ Советчик: подача свежего снижена до ${optFresh} т/ч`);
            }
        });
    } else if (P.tickCount > 100 && O.fContent > 1.8) {
        // Пересыщение: падает ёмкость сорбента, растёт риск проскока HF
        aluminaStatus = 'warn';
        aluminaLabel = 'ПЕРЕНАСЫЩЕНИЕ F';
        aluminaDesc = `Насыщение глинозёма ${O.fContent.toFixed(2)} wt% F (>1.8%) — ёмкость исчерпана, риск проскока HF`;
        score -= 8;

        const captKgH = O.hfGenKgH * O.effHF / 100 * 19 / 20;
        const optFresh = parseFloat(clamp(captKgH / 11, I.freshFeed, 10).toFixed(1));  // F≈1.1%
        recs.push({
            id: 'opt_f_saturation',
            module: 'alumina',
            type: 'warn',
            title: `Перенасыщение глинозёма фтором (${O.fContent.toFixed(2)} wt%)`,
            reason: `Подача свежего глинозёма мала относительно генерации HF — F накапливается в контуре.`,
            actionText: `Увеличить подачу свежего до ${optFresh} т/ч (рецирк ${(optFresh * 4).toFixed(1)} т/ч)`,
            effectText: 'Снижение F до ~1.1 wt%, запас по ёмкости сорбции',
            apply: () => {
                I.freshFeed = optFresh;
                I.recircFeed = parseFloat(Math.min(40, optFresh * 4).toFixed(1));
                state.alarms.push(`✓ Советчик: подача свежего увеличена до ${optFresh} т/ч`);
            }
        });
    }

    adv.modules.alumina = { status: aluminaStatus, label: aluminaLabel, desc: aluminaDesc };

    // ── 3. ДИАГНОСТИКА: ДЫМОСОС, РАЗРЕЖЕНИЕ И СЕЗОННОСТЬ ──
    let fanStatus = 'ok';
    let fanLabel = 'В НОРМЕ';
    let fanDesc = 'Разрежение стабильно, режим дымососа энергоэффективен';

    // Чувствительность расхода к НА (≈3000 нм³/ч на 1 % открытия вблизи рабочей точки)
    const FLOW_PER_VANE = 3000;
    const vaneForRef = Math.round(clamp(I.guideVane + (config.refFlow - O.normalFlow) / FLOW_PER_VANE, 20, 100));
    const fugitivePipes = O.pipeFlows.filter(p => p.fugitive);
    const closedPipes = fugitivePipes.filter(p => I.pipes.find(x => x.id === p.id).damper < 95);

    if (O.normalFlow > 0 && closedPipes.length > 0) {
        fanStatus = 'danger';
        fanLabel = 'ВЫБИВАНИЕ';
        const ids = closedPipes.map(p => p.id).join(', ');
        fanDesc = `Шибер трубы ${ids} прикрыт: нет разрежения, газ выходит в корпус`;
        score -= 30;
        recs.push({
            id: 'open_damper',
            module: 'fan',
            type: 'danger',
            title: `Выбивание газа: прикрыт шибер ${ids}`,
            reason: `Поток через трубу ${ids} упал, разрежение у электролизёров < 50 Па. Остальные трубы перегружены.`,
            actionText: `Открыть шибер(ы) ${ids} до 100%`,
            effectText: 'Восстановление разрежения, перераспределение потока по 4 трубам',
            apply: () => {
                closedPipes.forEach(p => { I.pipes.find(x => x.id === p.id).damper = 100; });
                state.alarms.push(`✓ Советчик: шиберы ${ids} открыты`);
            }
        });
    } else if (O.normalFlow > 0 && (fugitivePipes.length > 0 || O.calcDraft > -100)) {
        const slight = fugitivePipes.length === 0;
        fanStatus = slight ? 'warn' : 'danger';
        fanLabel = slight ? 'СЛАБОЕ РАЗРЕЖЕНИЕ' : 'ВЫБИВАНИЕ';
        fanDesc = `Разрежение ${Math.round(O.calcDraft)} Па (проект ${I.inletDraft} Па). ${slight ? 'Ниже проектного — риск выбивания' : 'Загазованность цеха!'}`;
        score -= slight ? 12 : 30;
        const neededVane = Math.max(vaneForRef, Math.min(100, I.guideVane + 5));
        recs.push({
            id: 'prevent_gas_escape',
            module: 'fan',
            type: slight ? 'warn' : 'danger',
            title: `${slight ? 'Слабое разрежение' : 'Опасность загазованности цеха'} (тяга ${Math.round(O.calcDraft)} Па)`,
            reason: `Расход ${Math.round(O.normalFlow / 1000)} тыс. нм³/ч ниже проектного ${Math.round(config.refFlow / 1000)} тыс. — тяги недостаточно для эвакуации газов от электролизёров.`,
            actionText: `Приоткрыть НА дымососа до ${neededVane}%`,
            effectText: 'Восстановление проектного разрежения, безопасная атмосфера в цехе',
            apply: () => {
                I.guideVane = neededVane;
                state.alarms.push(`✓ Советчик: НА открыт до ${neededVane}% для восстановления разрежения`);
            }
        });
    } else if (O.fanAmps > config.fanMaxAmps) {
        fanStatus = 'danger';
        fanLabel = 'ПЕРЕГРУЗКА';
        fanDesc = `Ток ${Math.round(O.fanAmps)} А выше номинала двигателя ${config.fanMaxAmps} А`;
        score -= 25;
        recs.push({
            id: 'fan_overload',
            module: 'fan',
            type: 'danger',
            title: `Перегрузка двигателя дымососа (${Math.round(O.fanAmps)} А)`,
            reason: `Мощность ${Math.round(O.fanPowerKW)} кВт превышает номинал. Риск срабатывания защиты и останова ГОУ.`,
            actionText: `Прикрыть НА до ${vaneForRef}%`,
            effectText: 'Ток двигателя в пределах номинала, расход вернётся к проектному',
            apply: () => {
                I.guideVane = vaneForRef;
                state.alarms.push(`✓ Советчик: НА прикрыт до ${vaneForRef}% (защита двигателя)`);
            }
        });
    } else if (O.normalFlow > config.refFlow * 1.1 && I.guideVane > 25) {
        // Избыточный расход: аффинитет — мощность дымососа ~ Q^2.5, зимой (плотный воздух) это
        // проявляется при тех же положениях НА сильнее [talk.txt]
        const winter = I.outdoorTemp <= -10;
        const r = config.refFlow / O.normalFlow;
        const savedKW = Math.round(O.fanPowerKW * (1 - Math.pow(r, 2.5)));
        const savedRubDay = Math.round(savedKW * 3.5 * 24);
        const savedRubMonth = savedRubDay * 30;
        fanStatus = 'warn';
        fanLabel = winter ? 'ЗИМНИЙ РАСХОД' : 'ИЗБЫТОЧНАЯ ТЯГА';
        fanDesc = winter
            ? `Тнар = ${I.outdoorTemp}°C. Плотный воздух, расход ${Math.round(O.normalFlow / 1000)} тыс. нм³/ч (+${Math.round((1 / r - 1) * 100)}%), резерв ~${savedKW} кВт`
            : `Расход ${Math.round(O.normalFlow / 1000)} тыс. нм³/ч выше проектного (разрежение ${Math.round(O.calcDraft)} Па), перерасход ~${savedKW} кВт`;
        score -= winter ? 10 : 8;
        recs.push({
            id: winter ? 'winter_energy_saving' : 'over_draft_saving',
            module: 'fan',
            type: 'eco',
            title: winter ? `Зимний резерв энергосбережения (${I.outdoorTemp}°C)` : `Избыточная тяга дымососа (${Math.round(O.calcDraft)} Па)`,
            reason: winter
                ? `Плотный морозный воздух даёт избыточный массовый расход при том же НА. Поджатие НА сохранит проектное разрежение и сэкономит электроэнергию.`
                : `Избыточное разрежение увеличивает подсосы и расход электроэнергии без выигрыша в очистке.`,
            actionText: `Поджать НА с ${Math.round(I.guideVane)}% до ${vaneForRef}%`,
            effectText: `Экономия ~${savedKW} кВт (~${savedRubDay.toLocaleString('ru-RU')} ₽/сут, ~${savedRubMonth.toLocaleString('ru-RU')} ₽/мес)`,
            apply: () => {
                I.guideVane = vaneForRef;
                state.alarms.push(`✓ Советчик: НА поджат до ${vaneForRef}% (экономия ~${savedKW} кВт)`);
            }
        });
    }

    adv.modules.fan = { status: fanStatus, label: fanLabel, desc: fanDesc };

    // ── ИТОГОВЫЙ HEALTH INDEX ──
    score = Math.max(10, Math.min(100, Math.round(score)));
    adv.healthIndex = score;
    if (score >= 90) adv.healthStatus = 'ОТЛИЧНО';
    else if (score >= 70) adv.healthStatus = 'ВНИМАНИЕ';
    else adv.healthStatus = 'ТРЕВОГА';

    adv.recommendations = recs;
}

// ── Запуск экспресс-сценариев ──
export function triggerScenario(name) {
    const I = state.inputs;
    const P = state.phys;
    const adv = state.advisor;

    if (name === 'anode_effect') {
        P.anodeEffectTimer = 200; // 20 сек симуляции
        adv.activeScenario = 'anode_effect';
        state.alarms.push('🔥 ДЕМО-СЦЕНАРИЙ: Анодный эффект на серии электролизеров (+50°C, 3.5× HF)!');
    } else if (name === 'winter_frost') {
        I.outdoorTemp = -30;
        adv.activeScenario = 'winter_frost';
        state.alarms.push('❄ ДЕМО-СЦЕНАРИЙ: Зимний мороз -30°C (резкий рост плотности воздуха и тока дымососа)!');
    } else if (name === 'bag_wear') {
        I.tornBags = Math.max(3, I.tornBags + 3);
        adv.activeScenario = 'bag_wear';
        state.alarms.push('🔍 ДЕМО-СЦЕНАРИЙ: Скрытый порыв 3 рукавов (микроскачки пыли при регенерации)!');
    }
}

// ── Применение рекомендаций советчика ──
export function applyRecommendation(recId) {
    const adv = state.advisor;
    if (recId === 'all') {
        adv.recommendations.forEach(r => {
            if (typeof r.apply === 'function') r.apply();
        });
        adv.recommendations = [];
    } else {
        const r = adv.recommendations.find(item => item.id === recId);
        if (r && typeof r.apply === 'function') {
            r.apply();
        }
    }
}

