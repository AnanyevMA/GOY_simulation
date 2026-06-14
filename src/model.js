// --- Process-Simulation-Agent (Backend-in-JS) ---
// Математическая модель процессов

const config = {
    hfEmissionFactor: 0.01, // кг HF на кА тока в час
    dustEmissionFactor: 0.02, // кг пыли на кА тока в час
    
    sectionsCount: 4,
    bagsPerSection: 200,
    dustLoadFactor: 0.0005, // Рост сопротивления (Па) от ед. массы пирога
    baseDeltaP: 800, // Базовое сопротивление чистого фильтра (Па)
    maxDeltaP: 1400, // Максимальное рабочее сопротивление (Па)
    regenDropRate: 80, // Падение сопротивления за тик во время регенерации
    
    maxAdsorptionEfficiency: 0.998,
    aluminaFactor: 0.8, 
};

const state = {
    // Входные параметры (из UI)
    potroomCurrent: 300, // кА
    fanSpeed: 80, // Тяга дымососа (%)
    aluminaFeedRate: 15.0, // т/ч (Свежий глинозем)
    aluminaRecircRate: 30.0, // т/ч (Рециркулированный глинозем)
    
    // Смоделированные потоки на входе (4 трубы)
    inletPipes: [
        { id: '1A', damper: 100, gasFlow: 125, hfFlow: 0, dustFlow: 0, isFugitive: false },
        { id: '1B', damper: 100, gasFlow: 125, hfFlow: 0, dustFlow: 0, isFugitive: false },
        { id: '2A', damper: 100, gasFlow: 125, hfFlow: 0, dustFlow: 0, isFugitive: false },
        { id: '2B', damper: 100, gasFlow: 125, hfFlow: 0, dustFlow: 0, isFugitive: false }
    ],

    globalDraft: 0, // Разрежение сети (Па)

    totalGeneratedHF: 0, // Сгенерировано электролизерами
    totalFugitiveHF: 0,  // Упущено (выбивание)
    totalInletHF: 0,     // Попало в ГОУ
    totalInletDust: 0,
    
    cleaningEfficiency: 100, // Эффективность очистки фтора (самой ГОУ)
    overallEfficiency: 100,  // Эффективность работы ГОУ (с учетом выбивания)
    
    // Состояние реактора
    adsorptionEfficiency: 0.95,
    reactorHF: 0,
    reactorDust: 0, // Пыль + уловленный глинозем

    // Состояние фильтров (4 секции)
    filterSections: [
        { id: 'M1-S1', deltaP: 1000, cakeMass: 0, isRegenerating: false, regenTimer: 0, tornBags: 0 },
        { id: 'M1-S2', deltaP: 1100, cakeMass: 0, isRegenerating: false, regenTimer: 0, tornBags: 0 },
        { id: 'M2-S1', deltaP: 900, cakeMass: 0,  isRegenerating: false, regenTimer: 0, tornBags: 0 },
        { id: 'M2-S2', deltaP: 1050, cakeMass: 0, isRegenerating: false, regenTimer: 0, tornBags: 0 }
    ],

    // Выходные параметры
    outletHF: 0.5,
    outletDust: 1.0,
    globalDeltaP: 1000,

    // Аварии
    failures: {
        screwClogged: false,
        fanFailed: false,
        airPressureDrop: false,
        tornBags: false,
        tornBagsCount: 0
    },

    regen: {
        mode: 'dp', 
        startDp: 1400,
        stopDp: 800,
        interval: 60, 
        timerCount: 0,
        currentRegenSectionIndex: 0 
    }
};

