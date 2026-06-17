// ═══════════════════════════════════════════════════════════════════════
//  ANTIGRAVITY СГОУ — ЭКОНОМИЧЕСКИЙ МОДУЛЬ
//  Рассчитывает стоимость энергии, потери фтора и штрафы в реальном времени
// ═══════════════════════════════════════════════════════════════════════

// Тарифы (дефолтные, могут быть изменены)
const tariffs = {
    electricityRate: 3.50,    // ₽/кВт·ч
    alf3Price:       800,     // ₽/кг AlF₃
    hfPenaltyRate:   5000,    // ₽/ч при HF > ПДК
    hfPDK:           0.5,     // мг/нм³ — предельно допустимая концентрация
    shiftHours:      8,       // часов в смене
};

// Накопительные счётчики
const counters = {
    energyKWH:     0,         // Накопленные кВт·ч
    fluorLossRub:  0,         // Накопленные потери фтора (₽)
    penaltyRub:    0,         // Накопленные штрафы (₽)
    ticksSinceReset: 0,
};

/**
 * Рассчитывает экономические показатели за один тик (100 мс)
 * @param {object} out — state.out из model.js
 * @returns {object} — экономические показатели
 */
export function calcEconomics(out) {
    const tickHours = 1 / 36000; // 100 мс = 1/36000 часа
    counters.ticksSinceReset++;

    // 1. Электроэнергия
    const powerKW = out.fanPowerKW || 0;
    const energyThisTick = powerKW * tickHours;
    counters.energyKWH += energyThisTick;

    const energyCostPerHour = powerKW * tariffs.electricityRate;
    const energyCostShift = counters.energyKWH * tariffs.electricityRate;

    // 2. Потери фтора (HF не уловлен → потерян AlF₃)
    const hfLostKgH = out.hfGenKgH * (1 - out.effHF / 100);
    const alf3LostKgH = hfLostKgH * (19 / 20); // F из HF → AlF₃
    const fluorLossCostH = alf3LostKgH * tariffs.alf3Price;
    counters.fluorLossRub += fluorLossCostH * tickHours;

    // 3. Экологические штрафы (если HF > ПДК)
    let penaltyCostH = 0;
    if (out.hfOut > tariffs.hfPDK) {
        penaltyCostH = tariffs.hfPenaltyRate;
    }
    counters.penaltyRub += penaltyCostH * tickHours;

    return {
        powerKW:          Math.round(powerKW),
        energyCostPerHour: energyCostPerHour.toFixed(0),
        energyKWH:        counters.energyKWH.toFixed(1),
        energyCostShift:  energyCostShift.toFixed(0),
        fluorLossCostH:   fluorLossCostH.toFixed(0),
        fluorLossTotal:   counters.fluorLossRub.toFixed(0),
        penaltyCostH:     penaltyCostH.toFixed(0),
        penaltyTotal:     counters.penaltyRub.toFixed(0),
        isPenalty:        out.hfOut > tariffs.hfPDK,
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
