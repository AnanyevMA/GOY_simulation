// ═══════════════════════════════════════════════════════════════════════
//  ANTIGRAVITY СГОУ — ЭКОНОМИЧЕСКИЙ МОДУЛЬ (v8.0)
//  Рассчитывает стоимость электроэнергии, потери фтористых солей (AlF₃)
//  и экологические штрафы за превышение ПДК по HF и пыли в реальном времени.
// ═══════════════════════════════════════════════════════════════════════

const tariffs = {
    electricityRate: 3.50,    // ₽/кВт·ч
    alf3Price:       800,     // ₽/кг эквивалента AlF₃
    hfPenaltyRate:   5000,    // ₽/ч базовый штраф при превышении ПДК по HF
    dustPenaltyRate: 3500,    // ₽/ч базовый штраф при превышении ПДК по пыли
    hfPDK:           0.5,     // мг/нм³ — ПДК по фтористому водороду
    dustPDK:         5.0,     // мг/нм³ — ПДК по неорганической пыли
    shiftHours:      8,       // часов в смене
};

const counters = {
    energyKWH:       0,       // Накопленные кВт·ч
    fluorLossRub:    0,       // Накопленные потери фтора (₽)
    penaltyRub:      0,       // Накопленные экологические штрафы (₽)
    ticksSinceReset: 0,
};

/**
 * Рассчитывает экономические показатели и интегрирует счётчики за интервал вызова
 * @param {object} out — state.out из model.js
 * @param {number} simHours — прошедшее МОДЕЛЬНОЕ время с прошлого вызова, ч
 * @returns {object} — экономические показатели
 */
export function calcEconomics(out, simHours = 1 / 60) {
    const tickHours = simHours;
    counters.ticksSinceReset++;

    // 1. Электроэнергия дымососа
    const powerKW = out.fanPowerKW || 0;
    const energyThisTick = powerKW * tickHours;
    counters.energyKWH += energyThisTick;

    const energyCostPerHour = powerKW * tariffs.electricityRate;
    const energyCostShift = counters.energyKWH * tariffs.electricityRate;

    // 2. Потери фтора (неуловленный HF → недополученный AlF₃ для электролиза)
    const hfLostKgH = (out.hfGenKgH || 0) * Math.max(0, 1 - (out.effHF || 0) / 100);
    // Стехиометрия: 3 HF (60 г/моль) → 1 AlF₃ (84 г/моль), коэфф. 84/60 = 1.4 кг AlF₃ на 1 кг HF
    const alf3LostKgH = hfLostKgH * 1.4;
    const fluorLossCostH = alf3LostKgH * tariffs.alf3Price;
    counters.fluorLossRub += fluorLossCostH * tickHours;

    // 3. Экологические штрафы (прогрессивные при превышении ПДК по HF или пыли)
    let penaltyCostH = 0;
    const hfVal = out.peakHfDisplay || out.hfOut || 0;
    const dustVal = out.peakDustDisplay || out.dustOut || 0;

    if (hfVal > tariffs.hfPDK) {
        const excessRatio = Math.min(5, hfVal / tariffs.hfPDK);
        penaltyCostH += tariffs.hfPenaltyRate * excessRatio;
    }
    if (dustVal > tariffs.dustPDK) {
        const excessDust = Math.min(4, dustVal / tariffs.dustPDK);
        penaltyCostH += tariffs.dustPenaltyRate * excessDust;
    }
    counters.penaltyRub += penaltyCostH * tickHours;

    return {
        powerKW:           Math.round(powerKW),
        energyCostPerHour: energyCostPerHour.toFixed(0),
        energyKWH:         counters.energyKWH.toFixed(1),
        energyCostShift:   energyCostShift.toFixed(0),
        fluorLossCostH:    fluorLossCostH.toFixed(0),
        fluorLossTotal:    counters.fluorLossRub.toFixed(0),
        penaltyCostH:      penaltyCostH.toFixed(0),
        penaltyTotal:      counters.penaltyRub.toFixed(0),
        isPenalty:         penaltyCostH > 0,
    };
}

/** Сброс накопительных счётчиков (начало новой смены) */
export function resetCounters() {
    counters.energyKWH = 0;
    counters.fluorLossRub = 0;
    counters.penaltyRub = 0;
    counters.ticksSinceReset = 0;
}

export { tariffs };
