// ═══════════════════════════════════════════════════════════════════════
//  ANTIGRAVITY СГОУ — ФИЗИЧЕСКИЙ ДВИЖОК v8.0
//  Честная аэродинамика (дымосос + самотяга трубы ∩ параллельные ветви),
//  физическое разрежение укрытий vs уставка, клапан подсоса, точка росы и
//  цементация пирога, динамическая активность сорбента в пироге (cakeActivity),
//  зависимость η₂ от скорости фильтрации v_f, посекционная локализация
//  порывов рукавов и пиковый детектор (Peak Hold) для трендов 1 Гц.
// ═══════════════════════════════════════════════════════════════════════

import { config, IDEAL, PHYSICS_HINTS, clamp, getTornBagsInSection } from './config.js';
import {
    runPredictiveDiagnostics as runAPM,
    autopilotStep,
    autoTune as advisorAutoTune,
    setIdealMode as advisorSetIdealMode,
    triggerScenario as advisorTriggerScenario,
    applyRecommendation as advisorApplyRec,
} from './advisor.js';

export { config, IDEAL, PHYSICS_HINTS, getTornBagsInSection };

// ── Мутабельное состояние симуляции ──
export const state = {
    // Входные параметры (управляются из UI или Автопилотом)
    inputs: {
        fanRPM:        IDEAL.fanRPM,        // % оборотов рабочего колеса (100% — синхр. двигатель)
        guideVane:     IDEAL.guideVane,     // % открытия НА (5–100) — ОСНОВНОЙ регулятор тяги
        gasTempSP:     IDEAL.gasTempSP,     // Температура газов из электролизёров (°C)
        gasHumidity:   IDEAL.gasHumidity,   // Влажность газа (%)
        inletDraft:    IDEAL.inletDraft,    // Уставка разрежения под укрытиями корпусов (Па)
        dilutionValve: IDEAL.dilutionValve, // % открытия клапана подсоса воздуха перед реактором
        freshFeed:     IDEAL.freshFeed,     // Подача свежего Al₂O₃ (т/ч)
        recircFeed:    IDEAL.recircFeed,    // Подача рециркулирующего Al₂O₃·AlF₃ (т/ч)
        regenSP:       IDEAL.regenSP,       // Уставка авто-продувки секций фильтра по ΔP (кПа)
        tornBags:      0,                   // Количество порванных рукавов (шт.)
        timeSpeed:     1,                   // Множитель скорости времени (1x–10x)
        outdoorTemp:   20,                  // Температура наружного воздуха (°C)
        pipes: [
            { id: '1A', damper: 100 },
            { id: '1B', damper: 100 },
            { id: '2A', damper: 100 },
            { id: '2B', damper: 100 },
        ]
    },

    // Секции рукавного фильтра (4 секции, разнесены по начальной массе пирога для равномерного шага)
    sections: [
        { dp: 1.08, cakeMass: 4.5, isRegen: false, regenTimer: 0, regenTimerMax: 15, tornCount: 0 },
        { dp: 1.15, cakeMass: 5.0, isRegen: false, regenTimer: 0, regenTimerMax: 15, tornCount: 0 },
        { dp: 1.02, cakeMass: 4.1, isRegen: false, regenTimer: 0, regenTimerMax: 15, tornCount: 0 },
        { dp: 1.12, cakeMass: 4.8, isRegen: false, regenTimer: 0, regenTimerMax: 15, tornCount: 0 },
    ],

    // Внутреннее динамическое состояние физических процессов
    phys: {
        fanAngle:          0,
        regenCooldown:     0,
        fContentAccum:     0.72,    // Текущее содержание фтора в глинозёме (wt%)
        cakeActivity:      0.98,    // Химическая активность слоя глинозёма на рукавах (0..1)
        actualTemp:        101,     // Фактическая T° газа в реакторе (с теплопотерями и инерцией)
        receiverPressure:  0.60,    // Давление сжатого воздуха в ресивере (МПа)
        tickCount:         0,
        regenCycles:       [],      // Таймстампы импульсов регенерации за скользящий час (600 тиков)
        dustSpikeTicks:    0,       // Оставшиеся тики скачка пыли/HF при продувке
        spikeTornCount:    0,       // Сколько порванных рукавов было в продутой секции
        anodeEffectTimer:  0,       // Таймер активного анодного эффекта (тики)
        peakDustOut:       0,       // Пиковый детектор пыли между опросами UI (1 Гц)
        peakHfOut:         0,       // Пиковый детектор HF между опросами UI (1 Гц)
    },

    // Состояние интеллектуального советчика (APM v8.0)
    advisor: {
        healthIndex:  100,
        healthStatus: 'ОТЛИЧНО',
        modules: {
            filter:  { status: 'ok', label: 'В НОРМЕ', desc: 'Рукава целы, ΔP стабилен' },
            alumina: { status: 'ok', label: 'В НОРМЕ', desc: 'HF улавливается, F% в норме' },
            fan:     { status: 'ok', label: 'В НОРМЕ', desc: 'Тяга и ток согласованы' },
        },
        recommendations: [],
        activeScenario: null,
    },

    // Выходные параметры телеметрии (рассчитываются каждый тик)
    out: {
        gasFlow:            0,      // Фактический объёмный расход в реакторе (м³/ч при раб. T°)
        normalFlow:         0,      // Суммарный нормальный расход через реактор и фильтр (нм³/ч)
        potroomFlow:        220000, // Нормальный расход газов именно от корпусов электролиза (нм³/ч)
        dilutionFlow:       0,      // Подсос воздуха через клапан перед реактором (нм³/ч)
        dilutionFrac:       0,      // Доля разбавления холодным воздухом перед реактором
        gasVelocity:        11.0,   // Скорость газа в сборном газоходе (м/с)
        filtVelocity:       0.017,  // Скорость фильтрации через ткань рукавов (м/с)
        fanAmps:            0,      // Ток электродвигателя дымососа (А)
        fanPowerKW:         0,      // Электрическая мощность дымососа (кВт)
        avgFilterDP:        0,      // Средний перепад ΔP рукавного фильтра (кПа)
        ductDP:             0,      // Потери давления в газоходах Дарси-Вейсбаха (кПа)
        totalDP:            0,      // Полное сопротивление тракта (кПа)
        stackDraft:         0.21,   // Естественная самотяга 90-метровой дымовой трубы (кПа)
        calcDraft:          -150,   // Фактическое среднее разрежение под укрытиями корпусов (Па)
        hfIn:               0,      // Концентрация HF на входе в реактор (мг/нм³)
        hfOut:              0,      // Концентрация HF в трубе на выходе (мг/нм³)
        peakHfDisplay:      0,      // Пиковое значение HF с учётом прострелов регенерации (мг/нм³)
        hfGenKgH:           0,      // Массовая генерация HF от электролизёров (кг/ч)
        dustOut:            0,      // Концентрация пыли на выходе (мг/нм³)
        peakDustDisplay:    0,      // Пиковое значение пыли с учётом прострелов регенерации (мг/нм³)
        effReactor:         0,      // КПД 1-й ступени — реактора Вентури η₁ (%)
        effCake:            0,      // КПД 2-й ступени — пирога на рукавах η₂ (%)
        effHF:              0,      // Общий КПД улавливания HF (%)
        effDust:            0,      // КПД пылеулавливания (%)
        fContent:           0.72,   // Содержание фтора во вторичном глинозёме (wt%)
        cakeActivity:       0.98,   // Доля активных сорбционных центров в пироге (0..1)
        actualTemp:         101,    // Фактическая T° газа в реакторе (°C)
        dewPointTemp:       61.5,   // Температура точки росы (°C)
        dewPointMargin:     39.5,   // Запас температуры газа над точкой росы (°C)
        contactTime:        2.4,    // Время контакта газа с глинозёмом в реакторе (сек)
        airConsumption:     0,      // Расход сжатого воздуха на продувку (нм³/ч)
        receiverP:          0.60,   // Давление в ресивере сжатого воздуха (МПа)
        regenCyclesPerHour: 48,     // Частота циклов регенерации (ц/ч)
        outdoorTemp:        20,     // Температура наружного воздуха (°C)
        fanInletTemp:       88,     // Температура газовой смеси на всасе дымососа (°C)
        reactorDP:          0,      // ΔP реактора Вентури (кПа)
        pipesDP:            0,      // ΔP 4 входных труб с шиберами (кПа)
        outletDP:           0,      // ΔP выходного тракта и дымовой трубы (кПа)
        hfGenLoad:          1,      // Относительная нагрузка по генерации HF (× от номинала)
        status:             'НОРМА',
        pipeFlows: [
            { id: '1A', flow: 55000, draft: -150, fugitive: false },
            { id: '1B', flow: 55000, draft: -150, fugitive: false },
            { id: '2A', flow: 55000, draft: -150, fugitive: false },
            { id: '2B', flow: 55000, draft: -150, fugitive: false },
        ],
        pulseFlash: [false, false, false, false],
    },

    alarms: [],
    idealMode: false,
    hold: {},
};

