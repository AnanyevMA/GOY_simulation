// ═══════════════════════════════════════════════════════════════════════
//  ANTIGRAVITY СГОУ — ФИЗИЧЕСКИЙ ДВИЖОК v4.0
//  Калиброван по НДТ (350 000 нм³/ч, HF 25 мг/нм³, Al₂O₃ 5–7.5 т/ч)
//  Включает: НА дымососа, двухступенчатую адсорбцию, тепловую инерцию,
//  сопротивление газоходов, расход сжатого воздуха, секционную регенерацию.
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

    // Газоходы (Дарси-Вейсбах)
    ductLength:      200,        // Длина газоходов (м)
    ductDiameter:    3.2,        // Эквивалентный диаметр (м)
    ductFriction:    0.02,       // Коэфф. трения λ
    reactorDP:       0.15,       // ΔP реактора (кПа, const)

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
        inletDraft:  -150,    // Разрежение газохода (Па)
        freshFeed:   5.0,     // Свежий Al₂O₃ (т/ч)
        recircFeed:  20,      // Рецирк. AlF₃ (т/ч)
        regenSP:     1.2,     // Уставка авто-продувки (кПа)
        tornBags:    0,       // Порвано рукавов
        pipes: [
            { id: '1A', damper: 100 },
            { id: '1B', damper: 100 },
            { id: '2A', damper: 100 },
            { id: '2B', damper: 100 },
        ]
    },

    // Секции фильтра (4 шт)
    sections: [
        { dp: 0.55, cakeMass: 5,   isRegen: false, regenTimer: 0 },
        { dp: 0.60, cakeMass: 6,   isRegen: false, regenTimer: 0 },
        { dp: 0.50, cakeMass: 4,   isRegen: false, regenTimer: 0 },
        { dp: 0.58, cakeMass: 5.5, isRegen: false, regenTimer: 0 },
    ],

    // Внутреннее состояние физики
    phys: {
        fanAngle:       0,
        regenCooldown:  0,
        fContentAccum:  0.3,
        actualTemp:     110,     // Фактическая T° газа (с инерцией)
        receiverPressure: 0.60,  // Давление в ресивере (МПа)
        tickCount:      0,
    },

    // Выходные параметры (рассчитываются каждый тик)
    out: {
        gasFlow:      0,      // Факт. расход (м³/ч при раб. T°)
        normalFlow:   0,      // Нормальный расход (нм³/ч при 0°C)
        gasVelocity:  0,      // Скорость в газоходе (м/с)
        fanAmps:      0,      // Ток дымососа (А)
        fanPowerKW:   0,      // Мощность дымососа (кВт)
        avgFilterDP:  0,      // ΔP фильтра (кПа)
        ductDP:       0,      // ΔP газоходов (кПа)
        totalDP:      0,      // Общее ΔP тракта (кПа)
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
    // ρ_gas ≈ 1.29 × 273/(T+273) кг/м³
    const rhoGas = 1.29 * 273 / (T + 273);
    // v пока берём из прошлого тика (итеративно)
    const vPrev = O.gasVelocity || 8;
    O.ductDP = C.ductFriction * (C.ductLength / C.ductDiameter) * (rhoGas * vPrev * vPrev / 2) / 1000;

    // ── 4. ОБЩЕЕ ΔP ТРАКТА ──
    O.totalDP = O.avgFilterDP + O.ductDP + C.reactorDP;

    // ── 5. ДЫМОСОС + НАПРАВЛЯЮЩИЙ АППАРАТ ──
    // Законы подобия:  Q ∝ n·α,  ΔP_fan ∝ n²·α^1.5,  N ∝ n³·α^2.5
    const n = I.fanRPM / 100;
    const alpha = I.guideVane / 100;

    const fanQmax = C.nominalFlow * n * alpha;
    const fanPmax = C.maxFanPressure * n * n * Math.pow(alpha, 1.5);

    // Температурный фактор (Гей-Люссак)
    const tempFactor = (T + 273) / 273;

    // Рабочая точка: квадратичная характеристика сети
    const pRatio = fanPmax > 0 ? O.totalDP / fanPmax : 1;
    const flowFrac = pRatio < 1 ? Math.sqrt(1 - pRatio) : 0;

    O.gasFlow = fanQmax * flowFrac * tempFactor;
    if (n <= 0) O.gasFlow = 0;
    O.normalFlow = O.gasFlow / tempFactor;
    O.gasVelocity = (O.gasFlow / 3600) / C.ductArea;

    // ── 6. ТОК И МОЩНОСТЬ ДЫМОСОСА ──
    // N ∝ n³ × α^2.5 + нагрузка ΔP
    O.fanAmps = C.fanMaxAmps * n * n * n * Math.pow(alpha, 2.5) + O.totalDP * 20;
    if (n <= 0) O.fanAmps = 0;
    // P = U × I × √3 × cosφ / 1000 (кВт)
    O.fanPowerKW = C.fanVoltage * O.fanAmps * 1.732 * C.fanCosF;

    // ── 7. ПОТОКИ ПО 4 ТРУБАМ ──
    const netDraft = fanPmax > O.totalDP ? (fanPmax - O.totalDP) : 0;
    O.pipeFlows.forEach((pf, i) => {
        const damper = I.pipes[i].damper / 100;
        const pipeDraft = netDraft * damper * 1000; // кПа → Па
        pf.draft = -pipeDraft;
        pf.flow = O.normalFlow * damper / 4;
        pf.fugitive = pipeDraft < 50; // < 50 Па → выбивание
        pf.id = I.pipes[i].id;
    });

    // ── 8. ГЕНЕРАЦИЯ ЗАГРЯЗНИТЕЛЕЙ ──
    const hfGen = C.hfGenFactor * C.potroomCurrent;   // кг/ч
    const dustGen = C.dustGenFactor * C.potroomCurrent; // кг/ч
    O.hfGenKgH = hfGen;
    O.hfIn = O.normalFlow > 0 ? (hfGen * 1e6) / O.normalFlow : 0;

    // ── 9. ДВУХСТУПЕНЧАТАЯ АДСОРБЦИЯ HF ──

    // Температурный штраф: >120°C → экспоненциальное падение
    let tempPenalty = 1.0;
    if (T > 120) tempPenalty = Math.exp(-0.012 * (T - 120));

    // Влажность: улучшает адсорбцию (+20% при 20%)
    const humBonus = 1.0 + (I.gasHumidity / 100) * 0.2;

    // Контактное время: оптимум 3–6 м/с, >10 м/с — падение
    let contactF = 1.0;
    if (O.gasVelocity > 0) contactF = Math.min(1.0, 4.0 / Math.max(1, O.gasVelocity));

    // η₁ — Реактор (свежий + рецирк × 0.4)
    const effAlumina = I.freshFeed * 1.0 + I.recircFeed * C.recircEfficiency;
    const rRatio = hfGen > 0 ? effAlumina / hfGen : 0;
    let eta1 = C.maxReactorEff * (1 - Math.exp(-C.reactorK * rRatio)) * tempPenalty * contactF * humBonus;
    eta1 = Math.max(0, Math.min(C.maxReactorEff, eta1));

    // η₂ — Пирог на рукавах (filsorption)
    const avgCake = state.sections.reduce((a, s) => a + s.cakeMass, 0) / C.numSections;
    const cRatio = avgCake / 30;
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

    // ── 11. НАКОПЛЕНИЕ ПИРОГА НА СЕКЦИЯХ ──
    const mps = O.gasFlow > 0 ? totalMassIn / C.numSections : 0;
    let airUsedThisTick = 0;

    state.sections.forEach((sec, i) => {
        if (sec.isRegen) {
            // Регенерация: сброс пирога
            const airOk = P.receiverPressure > 0.3; // Мин. давление для продувки
            if (airOk) {
                sec.cakeMass *= 0.75;
                sec.dp -= 0.03;
            }
            sec.regenTimer--;
            if (sec.regenTimer <= 0 || sec.dp <= C.baseDP + 0.05) {
                sec.isRegen = false;
                sec.dp = Math.max(C.baseDP, sec.dp);
                if (sec.cakeMass < 1) sec.cakeMass = 1;
            }
        } else if (O.gasFlow > 0) {
            sec.cakeMass += mps * 0.00004;
            let cDP = (sec.cakeMass * sec.cakeMass) * 0.0003;
            const tInSec = Math.min(I.tornBags, C.bagsPerSection) / C.bagsPerSection;
            cDP *= (1 - tInSec * 0.4);
            sec.dp = C.baseDP + cDP * (1 + I.gasHumidity * 0.01);
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
            state.sections[worstIdx].isRegen = true;
            state.sections[worstIdx].regenTimer = 15;
            P.regenCooldown = 45;

            // Расход сжатого воздуха
            const airVol = C.bagsPerSection * C.pulseVolume; // нм³ за продувку секции
            airUsedThisTick += airVol;
            P.receiverPressure -= C.airPressureDrop;

            state.alarms.push(`↻ Авто-продувка: Секция ${worstIdx + 1} (ΔP=${worstDP.toFixed(2)} кПа)`);
        }
    }

    // ── 13. СЖАТЫЙ ВОЗДУХ ──
    // Восстановление давления компрессором
    P.receiverPressure += C.airRecoveryRate;
    P.receiverPressure = Math.min(C.airPressureNom, Math.max(0, P.receiverPressure));
    O.receiverP = P.receiverPressure;
    O.airConsumption = airUsedThisTick * 10 * 60; // нм³/тик → нм³/ч (10 тиков/сек × 60 сек)

    // ── 14. СОДЕРЖАНИЕ F В ГЛИНОЗЁМЕ ──
    const hfCaptured = hfGen * effTotal;
    const fCaptured = hfCaptured * (19 / 20);
    const totAlumina = (I.freshFeed + I.recircFeed) * 1000;
    if (totAlumina > 0) {
        const instantF = (fCaptured / totAlumina) * 100;
        P.fContentAccum += (instantF - P.fContentAccum) * 0.001;
        O.fContent = Math.min(C.maxFContent, P.fContentAccum + instantF * 0.5);
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
    if (I.inletDraft > -50) bits.push('ВЫБИВАНИЕ');
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
//  При изменении любого ползунка пересчитывает остальные параметры
//  для достижения оптимального режима работы.
// ══════════════════════════════════════════════════════════════════════

// Оптимальные базовые значения
const IDEAL = {
    fanRPM:     100,      // Постоянная скорость
    guideVane:  78,       // Оптимум НА для баланса расход/энергия
    gasTempSP:  105,      // Оптимум для адсорбции
    gasHumidity: 5,       // Умеренная влажность
    inletDraft: -150,     // Достаточное разрежение
    freshFeed:  5.5,      // т/ч свежего Al₂O₃
    recircFeed: 22,       // т/ч рецирк (4:1 к свежему)
    regenSP:    1.2,      // кПа — баланс filsorption/ΔP
    pipesDamper: 100,     // Все шиберы открыты
};

/**
 * autoTune() — вызывается каждый тик в идеальном режиме.
 * Принимает текущие inputs как «ограничения» (то, что пользователь
 * изменил вручную) и пересчитывает остальные для оптимума.
 *
 * Логика оптимизации:
 * 1. Температура → компенсация через НА (больше T = больше объём → открыть НА)
 * 2. Глинозём → баланс fresh:recirc = 1:4, с учётом HF генерации
 * 3. НА → компенсация через подачу глинозёма (меньше поток → меньше нужно Al₂O₃)
 * 4. Шиберы → если закрыты → увеличить НА для компенсации
 * 5. Порванные рукава → увеличить подачу глинозёма для компенсации η₂
 * 6. Уставка ΔP → подстроить под текущую нагрузку
 */
export function autoTune(changedParam) {
    const I = state.inputs;
    const C = config;

    // ── 1. Среднее открытие шиберов ──
    const avgDamper = I.pipes.reduce((a, p) => a + p.damper, 0) / 4 / 100;

    // ── 2. Температурная компенсация НА ──
    // При T > 105°C объём газа растёт → нужно больше открыть НА
    // При T < 105°C → можно прикрыть
    const tempRatio = (I.gasTempSP + 273) / (IDEAL.gasTempSP + 273);

    // ── 3. Компенсация закрытых шиберов через НА ──
    // Если шиберы прикрыты, нужно больше тяги чтобы сохранить разрежение
    const damperCompensation = avgDamper > 0.5 ? 1.0 : (1.0 + (1.0 - avgDamper) * 0.4);

    // ── Расчёт оптимальных значений ──

    if (changedParam !== 'guideVane') {
        // НА: базовый оптимум × температурная коррекция × компенсация шиберов
        I.guideVane = Math.round(
            clamp(IDEAL.guideVane * tempRatio * damperCompensation, 20, 100)
        );
    }

    if (changedParam !== 'fanRPM') {
        I.fanRPM = IDEAL.fanRPM; // Всегда 100% (синхронный двигатель)
    }

    // Генерация HF при текущем токе серии
    const hfGen = C.hfGenFactor * C.potroomCurrent; // кг/ч

    // Эффективный расход через НА
    const flowFraction = I.guideVane / 100;

    if (changedParam !== 'freshFeed') {
        // Свежий глинозём: пропорционален расходу газа и генерации HF
        // Больше расход = лучше контакт = можно меньше глинозёма
        // Меньше расход = хуже контакт = нужно больше
        const contactQuality = flowFraction > 0.5 ? 1.0 : (1.0 + (0.5 - flowFraction) * 0.8);
        // Компенсация порванных рукавов: +5% глинозёма на каждые 10 рукавов
        const tornCompensation = 1.0 + (I.tornBags / 200);
        I.freshFeed = parseFloat(
            clamp(IDEAL.freshFeed * contactQuality * tornCompensation, 2.0, 10.0).toFixed(1)
        );
    }

    if (changedParam !== 'recircFeed') {
        // Рециркуляция: оптимальное соотношение fresh:recirc = 1:4
        I.recircFeed = parseFloat(
            clamp(I.freshFeed * 4, 5, 40).toFixed(1)
        );
    }

    if (changedParam !== 'gasTempSP') {
        // Температура: не меняем (это внешний фактор), но если идеальный старт:
        if (!changedParam) I.gasTempSP = IDEAL.gasTempSP;
    }

    if (changedParam !== 'gasHumidity') {
        I.gasHumidity = IDEAL.gasHumidity;
    }

    if (changedParam !== 'inletDraft') {
        // Разрежение: должно быть достаточным для текущего НА
        // Больше НА → больше тяга → более отрицательное разрежение
        I.inletDraft = Math.round(clamp(-50 - flowFraction * 150, -400, -50));
    }

    if (changedParam !== 'regenSP') {
        // Уставка: при большей подаче глинозёма пирог растёт быстрее → можно снизить уставку
        // При малой подаче → поднять уставку (дольше копить пирог для filsorption)
        const feedRatio = (I.freshFeed + I.recircFeed * C.recircEfficiency) /
                          (IDEAL.freshFeed + IDEAL.recircFeed * C.recircEfficiency);
        I.regenSP = parseFloat(
            clamp(IDEAL.regenSP / Math.sqrt(feedRatio), 0.8, 1.8).toFixed(2)
        );
    }

    // Шиберы: в идеале все открыты, но не трогаем если пользователь изменил конкретный
    if (!changedParam || changedParam === 'idealReset') {
        I.pipes.forEach(p => p.damper = IDEAL.pipesDamper);
        I.tornBags = 0;
    }
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

/**
 * Включить/выключить идеальный режим
 */
export function setIdealMode(on) {
    state.idealMode = on;
    if (on) {
        autoTune(null); // Первичная настройка всех параметров
        state.alarms.push('✨ Режим «ИДЕАЛЬНАЯ ГОУ» включён');
    } else {
        state.alarms.push('⏹ Режим «ИДЕАЛЬНАЯ ГОУ» выключен');
    }
}
