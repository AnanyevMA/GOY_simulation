// ═══════════════════════════════════════════════════════════════════════
//  ANTIGRAVITY СГОУ — ЭКОНОМИЧЕСКИЙ МОДУЛЬ (v8.1)
//  Рассчитывает стоимость электроэнергии, потери фтористых солей (AlF₃)
//  и экологические штрафы за превышение ПДК по HF и пыли в реальном времени.
//
//  v8.1: интегрирование выполняется ПО КАЖДОМУ ТИКУ ФИЗИКИ (accumulate), а не по
//  таймеру UI — результат больше не зависит от частоты кадров, фоновой вкладки и
//  скорости симуляции. В потери фтора входит неорганизованный выброс в корпус
//  (в т.ч. при остановке дымососа); накопители сбрасываются каждую смену.
// ═══════════════════════════════════════════════════════════════════════

const tariffs = {
    electricityRate:      3.50,    // ₽/кВт·ч
    alf3Price:            800,     // ₽/кг эквивалента AlF₃
    hfPenaltyRate:        5000,    // ₽/ч базовый штраф при превышении ПДК по HF
    dustPenaltyRate:      3500,    // ₽/ч базовый штраф при превышении ПДК по пыли
    fugitivePenaltyRate:  4000,    // ₽/ч базовый штраф за неорганизованный выброс HF в корпус
    fugitiveLimitFrac:    0.05,    // допустимая доля HF, уходящая в корпус (5% от генерации)
    hfPDK:                0.5,     // мг/нм³ — норматив по фтористому водороду
    dustPDK:              5.0,     // мг/нм³ — норматив по неорганической пыли
    shiftHours:           8,       // часов модельного времени в смене
};

const AlF3_PER_HF = 84 / 60;       // 3 HF (60 г/моль) → 1 AlF₃ (84 г/моль): 1.4 кг AlF₃ на 1 кг HF

const counters = {
    energyKWH:       0,       // Накопленные кВт·ч за смену
    fluorLossRub:    0,       // Накопленные потери фтора за смену (₽)
    penaltyRub:      0,       // Накопленные экологические штрафы за смену (₽)
    hoursInShift:    0,       // Модельное время текущей смены (ч)
    shiftsCompleted: 0,       // Сколько смен уже закрыто
};

/** Мгновенные экономические показатели (₽/ч, кВт) по текущему состоянию out. */
function rates(out) {
    const powerKW = out.fanPowerKW || 0;
    const energyCostPerHour = powerKW * tariffs.electricityRate;

    // Потери фтора: проскок в трубу + неорганизованный выброс в корпус (остановка дымососа, слабое разрежение)
    const slipKgH = (out.hfGenKgH || 0) * Math.max(0, 1 - (out.effHF || 0) / 100);
    const fugitiveKgH = out.hfFugitiveKgH || 0;
    const fluorLossCostH = (slipKgH + fugitiveKgH) * AlF3_PER_HF * tariffs.alf3Price;

    // Экологические штрафы (прогрессивные) — по мгновенным концентрациям на трубе (тик физики = 6 с модельного времени)
    let penaltyCostH = 0;
    const hfVal = out.hfOut || 0;
    const dustVal = out.dustOut || 0;
    if (hfVal > tariffs.hfPDK) {
        penaltyCostH += tariffs.hfPenaltyRate * Math.min(5, hfVal / tariffs.hfPDK);
    }
    if (dustVal > tariffs.dustPDK) {
        penaltyCostH += tariffs.dustPenaltyRate * Math.min(4, dustVal / tariffs.dustPDK);
    }
    const totalHf = out.hfTotalGenKgH || 0;
    const fugFrac = totalHf > 0 ? fugitiveKgH / totalHf : 0;
    if (fugFrac > tariffs.fugitiveLimitFrac) {
        penaltyCostH += tariffs.fugitivePenaltyRate * Math.min(5, fugFrac / tariffs.fugitiveLimitFrac);
    }
    return { powerKW, energyCostPerHour, fluorLossCostH, penaltyCostH };
}

/**
 * Интегрирует счётчики за ОДИН тик физики.
 * @param {object} out — state.out из model.js
 * @param {number} dtH — модельное время тика, ч (SIM_DT_H из config.js)
 */
export function accumulate(out, dtH) {
    const r = rates(out);
    counters.energyKWH    += r.powerKW * dtH;
    counters.fluorLossRub += r.fluorLossCostH * dtH;
    counters.penaltyRub   += r.penaltyCostH * dtH;
    counters.hoursInShift += dtH;
    if (counters.hoursInShift >= tariffs.shiftHours) {
        const done = counters.shiftsCompleted + 1;
        resetCounters();
        counters.shiftsCompleted = done;
    }
}

/** Снимок показателей для телеметрии (без интегрирования). */
export function getEconomics(out) {
    const r = rates(out);
    return {
        powerKW:           Math.round(r.powerKW),
        energyCostPerHour: r.energyCostPerHour.toFixed(0),
        energyKWH:         counters.energyKWH.toFixed(1),
        energyCostShift:   (counters.energyKWH * tariffs.electricityRate).toFixed(0),
        fluorLossCostH:    r.fluorLossCostH.toFixed(0),
        fluorLossTotal:    counters.fluorLossRub.toFixed(0),
        penaltyCostH:      r.penaltyCostH.toFixed(0),
        penaltyTotal:      counters.penaltyRub.toFixed(0),
        isPenalty:         r.penaltyCostH > 0,
        shiftHours:        counters.hoursInShift.toFixed(1),
        shiftsCompleted:   counters.shiftsCompleted,
    };
}

/** Сброс накопительных счётчиков (начало новой смены) */
export function resetCounters() {
    counters.energyKWH = 0;
    counters.fluorLossRub = 0;
    counters.penaltyRub = 0;
    counters.hoursInShift = 0;
    counters.shiftsCompleted = 0;
}

export { tariffs, counters };