function simulationTick() {
    // 0. Определение базового сопротивления и максимальной тяги
    let avgDeltaP = state.filterSections.reduce((acc, s) => acc + s.deltaP, 0) / config.sectionsCount;
    state.globalDeltaP = avgDeltaP;

    let maxDraft = (state.fanSpeed / 100) * 3500; 
    if (state.failures.fanFailed) maxDraft = 0;
    
    let netDraft = maxDraft - state.globalDeltaP;
    if (netDraft < 0) netDraft = 0;
    state.globalDraft = -netDraft;

    // 1. Расчет потоков по 4 трубам
    let currentGasVolume = 0;
    let totalGeneratedHF = state.potroomCurrent * config.hfEmissionFactor;
    let generatedHFPerPipe = totalGeneratedHF / 4;
    let generatedDustPerPipe = (state.potroomCurrent * config.dustEmissionFactor) / 4;

    let totalInletHF = 0;
    let totalInletDust = 0;
    let totalFugitiveHF = 0;

    for (let i = 0; i < 4; i++) {
        let pipe = state.inletPipes[i];
        let pipeDraft = netDraft * (pipe.damper / 100);
        let pipeVelocity = pipeDraft > 0 ? (pipeDraft / 3500) * 8 : 0;
        
        if (pipeVelocity < 1.2) {
            pipe.isFugitive = true;
            pipe.gasFlow = (pipeVelocity / 8) * (500 / 4); 
            let captureRatio = Math.max(0, pipeVelocity / 1.2);
            pipe.hfFlow = generatedHFPerPipe * captureRatio;
            pipe.dustFlow = generatedDustPerPipe * captureRatio;
            totalFugitiveHF += generatedHFPerPipe * (1 - captureRatio);
        } else {
            pipe.isFugitive = false;
            pipe.gasFlow = (pipeVelocity / 8) * (500 / 4);
            pipe.hfFlow = generatedHFPerPipe;
            pipe.dustFlow = generatedDustPerPipe;
        }

        currentGasVolume += pipe.gasFlow;
        totalInletHF += pipe.hfFlow;
        totalInletDust += pipe.dustFlow;
    }

    state.totalGeneratedHF = totalGeneratedHF;
    state.totalFugitiveHF = totalFugitiveHF;
    state.totalInletHF = totalInletHF;
    state.totalInletDust = totalInletDust;

    // 2. Адсорбция в реакторе
    let currentAluminaFeed = state.failures.screwClogged ? 0 : state.aluminaFeedRate;
    let currentRecircFeed = state.aluminaRecircRate;
    let effectiveAlumina = currentAluminaFeed + (currentRecircFeed * 0.6);

    if (totalInletHF > 0 && currentGasVolume > 0) {
        let ratio = effectiveAlumina / totalInletHF;
        let gasVelocityAvg = (currentGasVolume / 500) * 8; 
        if (gasVelocityAvg <= 0) gasVelocityAvg = 0.1;

        let eff = 1 - Math.exp(-0.3 * ratio / gasVelocityAvg);
        state.adsorptionEfficiency = Math.min(config.maxAdsorptionEfficiency, Math.max(0, eff));
    } else {
        state.adsorptionEfficiency = 0;
    }

    state.reactorHF = totalInletHF * (1 - state.adsorptionEfficiency);
    
    // Масса пирога: если газ не идет (нет тяги), глинозем не может лететь вверх в фильтры.
    // Он просто падает в реакторе/бункере.
    let addedMassToFilters = 0;
    if (currentGasVolume > 0) {
        addedMassToFilters = (totalInletDust + (currentAluminaFeed + currentRecircFeed) * 1000); 
    }
    state.reactorDust = addedMassToFilters;

    // 3. Рукавные фильтры
    let massPerSection = addedMassToFilters / config.sectionsCount;
    let totalOutletHF = state.reactorHF; 
    let totalOutletDust = 0;
    let tornBagsPerSection = Math.floor(state.failures.tornBagsCount / config.sectionsCount);

    state.filterSections.forEach((section, index) => {
        section.tornBags = state.failures.tornBags ? tornBagsPerSection : 0;
        
        let sectionFiltrationEfficiency = 0.999 - (section.tornBags / config.bagsPerSection) * 0.5; 
        if (sectionFiltrationEfficiency < 0) sectionFiltrationEfficiency = 0;

        totalOutletDust += massPerSection * (1 - sectionFiltrationEfficiency);

        // Накопление массы пирога (кг) за 1 тик (предположим 1 тик = 1 минуте или ускоренное время)
        // Для симуляции делим на 60, чтобы не росло моментально
        section.cakeMass += massPerSection / 60; 

        if (section.isRegenerating) {
            if (!state.failures.airPressureDrop) {
                section.cakeMass *= 0.8; // Сбрасываем 20% массы пирога за тик регенерации
                section.deltaP -= config.regenDropRate;
            }
            if (section.deltaP <= state.regen.stopDp || section.cakeMass <= 10) {
                section.deltaP = Math.max(state.regen.stopDp, config.baseDeltaP);
                section.isRegenerating = false;
            }
        } else {
            if (currentGasVolume > 0) {
                let dPIncrease = (massPerSection / 60) * config.dustLoadFactor;
                if (section.tornBags > 0) dPIncrease -= (section.tornBags * 0.5);
                section.deltaP += Math.max(0.1, dPIncrease); 
            }
        }

        if (!state.failures.airPressureDrop) {
            if (state.regen.mode === 'dp') {
                if (section.deltaP >= state.regen.startDp && !section.isRegenerating) {
                    section.isRegenerating = true;
                }
            } else if (state.regen.mode === 'timer') {
                if (state.regen.timerCount >= state.regen.interval) {
                    if (index === state.regen.currentRegenSectionIndex) {
                        section.isRegenerating = true;
                        state.regen.currentRegenSectionIndex = (state.regen.currentRegenSectionIndex + 1) % config.sectionsCount;
                        state.regen.timerCount = 0; 
                    }
                }
            }
        }
    });

    if (state.regen.mode === 'timer' && !state.failures.airPressureDrop) {
        state.regen.timerCount++;
    }

    // Выходные параметры
    if (currentGasVolume === 0) {
        state.outletHF = 0;
        state.outletDust = 0;
    } else {
        state.outletHF = (totalOutletHF / currentGasVolume) * 1000;
        state.outletDust = (totalOutletDust / currentGasVolume) * 1000;
    }

    // Эффективности
    if (totalInletHF > 0) {
        state.cleaningEfficiency = ((totalInletHF - totalOutletHF) / totalInletHF) * 100;
    } else {
        state.cleaningEfficiency = 100;
    }

    if (totalGeneratedHF > 0) {
        state.overallEfficiency = ((totalGeneratedHF - totalFugitiveHF - totalOutletHF) / totalGeneratedHF) * 100;
    } else {
        state.overallEfficiency = 100;
    }
}

// Принудительная регенерация (Manual Pulse)
function forcePulse() {
    state.filterSections.forEach(section => {
        section.isRegenerating = true;
    });
}

window.SGOModel = {
    state,
    config,
    tick: simulationTick,
    forcePulse: forcePulse
};