// Предварительное заполнение окна регенерации (48 ц/ч на старте для отсутствия скачка с нуля)
for (let t = -580; t <= -10; t += 12) {
    state.phys.regenCycles.push(t);
}

// ══════════════════════════════════════════════════════════════════════
//  tick() — один шаг физической симуляции (10 Гц × timeSpeed)
// ══════════════════════════════════════════════════════════════════════
export function tick() {
    const I = state.inputs;
    const C = config;
    const P = state.phys;
    const O = state.out;
    P.tickCount++;
    state.alarms = [];
    O.pulseFlash = [false, false, false, false];

    // ── 1. ТЕПЛООБМЕН В ГАЗОХОДЕ, ПОДСОС ХОЛОДНОГО ВОЗДУХА И ТОЧКА РОСЫ ──
    // Экспоненциальное остывание газа в 200-метровом наружном газоходе:
    // при падении скорости (или останове дымососа) газ остывает до температуры улицы.
    const qRelPrev = O.potroomFlow > 100 ? O.potroomFlow / C.refFlow : 0;
    const ductRetention = qRelPrev > 0.01 ? Math.exp(-0.052 / Math.max(qRelPrev, 0.08)) : 0.0;
    let potGasTemp = I.outdoorTemp + (I.gasTempSP - I.outdoorTemp) * ductRetention;

    // Залповый перегрев при анодном эффекте в электролизёрах (+55°C)
    if (P.anodeEffectTimer > 0) {
        const surgeRatio = P.anodeEffectTimer / 200;
        potGasTemp += surgeRatio * 55;
    }

    // Смешение с наружным воздухом через клапан подсоса перед реактором
    const dilFrac = O.dilutionFrac || 0;
    let targetTemp = (1 - dilFrac) * potGasTemp + dilFrac * I.outdoorTemp;

    // Охлаждение газа свежим глинозёмом из уличного силоса (зимой глинозём холодный)
    if (O.normalFlow > 1000 && I.freshFeed > 0) {
        const siloTemp = 0.6 * I.outdoorTemp + 8;
        const aluminaHeatCapRatio = 0.012 * (I.freshFeed / 5.5) * (C.refFlow / Math.max(O.normalFlow, 50000));
        targetTemp -= aluminaHeatCapRatio * Math.max(0, targetTemp - siloTemp);
    }

    // Тепловая инерция газового тракта и металлоконструкций
    P.actualTemp += (targetTemp - P.actualTemp) * C.thermalK;
    O.actualTemp = P.actualTemp;
    const T = P.actualTemp;

    // Точка росы (зависит от влажности и присутствия кислых газов HF/SO₂)
    O.dewPointTemp = 52 + 1.9 * I.gasHumidity;
    O.dewPointMargin = T - O.dewPointTemp;

    // ── 2. ПЛОТНОСТИ ГАЗА, ТЕМПЕРАТУРНЫЕ ФАКТОРЫ И САМОТЯГА ДЫМОВОЙ ТРУБЫ ──
    const tf = (T + 273) / 273;
    const tFan = (1 - C.falseAirFrac) * T + C.falseAirFrac * I.outdoorTemp;
    const tfFan = (tFan + 273) / 273;
    const rhoGas = 1.293 * 273 / (T + 273);
    const rhoOut = 1.293 * 273 / (I.outdoorTemp + 273);
    const rhoFan = 1.293 * 273 / (tFan + 273);

    const sT = (T + 273) / (C.refTemp + 273);
    const sTfan = (tFan + 273) / (C.refTemp + 273);
    const rhoFanRatio = (C.refTemp + 273) / (tFan + 273);

    // Естественная тяга 90-метровой дымовой трубы: ΔP_stack = g·H·(ρ_нар − ρ_дым)
    const stackDraftKPa = clamp(9.81 * C.stackHeight * (rhoOut - rhoFan) / 1000, -0.10, 0.65);
    const refStackDraftKPa = 0.21; // Самотяга в расчётной точке (+20°C)
    const stackDraftBonus = stackDraftKPa - refStackDraftKPa;

    O.outdoorTemp = I.outdoorTemp;
    O.fanInletTemp = tFan;
    O.stackDraft = stackDraftKPa;

    // ── 3. ГИДРАВЛИЧЕСКАЯ СЕТЬ: 4 ПАРАЛЛЕЛЬНЫЕ ТРУБЫ + КЛАПАН ПОДСОСА + ФИЛЬТР ──
    const n = I.fanRPM / 100;
    const alpha = I.guideVane / 100;

    // Нелинейная расходная характеристика дисковых шиберов 4 труб: g_i = (d_i/100)^1.35
    const pipeConductances = I.pipes.map(p => Math.pow(clamp(p.damper / 100, 0, 1), 1.35));
    const G_pipes = pipeConductances.reduce((s, g) => s + g, 0);

    // Проводимость ветви клапана аварийного подсоса перед реактором
    const G_dil = 1.15 * Math.pow(clamp(I.dilutionValve / 100, 0, 1), 1.15);
    const G_total = G_pipes + G_dil;

    // Посекционный учёт порванных рукавов
    state.sections.forEach((sec, idx) => {
        sec.tornCount = getTornBagsInSection(idx, I.tornBags, C.numSections);
    });

    // Коэффициент сопротивления пирога: вязкость + влажность + конденсация у точки росы + порывы
    const visc = Math.pow(sT, 0.7);
    const dewDeficit = Math.max(0, 24 - O.dewPointMargin);
    const coldBlind = 1 + 0.035 * dewDeficit + 0.0028 * dewDeficit * dewDeficit;
    const humF = 1 + I.gasHumidity * 0.012;
    const tornReduction = clamp(1 - (I.tornBags / C.totalBags) * 1.6, 0.55, 1.0);
    // Секция в момент импульса продувки временно поджата встречной струёй воздуха
    const numRegen = state.sections.filter(s => s.isRegen && s.regenTimer > secRegenHalf(s)).length;
    const regenAreaFactor = 1 / Math.max(0.75, 1 - 0.06 * numRegen);

    const cakeCoef = visc * coldBlind * humF * tornReduction * regenAreaFactor;
    const avgW = state.sections.reduce((a, s) => a + s.cakeMass, 0) / C.numSections;
    const bF = C.cakeResistance * avgW * cakeCoef / 1000 * tf / (3600 * C.filterArea);

    // Квадратичные потери давления: газоходы, реактор, параллельные ветви всаса, выходной тракт
    const vPerQ = tf / (3600 * C.ductArea);
    const aDuct = C.ductFriction * (C.ductLength / C.ductDiameter) * rhoGas * 0.5 * vPerQ * vPerQ / 1000;
    const q2 = 1 / (C.refFlow * C.refFlow);
    const pipeMult = G_total > 0.0005 ? Math.pow(4 / G_total, 2) : 1e6;
    const aQ = aDuct + (C.reactorDP + C.pipeDP * pipeMult) * sT * q2 + C.otherDP * sTfan * q2;

    // ── 4. РАБОЧАЯ ТОЧКА «ДЫМОСОС + САМОТЯГА ТРУБЫ ∩ ХАРАКТЕРИСТИКА СЕТИ» ──
    const Qmax = (n > 0 && G_total > 0.0005) ? C.nominalFlow * n * alpha * rhoFanRatio : 0;
    const Pmax = C.maxFanPressure * n * n * Math.pow(alpha, 1.5) * rhoFanRatio;
    const effectivePmax = Pmax + stackDraftBonus;

    let Qn = 0;
    if (Qmax > 1 && effectivePmax > C.baseDP && G_total > 0.0005) {
        const A = aQ + Pmax / (Qmax * Qmax);
        const disc = bF * bF + 4 * A * (effectivePmax - C.baseDP);
        if (disc > 0) {
            Qn = Math.max(0, (-bF + Math.sqrt(disc)) / (2 * A));
        }
    }

    O.normalFlow = Qn;
    O.potroomFlow = G_total > 0.0005 ? Qn * (G_pipes / G_total) : 0;
    O.dilutionFlow = Qn - O.potroomFlow;
    O.dilutionFrac = Qn > 0 ? O.dilutionFlow / Qn : 0;

    O.gasFlow = Qn * tf;
    O.gasVelocity = (O.gasFlow / 3600) / C.ductArea;
    O.filtVelocity = (O.gasFlow / 3600) / C.filterArea;
    const vf = O.filtVelocity;

    const qr2 = (Qn * Qn) * q2;
    O.ductDP = aDuct * Qn * Qn;
    O.reactorDP = C.reactorDP * sT * qr2;
    O.pipesDP = G_total > 0.0005 ? C.pipeDP * pipeMult * sT * qr2 : 0;
    O.outletDP = C.otherDP * sTfan * qr2;

    // ── 5. РАСПРЕДЕЛЕНИЕ ПОТОКОВ ПО 4 ТРУБАМ И ФИЗИЧЕСКОЕ РАЗРЕЖЕНИЕ ПОД УКРЫТИЯМИ ──
    // Разрежение в каждом корпусе определяется фактическим расходом через данную ветвь:
    // P_draft,i = -150 Па · sT · (q_i / q_ном)^2. Закон сохранения массы: Σ q_i = O.potroomFlow.
    const qRefPipe = C.refFlow / 4;
    O.pipeFlows.forEach((pf, i) => {
        const g = pipeConductances[i];
        pf.flow = G_pipes > 0.0005 ? O.potroomFlow * (g / G_pipes) : 0;
        const r = pf.flow / qRefPipe;
        pf.draft = C.refDraft * sT * r * r;
        pf.fugitive = Math.abs(pf.draft) < 50;
        pf.id = I.pipes[i].id;
    });
    O.calcDraft = O.pipeFlows.reduce((a, p) => a + p.draft, 0) / O.pipeFlows.length;

    // ── 6. ГЕНЕРАЦИЯ HF И ПЫЛИ ОТ ЭЛЕКТРОЛИЗЁРОВ ──
    const hfNom = C.hfGenFactor * C.potroomCurrent;
    let hfTempFactor = potGasTemp > 135 ? 1 + (potGasTemp - 135) * 0.045 : 1.0;

    if (P.anodeEffectTimer > 0) {
        const surgeRatio = P.anodeEffectTimer / 200;
        hfTempFactor += surgeRatio * 2.4;
        P.anodeEffectTimer--;
        if (P.anodeEffectTimer === 0 && state.advisor.activeScenario === 'anode_effect') {
            state.advisor.activeScenario = null;
            state.alarms.push('✓ Анодный эффект на серии электролиза погашен');
        }
    }

    // Доля газа, реально захваченная из корпусов (при выбивании часть HF уходит под фонарь цеха, но концентрация в трубе высокая)
    const captureRatio = O.potroomFlow > 0 ? clamp(O.potroomFlow / (C.refFlow * 0.35), 0.2, 1.0) : 0;
    const hfGen = hfNom * Math.min(4.5, hfTempFactor) * captureRatio;
    const dustGen = C.dustGenFactor * C.potroomCurrent * captureRatio;
    O.hfGenKgH = hfGen;
    O.hfGenLoad = hfNom > 0 ? (hfNom * Math.min(4.5, hfTempFactor)) / hfNom : 1;
    O.hfIn = Qn > 100 ? (hfGen * 1e6) / Qn : 0;

    // ── 7. ДВУХСТУПЕНЧАТАЯ ХЕМОСОРБЦИЯ HF (РЕАКТОР ВЕНТУРИ η₁ + АКТИВНЫЙ ПИРОГ η₂) ──
    // Температурный фактор десорбции при T > 118°C
    const tempPenalty = T > 118 ? Math.exp(-0.014 * (T - 118)) : 1.0;
    // Умеренная влажность улучшает хемосорбцию HF на поверхности Al₂O₃
    const humBonus = 1.0 + clamp(I.gasHumidity, 0, 14) * 0.002;
    // Время контакта в реакторе Вентури
    const contactTimeSec = O.gasFlow > 100 ? (C.reactorVolume / (O.gasFlow / 3600)) : 0;
    O.contactTime = Math.min(99, contactTimeSec);
    const contactF = contactTimeSec > 0 ? 1 - Math.exp(-contactTimeSec / C.optimalContactTime) : 0;

    // Фактор насыщения циркулирующего глинозёма фтором (>1.75 wt% — ёмкость падает)
    const satF = 1 - 0.65 * clamp((P.fContentAccum - 1.75) / (C.maxFContent - 1.75), 0, 1);

    // Эффективная подача активного сорбента (свежий + рецирк с учётом остаточной ёмкости)
    const effAlumina = I.freshFeed + I.recircFeed * C.recircEfficiency * satF; // т/ч
    const sorbRatio = hfGen > 0.1 ? (effAlumina * 1000) / hfGen : 0;           // кг сорбента / кг HF

    // Влияние кратности рециркуляции на плотность взвеси в трубе Вентури
    const recircRatio = I.freshFeed > 0.1 ? I.recircFeed / I.freshFeed : (I.recircFeed > 0 ? 4 : 0);
    const suspensionFactor = 0.88 + 0.12 * clamp(recircRatio / 3.0, 0, 1);

    // Ступень 1: Реактор Вентури (η₁)
    let eta1 = C.maxReactorEff * (1 - Math.exp(-C.reactorK * sorbRatio)) * tempPenalty * contactF * humBonus * satF * suspensionFactor;
    eta1 = clamp(eta1, 0, C.maxReactorEff);

    // Динамика химической активности пирога на рукавах (cakeActivity):
    // При нормальной подаче глинозёма пирог непрерывно обновляется свежими активными зернами Al₂O₃.
    // При отключении/снижении подачи глинозёма проходящий поток HF быстро насыщает поверхностный слой пирога,
    // снижая его сорбционную способность с ~99.5% до ~91–92% (выброс HF 12–16 мг/нм³, см. talk.txt).
    const targetCakeActivity = clamp(0.42 + 0.58 * (1 - Math.exp(-sorbRatio / 110)), 0.42, 1.0);
    const activityRate = targetCakeActivity < P.cakeActivity
        ? 0.055 * Math.max(0.4, O.hfGenLoad) * clamp(Qn / C.refFlow, 0.2, 1.8)
        : 0.18;
    P.cakeActivity = clamp(P.cakeActivity + (targetCakeActivity - P.cakeActivity) * activityRate, 0.42, 1.0);
    O.cakeActivity = P.cakeActivity;

    // Ступень 2: Фильтр-пирог (η₂ — Filsorption)
    // Зависит от:
    //  • массы пирога avgW (тонкий пирог при низкой уставке ΔP → канальный проскок),
    //  • скорости фильтрации vf (выше скорость → меньше время контакта газа в слое пирога),
    //  • химической активности пирога P.cakeActivity (истощается при отказе дозаторов Al₂O₃).
    const vfRef = (C.refFlow * ((C.refTemp + 273) / 273) / 3600) / C.filterArea; // ~0.0169 м/с
    const vfFactor = vf > 0.002 ? Math.pow(vfRef / vf, 0.65) : 1.0;
    const cRatio = Math.pow(Math.max(0.1, avgW / 3.0), 0.90);
    const loadF = Math.sqrt(Math.max(0.5, O.hfGenLoad));
    const cakeLambda = C.cakeK * cRatio * vfFactor * Math.pow(P.cakeActivity, 1.85) / loadF;
    let eta2 = C.maxCakeEff * (1 - Math.exp(-cakeLambda)) * tempPenalty * satF;
    eta2 = clamp(eta2, 0, C.maxCakeEff);

    // Проскок через порванные рукава (байпас газовой фазы мимо пирога)
    const tornFrac = Math.min(I.tornBags / C.totalBags, 0.30);
    const gasBypass = tornFrac * C.tornGasBypass;
    const slipFrac = (1 - eta1) * ((1 - gasBypass) * (1 - eta2) + gasBypass);
    const effTotal = Qn > 100 ? 1 - slipFrac : 0;

    O.effReactor = eta1 * 100;
    O.effCake = eta2 * 100;
    O.effHF = effTotal * 100;
    let currentHfOut = O.hfIn * slipFrac;

    // ── 8. ДИНАМИЧЕСКАЯ МОДЕЛЬ ПЫЛИ И ДИАГНОСТИЧЕСКИЕ ПИКИ ПРИ ПРОДУВКЕ ──
    const totalMassIn = dustGen + (I.freshFeed + I.recircFeed) * 1000; // кг/ч
    const dustLoading = Qn > 100 ? (totalMassIn * 1e6) / Qn : 0;
    const cakeEtaDust = 0.99990 + 0.00008 * (1 - Math.exp(-avgW / 0.5));
    const dustBase = dustLoading * (1 - cakeEtaDust);
    const dustTorn = dustLoading * tornFrac * C.tornDustLeak;
    let dustTotal = Qn > 100 ? dustBase + dustTorn : 0;
    O.effDust = dustLoading > 0 ? clamp(100 * (1 - dustTotal / dustLoading), 0, 99.9999) : 100;

    // Диагностический прострел пыли и HF при импульсной регенерации секции с порванными рукавами
    // (ключевой признак порыва по опыту эксплуатации — talk.txt, стр. 235–238, 405)
    if (P.dustSpikeTicks > 0 && Qn > 100) {
        const decay = P.dustSpikeTicks / 10;
        if (P.spikeTornCount > 0) {
            const dustPulse = (6.0 + P.spikeTornCount * 4.5 + I.tornBags * 0.8) * decay;
            const hfPulse = (0.28 + P.spikeTornCount * 0.18) * decay;
            dustTotal += dustPulse;
            currentHfOut += hfPulse;
        } else {
            // На целых рукавах импульс даёт лишь микроскопическое шевеление ткани (≤0.3 мг/нм³)
            dustTotal += 0.25 * decay;
        }
        P.dustSpikeTicks--;
    }

    O.dustOut = Math.max(0, dustTotal);
    O.hfOut = Math.max(0, currentHfOut);

    // Обновляем Peak Hold детекторы, чтобы 1-секундный опрос UI/графиков гарантированно поймал пик продувки
    P.peakDustOut = Math.max(P.peakDustOut, O.dustOut);
    P.peakHfOut = Math.max(P.peakHfOut, O.hfOut);
    O.peakDustDisplay = P.peakDustOut;
    O.peakHfDisplay = P.peakHfOut;

    // ── 9. НАКОПЛЕНИЕ ПИРОГА, ВЛАЖНАЯ ЦЕМЕНТАЦИЯ И ИМПУЛЬСНАЯ РЕГЕНЕРАЦИЯ ──
    const mps = Qn > 100 ? totalMassIn / C.numSections : 0;
    const sectionArea = C.filterArea / C.numSections;

    // Эффективность импульса зависит от давления в ресивере и влажности/точки росы:
    // влажный пирог цементируется и хуже отряхивается с рукавов.
    const airFactor = clamp((P.receiverPressure - 0.22) / 0.25, 0.20, 1.0);
    const wetStickiness = clamp(1 - Math.max(0, I.gasHumidity - 8) * 0.035 - dewDeficit * 0.025, 0.35, 1.0);
    const effectiveResidualCake = C.residualCake + Math.max(0, 1 - wetStickiness) * 1.4;
    const sectionDP = (W, secTorn) => {
        const secTornRed = clamp(1 - (secTorn / C.bagsPerSection) * 1.6, 0.50, 1.0);
        return C.baseDP + (C.cakeResistance * vf * W * visc * coldBlind * humF * secTornRed) / 1000;
    };

    state.sections.forEach((sec, i) => {
        if (sec.isRegen) {
            if (sec.regenTimer === sec.regenTimerMax) {
                const blowEff = C.pulseBlowEff * airFactor * wetStickiness;
                const removed = blowEff * Math.max(0, sec.cakeMass - effectiveResidualCake);
                sec.cakeMass -= removed;
                O.pulseFlash[i] = true;
                P.dustSpikeTicks = 10;
                P.spikeTornCount = sec.tornCount;
            }
            sec.regenTimer--;
            sec.dp = Qn > 100 ? sectionDP(sec.cakeMass, sec.tornCount) : 0;
            if (sec.regenTimer <= 0) sec.isRegen = false;
        } else if (Qn > 100) {
            sec.cakeMass += (mps * 0.1 * C.simTimeFactor / 3600) / sectionArea;
            sec.dp = sectionDP(sec.cakeMass, sec.tornCount);
        } else {
            sec.dp = 0;
        }
    });

    O.avgFilterDP = state.sections.reduce((a, s) => a + s.dp, 0) / C.numSections;
    O.totalDP = Qn > 100 ? (O.avgFilterDP + O.ductDP + O.reactorDP + O.pipesDP + O.outletDP) : 0;

    // ── 10. МОЩНОСТЬ НА ВАЛУ И ТОК ДВИГАТЕЛЯ ДЫМОСОСА ──
    const Q_fan = (Qn * tfFan) / 3600;
    const fanStaticDP = Math.max(0, O.totalDP - stackDraftBonus);
    const N_shaft = (Q_fan * fanStaticDP * 1000) / C.fanEfficiency;
    O.fanPowerKW = N_shaft / C.motorEfficiency / 1000;
    O.fanAmps = (O.fanPowerKW * 1000) / (C.fanVoltage * 1000 * 1.732 * C.fanCosF);
    if (n <= 0 || Qn <= 100) {
        O.fanAmps = 0;
        O.fanPowerKW = 0;
    }

    // ── 11. АВТОМАТИЧЕСКАЯ ПОСЕКЦИОННАЯ РЕГЕНЕРАЦИЯ ПО ΔP ──
    if (P.regenCooldown > 0) P.regenCooldown--;
    if (P.regenCooldown <= 0 && Qn > 100) {
        let worstIdx = -1;
        let worstDP = 0;
        state.sections.forEach((s, i) => {
            if (!s.isRegen && s.dp >= I.regenSP && s.dp > worstDP) {
                worstDP = s.dp;
                worstIdx = i;
            }
        });
        if (worstIdx >= 0) {
            const sec = state.sections[worstIdx];
            sec.isRegen = true;
            sec.regenTimerMax = 15;
            sec.regenTimer = 15;
            P.regenCooldown = C.regenCooldownTicks;
            P.receiverPressure = Math.max(0.15, P.receiverPressure - C.airPressureDrop);
            P.regenCycles.push(P.tickCount);
            const tornNote = sec.tornCount > 0 ? ` [⚠ прострел пыли: ${sec.tornCount} рван. рук.]` : '';
            state.alarms.push(`↻ Авто-продувка: Секция ${worstIdx + 1} (ΔP=${worstDP.toFixed(2)} кПа)${tornNote}`);
        }
    }

    // ── 12. БАЛАНС СЖАТОГО ВОЗДУХА В РЕСИВЕРЕ ──
    P.receiverPressure = clamp(P.receiverPressure + C.airRecoveryRate, 0.15, C.airPressureNom);
    O.receiverP = P.receiverPressure;

    // ── 13. СЧЁТЧИК ЦИКЛОВ РЕГЕНЕРАЦИИ В ЧАС (СКОЛЬЗЯЩЕЕ ОКНО 600 ТИКОВ = 1 Ч МОДЕЛИ) ──
    const windowTicks = 600;
    P.regenCycles = P.regenCycles.filter(t => P.tickCount - t < windowTicks);
    O.regenCyclesPerHour = P.regenCycles.length;
    O.airConsumption = O.regenCyclesPerHour * C.bagsPerSection * C.pulseVolume;

    // ── 14. МАССОВЫЙ БАЛАНС ФТОРА ВО ВТОРИЧНОМ (ФТОРИРОВАННОМ) ГЛИНОЗЁМЕ ──
    // Уловленный фтор накапливается в активной зоне циркуляции и выводится с потоком глинозёма в электролиз.
    // Кратность рециркуляции ускоряет массообмен и гомогенизацию F% в партии.
    const fCapturedKgH = hfGen * effTotal * (19 / 20);
    const outFlowKgH = I.freshFeed * 1000;
    const dtH = (C.simTimeFactor * 0.1) / 3600;
    if (I.freshFeed > 0.05 || I.recircFeed > 0.5) {
        const mixingBoost = 0.75 + 0.25 * clamp(recircRatio / 4.0, 0, 1.4);
        const dF = ((fCapturedKgH * mixingBoost - (P.fContentAccum / 100) * outFlowKgH) / (C.circulatingInventory * 1000)) * 100 * dtH;
        P.fContentAccum = clamp(P.fContentAccum + dF, 0.05, C.maxFContent);
    }
    O.fContent = P.fContentAccum;

    // ── 15. ФОРМИРОВАНИЕ СТАТУСА И ТЕХНОЛОГИЧЕСКИХ АЛАРМОВ ──
    const bits = [];
    if (O.avgFilterDP > I.regenSP * 1.45) {
        bits.push('КРИТИЧ. ΔP');
        state.alarms.push(`⚠ КРИТИЧЕСКОЕ ΔP фильтра: ${O.avgFilterDP.toFixed(2)} кПа`);
    } else if (O.avgFilterDP > I.regenSP * 1.15) {
        bits.push('ВЫСОКИЙ ΔP');
    }
    if (I.tornBags > 0) bits.push(`ПОРЫВ: ${I.tornBags} рук.`);
    if (O.hfOut > 0.5) {
        bits.push('ПРОСКОК HF');
        if (P.tickCount % 10 === 0) {
            state.alarms.push(`⚠ ПРОСКОК HF в трубу: ${O.hfOut.toFixed(2)} мг/нм³ (ПДК 0.50)`);
        }
    }
    const fugitivePipes = O.pipeFlows.filter(p => p.fugitive).map(p => p.id);
    if (fugitivePipes.length > 0) {
        bits.push(`ВЫБИВАНИЕ: ${fugitivePipes.join(',')}`);
        if (P.tickCount % 10 === 0) {
            state.alarms.push(`⚠ ВЫБИВАНИЕ газа в корпус (труба ${fugitivePipes.join(', ')}): разрежение < 50 Па`);
        }
    }
    if (O.fanAmps > C.fanMaxAmps) {
        bits.push('ПЕРЕГРУЗКА ДВИГАТЕЛЯ');
        state.alarms.push(`⚠ ПЕРЕГРУЗКА двигателя дымососа: ${Math.round(O.fanAmps)} А > ${C.fanMaxAmps} А`);
    }
    if (n === 0) bits.push('ДЫМОСОС СТОП');
    if (T > 150) {
        bits.push('ПЕРЕГРЕВ');
        if (P.tickCount % 10 === 0) {
            state.alarms.push(`🔥 ПЕРЕГРЕВ газового тракта: T=${T.toFixed(0)}°C`);
        }
    }
    if (O.dewPointMargin < 15) {
        bits.push('КОНДЕНСАЦИЯ');
    }
    if (alpha < 0.20) bits.push('НА ПРИКРЫТ');
    if (P.receiverPressure < 0.38) {
        bits.push('НИЗКОЕ ДАВЛ. ВОЗДУХА');
        if (P.tickCount % 15 === 0) {
            state.alarms.push(`⚠ Просадка давления сжатого воздуха: ${P.receiverPressure.toFixed(2)} МПа`);
        }
    }
    O.status = bits.length > 0 ? bits.join(' | ') : 'НОРМА';

    // Вращение колеса дымососа
    P.fanAngle += n * Math.max(0.15, alpha) * 0.4;

    // ── 16. ПРЕДИКТИВНАЯ ДИАГНОСТИКА (APM ADVISOR) И АВТОПИЛОТ ──
    runAPM(state);

    if (state.idealMode) {
        autopilotStep(state);
    }
}

function secRegenHalf(sec) {
    return Math.floor((sec.regenTimerMax || 15) * 0.5);
}

/**
 * Возвращает накопленные пиковые значения пыли и HF за интервал между вызовами UI (1 Гц)
 * и сбрасывает пиковый детектор к текущим мгновенным значениям.
 */
export function consumePeakMetrics() {
    const P = state.phys;
    const O = state.out;
    const res = {
        dustOut: Math.max(O.dustOut, P.peakDustOut),
        hfOut:   Math.max(O.hfOut, P.peakHfOut),
    };
    P.peakDustOut = O.dustOut;
    P.peakHfOut = O.hfOut;
    return res;
}

// ── Управляющие функции (вызываются из UI) ──

export function forcePulseAll() {
    state.sections.forEach((s, idx) => {
        s.isRegen = true;
        s.regenTimerMax = 18;
        s.regenTimer = 18;
        state.phys.regenCycles.push(state.phys.tickCount - idx);
    });
    state.phys.receiverPressure = Math.max(0.15, state.phys.receiverPressure - config.airPressureDrop * config.numSections * 1.4);
    state.alarms.push('⚠ ЗАЛПОВАЯ ПРОДУВКА всех 4 секций: просадка воздуха и сброс сорбционного пирога!');
}

export function addTornBag() {
    state.inputs.tornBags++;
    const secIdx = (state.inputs.tornBags - 1) % config.numSections;
    state.alarms.push(`💥 ПРОРЫВ рукава в Секции С${secIdx + 1}! Всего повреждено: ${state.inputs.tornBags} шт.`);
}

export function setIdealMode(on) {
    advisorSetIdealMode(state, on);
}

export function autoTune(changedParam) {
    advisorAutoTune(state, changedParam);
}

export function triggerScenario(name) {
    advisorTriggerScenario(state, name);
}

export function applyRecommendation(recId) {
    advisorApplyRec(state, recId);
}

export function runPredictiveDiagnostics() {
    runAPM(state);
}
