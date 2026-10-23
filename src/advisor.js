// ═══════════════════════════════════════════════════════════════════════
//  ANTIGRAVITY СГОУ — ПРЕДИКТИВНАЯ АНАЛИТИКА (APM ADVISOR) И АВТОПИЛОТ (v8.0)
//  Диагностика первопричин (Root Cause Analysis), замкнутый контур
//  регулирования по реальным актуаторам и 6 обучающих сценариев.
// ═══════════════════════════════════════════════════════════════════════

import { config, IDEAL, clamp } from './config.js';

// Параметры, которыми управляет автопилот (если не перехвачены оператором в state.hold)
const AUTOPILOT_PARAMS = [
    'guideVane', 'fanRPM', 'freshFeed', 'recircFeed',
    'gasTempSP', 'gasHumidity', 'inletDraft', 'regenSP', 'dilutionValve'
];

/**
 * Вычисляет целевой нормальный расход от корпусов (нм³/ч) по уставке разрежения inletDraft
 */
export function getTargetFlowForDraft(state) {
    const I = state.inputs;
    const T = state.phys.actualTemp || config.refTemp;
    const sT = (T + 273) / (config.refTemp + 273);
    const targetDraftAbs = Math.max(50, Math.abs(I.inletDraft));
    const refDraftAbs = Math.abs(config.refDraft);
    // P_draft = -150 * sT * (Q_pot / refFlow)^2  =>  Q_pot = refFlow * sqrt(|P_SP| / (150 * sT))
    return config.refFlow * Math.sqrt(targetDraftAbs / (refDraftAbs * sT));
}

/**
 * Сброс в проектный режим при включении «Идеальной ГОУ» или фиксация ручного перехвата
 */
export function autoTune(state, changedParam) {
    const I = state.inputs;
    if (changedParam && changedParam !== 'idealReset') {
        if (AUTOPILOT_PARAMS.includes(changedParam)) {
            state.hold[changedParam] = true;
        }
        return;
    }
    state.hold = {};
    I.fanRPM        = IDEAL.fanRPM;
    I.guideVane     = IDEAL.guideVane;
    I.gasTempSP     = IDEAL.gasTempSP;
    I.gasHumidity   = IDEAL.gasHumidity;
    I.inletDraft    = IDEAL.inletDraft;
    I.dilutionValve = IDEAL.dilutionValve;
    I.freshFeed     = IDEAL.freshFeed;
    I.recircFeed    = IDEAL.recircFeed;
    I.regenSP       = IDEAL.regenSP;
    I.pipes.forEach(p => { p.damper = IDEAL.pipesDamper; });
    I.tornBags      = 0;
}

/**
 * Включение/выключение режима Автопилота («Идеальная ГОУ»)
 */
export function setIdealMode(state, on) {
    state.idealMode = on;
    if (on) {
        autoTune(state, null);
        state.alarms.push('✨ АВТОПИЛОТ СОВЕТЧИКА: ВКЛЮЧЁН (поддержание проектного разрежения, сорбции и защиты от перегрева)');
    } else {
        state.alarms.push('⏹ АВТОПИЛОТ СОВЕТЧИКА: ВЫКЛЮЧЕН (ручное управление оператора)');
    }
}

/**
 * Один шаг Автопилота (вызывается каждый тик при state.idealMode === true).
 * Управляет только реальными исполнительными механизмами без «читов».
 */
export function autopilotStep(state) {
    const I = state.inputs;
    const O = state.out;
    const P = state.phys;
    const C = config;
    const H = state.hold;

    if (!H.fanRPM)      I.fanRPM = IDEAL.fanRPM;
    if (!H.gasTempSP)   I.gasTempSP = IDEAL.gasTempSP;
    if (!H.gasHumidity) I.gasHumidity = IDEAL.gasHumidity;
    if (!H.inletDraft)  I.inletDraft = IDEAL.inletDraft;

    // 1. Клапан подсоса холодного воздуха: открывается при перегреве (>118°C, напр. анодный эффект)
    if (!H.dilutionValve) {
        let targetDil = 0;
        if (P.actualTemp > 118 || P.anodeEffectTimer > 0) {
            targetDil = clamp(Math.round((P.actualTemp - 112) * 2.5), 15, 90);
        }
        I.dilutionValve = Math.round(I.dilutionValve + clamp(targetDil - I.dilutionValve, -4, 6));
    }

    // 2. Направляющий аппарат дымососа: интегральный регулятор по уставке разрежения / целевому расходу от корпусов
    if (!H.guideVane && O.normalFlow > 0) {
        const targetPotFlow = getTargetFlowForDraft(state);
        const actualPotFlow = O.potroomFlow || O.normalFlow;
        const err = (targetPotFlow - actualPotFlow) / C.refFlow;
        const step = clamp(err * 38, -0.6, 0.6);
        I.guideVane = parseFloat(clamp(I.guideVane + step, 15, 100).toFixed(1));
    }

    // 3. Дозирование свежего и рециркулирующего глинозёма
    const load = Math.max(0.6, O.hfGenLoad || 1);
    const tornKick = 1 + I.tornBags * 0.025;
    if (!H.freshFeed) {
        const targetFresh = clamp(IDEAL.freshFeed * load * tornKick, 2.0, 10.0);
        I.freshFeed = parseFloat((I.freshFeed + (targetFresh - I.freshFeed) * 0.15).toFixed(1));
    }
    if (!H.recircFeed) {
        const targetRecirc = clamp(I.freshFeed * 4.0, 6.0, 40.0);
        I.recircFeed = parseFloat((I.recircFeed + (targetRecirc - I.recircFeed) * 0.15).toFixed(1));
    }

    // 4. Уставка регенерации ΔP: держит частоту 45–55 ц/ч и достаточный слой пирога
    if (!H.regenSP) {
        const feedRatio = (I.freshFeed + I.recircFeed * C.recircEfficiency) /
                          (IDEAL.freshFeed + IDEAL.recircFeed * C.recircEfficiency);
        const targetSP = clamp(IDEAL.regenSP * Math.sqrt(Math.max(0.5, feedRatio)), 0.9, 1.8);
        I.regenSP = parseFloat((I.regenSP + (targetSP - I.regenSP) * 0.1).toFixed(2));
    }
}

/**
 * Предиктивная диагностика и формирование карточек рекомендаций (APM v8.0)
 */
export function runPredictiveDiagnostics(state) {
    const I = state.inputs;
    const O = state.out;
    const P = state.phys;
    const adv = state.advisor;

    let score = 100;
    const recs = [];

    // ══════════════════════════════════════════════════════════════════
    //  1. МОДУЛЬ «ФИЛЬТР, РУКАВА И РЕГЕНЕРАЦИЯ»
    // ══════════════════════════════════════════════════════════════════
    let filterStatus = 'ok';
    let filterLabel = 'В НОРМЕ';
    let filterDesc = 'Рукава герметичны, перепад ΔP и регенерация в норме';

    if (I.tornBags > 0) {
        const severity = I.tornBags >= 3 ? 'danger' : 'warn';
        filterStatus = severity;
        filterLabel = I.tornBags >= 5 ? 'АВАРИЯ РУКАВОВ' : `ПОРЫВ (${I.tornBags} шт.)`;
        filterDesc = `Повреждено ${I.tornBags} рук. Фоновая пыль ${O.dustOut.toFixed(1)} мг/нм³, пики при продувке до ${O.peakDustDisplay.toFixed(1)} мг/нм³`;
        score -= Math.min(42, I.tornBags * 8 + 6);

        recs.push({
            id: 'fix_torn_bags',
            module: 'filter',
            type: 'danger',
            title: `Порыв фильтровальных рукавов (${I.tornBags} шт.)`,
            reason: `При импульсной регенерации повреждённых секций фиксируются характерные прострелы пыли (до ${O.peakDustDisplay.toFixed(1)} мг/нм³) и проброс газовой фазы HF в обход пирога. Износ рабочего колеса дымососа ускорен.`,
            actionText: 'Отключить дефектную секцию и заменить рукава',
            effectText: 'Снижение пыли до ≤3.5 мг/нм³, устранение пиков HF при продувке',
            apply: () => {
                I.tornBags = 0;
                P.peakDustOut = 0;
                state.alarms.push('✓ Советчик: повреждённые рукава заменены, герметичность фильтра восстановлена');
            }
        });
    } else if (O.dewPointMargin < 20 || I.gasHumidity > 13) {
        filterStatus = O.dewPointMargin < 12 ? 'danger' : 'warn';
        filterLabel = 'СЫРОЙ ПИРОГ';
        filterDesc = `Запас до точки росы ${O.dewPointMargin.toFixed(0)}°C (Tросы=${O.dewPointTemp.toFixed(0)}°C). Цементация пирога на рукавах!`;
        score -= O.dewPointMargin < 12 ? 25 : 14;

        recs.push({
            id: 'fix_wet_cake',
            module: 'filter',
            type: O.dewPointMargin < 12 ? 'danger' : 'warn',
            title: `Риск конденсации и залипания рукавов (Tросы = ${O.dewPointTemp.toFixed(0)}°C)`,
            reason: `При влажности ${I.gasHumidity}% и T газа ${O.actualTemp.toFixed(0)}°C влага конденсируется в порах глинозёма. Влажный пирог цементируется и плохо сбивается импульсом продувки (растёт остаточный ΔP).`,
            actionText: 'Снизить влажность до 5% и поднять T газа до 105°C',
            effectText: 'Сухой сыпучий пирог, восстановление регенерации и снижение ΔP',
            apply: () => {
                I.gasHumidity = 5;
                if (I.gasTempSP < 105) I.gasTempSP = 105;
                if (I.dilutionValve > 0) I.dilutionValve = 0;
                state.alarms.push('✓ Советчик: температурно-влажностный режим нормализован (устранена конденсация)');
            }
        });
    } else if (P.receiverPressure < 0.42) {
        filterStatus = P.receiverPressure < 0.34 ? 'danger' : 'warn';
        filterLabel = 'ПРОСАДКА ВОЗДУХА';
        filterDesc = `Давление в ресивере ${P.receiverPressure.toFixed(2)} МПа (норма 0.60 МПа). Слабый импульс очистки!`;
        score -= 16;

        const newSP = parseFloat(clamp(I.regenSP + 0.25, 1.2, 1.8).toFixed(2));
        recs.push({
            id: 'fix_air_pressure',
            module: 'filter',
            type: 'warn',
            title: `Просадка давления сжатого воздуха (${P.receiverPressure.toFixed(2)} МПа)`,
            reason: `Частота импульсов (${O.regenCyclesPerHour} ц/ч) превышает производительность компрессора. При давлении <0.40 МПа энергия ударной волны недостаточна для отряхивания рукавов.`,
            actionText: `Поднять уставку ΔP до ${newSP} кПа и восстановить давление`,
            effectText: 'Восстановление ресивера до 0.60 МПа и штатной частоты 45–55 ц/ч',
            apply: () => {
                I.regenSP = newSP;
                P.receiverPressure = config.airPressureNom;
                state.alarms.push(`✓ Советчик: уставка ΔP поднята до ${newSP} кПа, давление воздуха 0.60 МПа`);
            }
        });
    } else if (O.regenCyclesPerHour > 65) {
        filterStatus = 'warn';
        filterLabel = 'ЧАСТАЯ ПРОДУВКА';
        filterDesc = `Частота регенерации ${O.regenCyclesPerHour} ц/ч (норма 45–60 ц/ч). Повышенный износ ткани`;
        score -= 10;

        const optimalRegenSP = parseFloat(Math.min(1.8, I.regenSP + 0.20).toFixed(2));
        recs.push({
            id: 'opt_regen_freq',
            module: 'filter',
            type: 'warn',
            title: `Слишком частая регенерация (${O.regenCyclesPerHour} ц/ч)`,
            reason: `Низкая уставка ΔP (${I.regenSP} кПа) вызывает чрезмерно частые продувки, оголяя рукава (снижается η₂) и ускоряя механический износ ткани.`,
            actionText: `Увеличить уставку ΔP до ${optimalRegenSP} кПа`,
            effectText: 'Стабилизация частоты на 45–55 ц/ч, рост η₂ пирога и ресурса рукавов',
            apply: () => {
                I.regenSP = optimalRegenSP;
                state.alarms.push(`✓ Советчик: уставка ΔP скорректирована до ${optimalRegenSP} кПа`);
            }
        });
    } else if (O.avgFilterDP > 1.65) {
        filterStatus = 'warn';
        filterLabel = 'ВЫСОКИЙ ΔP';
        filterDesc = `Перепад на фильтре ${O.avgFilterDP.toFixed(2)} кПа зажимает тягу дымососа`;
        score -= 12;

        recs.push({
            id: 'lower_regen_sp',
            module: 'filter',
            type: 'warn',
            title: `Высокое гидравлическое сопротивление фильтра (${O.avgFilterDP.toFixed(2)} кПа)`,
            reason: `Завышенная уставка регенерации (${I.regenSP} кПа) приводит к переуплотнению пирога на рукавах и росту энергопотребления дымососа.`,
            actionText: 'Снизить уставку авто-продувки ΔP до 1.20 кПа',
            effectText: 'Снижение ΔP фильтра до ~1.1 кПа, экономия мощности дымососа',
            apply: () => {
                I.regenSP = 1.2;
                state.alarms.push('✓ Советчик: уставка ΔP снижена до проектных 1.20 кПа');
            }
        });
    }

    adv.modules.filter = { status: filterStatus, label: filterLabel, desc: filterDesc };

    // ══════════════════════════════════════════════════════════════════
    //  2. МОДУЛЬ «ГЛИНОЗЁМ, ХЕМОСОРБЦИЯ HF И ФТОР-БАЛАНС»
    // ══════════════════════════════════════════════════════════════════
    let aluminaStatus = 'ok';
    let aluminaLabel = 'В НОРМЕ';
    let aluminaDesc = 'Сорбция HF эффективна, активность пирога и F% оптимальны';

    const targetFlow = getTargetFlowForDraft(state);

    if (O.hfOut > 0.5) {
        const severity = O.hfOut > 1.0 ? 'danger' : 'warn';
        aluminaStatus = severity;
        aluminaLabel = O.hfOut > 1.0 ? 'ПРОСКОК HF' : 'ПРЕВЫШЕНИЕ ПДК';
        aluminaDesc = `HF на выходе ${O.hfOut.toFixed(2)} мг/нм³ (ПДК 0.50 мг/нм³). Активность пирога ${(O.cakeActivity * 100).toFixed(0)}%`;
        score -= Math.min(45, Math.round((O.hfOut - 0.5) * 25 + 18));

        let recHF;
        if (I.freshFeed < 1.5 || O.cakeActivity < 0.75) {
            recHF = {
                id: 'restore_alumina_feed',
                module: 'alumina',
                type: 'danger',
                title: `Отказ/дефицит питания глинозёмом (HF = ${O.hfOut.toFixed(2)} мг/нм³)`,
                reason: `Подача сорбента (${I.freshFeed} т/ч свеж., ${I.recircFeed} т/ч рецирк.) критически мала. Активные центры Al₂O₃ в пироге рукавов истощены (${(O.cakeActivity * 100).toFixed(0)}%), идёт сквозной проскок HF!`,
                actionText: `Восстановить подачу: свежий ${IDEAL.freshFeed} т/ч, рецирк ${IDEAL.recircFeed} т/ч`,
                effectText: 'Восстановление активного слоя пирога и снижение HF ниже 0.40 мг/нм³',
                apply: () => {
                    I.freshFeed = IDEAL.freshFeed;
                    I.recircFeed = IDEAL.recircFeed;
                    P.cakeActivity = 0.96;
                    state.alarms.push(`✓ Советчик: подача глинозёма восстановлена (${IDEAL.freshFeed}/${IDEAL.recircFeed} т/ч)`);
                }
            };
        } else if (O.actualTemp > 118) {
            const needDil = P.anodeEffectTimer > 0 ? 55 : 0;
            recHF = {
                id: 'cool_reactor_gas',
                module: 'alumina',
                type: 'danger',
                title: `Термическая десорбция HF из-за перегрева (${O.actualTemp.toFixed(0)}°C)`,
                reason: `При T > 120°C экзотермическая реакция хемосорбции HF на Al₂O₃ тормозится. HF на выходе вырос до ${O.hfOut.toFixed(2)} мг/нм³.`,
                actionText: needDil > 0
                    ? `Открыть клапан подсоса на ${needDil}% и увеличить подачу Al₂O₃`
                    : 'Снизить температуру газа на входе до 105°C',
                effectText: 'Охлаждение потока в реакторе, возврат HF в пределы ПДК (<0.5 мг/нм³)',
                apply: () => {
                    if (needDil > 0) {
                        I.dilutionValve = needDil;
                        I.freshFeed = Math.max(I.freshFeed, 8.0);
                        I.recircFeed = Math.max(I.recircFeed, 30.0);
                    } else {
                        I.gasTempSP = 105;
                    }
                    state.alarms.push('✓ Советчик: приняты меры охлаждения газового потока перед реактором');
                }
            };
        } else if (O.normalFlow > targetFlow * 1.12) {
            const vaneOpt = Math.round(clamp(I.guideVane + (targetFlow - O.normalFlow) / 3000, 20, 100));
            recHF = {
                id: 'reduce_flow_for_contact',
                module: 'alumina',
                type: 'danger',
                title: `Проскок HF из-за высокой скорости фильтрации (τ=${O.contactTime.toFixed(1)} с, v_f=${(O.filtVelocity * 100).toFixed(1)} см/с)`,
                reason: `Избыточный расход газа (${Math.round(O.normalFlow / 1000)} тыс. нм³/ч) сократил время контакта в реакторе и ускорил прохождение газа сквозь пирог рукавов.`,
                actionText: `Прикрыть НА дымососа до ${vaneOpt}%`,
                effectText: 'Восстановление времени контакта τ ≈ 2.4 с, падение HF ниже 0.5 мг/нм³',
                apply: () => {
                    I.guideVane = vaneOpt;
                    state.alarms.push(`✓ Советчик: НА прикрыт до ${vaneOpt}% для восстановления времени контакта`);
                }
            };
        } else if (I.regenSP < 1.0) {
            const newSP = 1.25;
            recHF = {
                id: 'thicken_cake_for_hf',
                module: 'alumina',
                type: 'danger',
                title: `Проскок HF через тонкий пирог на рукавах (ΔP уст = ${I.regenSP} кПа)`,
                reason: `Слишком ранняя продувка сбивает сорбционный слой глинозёма с рукавов (η₂ упала до ${O.effCake.toFixed(1)}%).`,
                actionText: `Поднять уставку регенерации ΔP до ${newSP} кПа`,
                effectText: 'Формирование стабильного пирога ~5 кг/м², рост η₂ выше 99.3%',
                apply: () => {
                    I.regenSP = newSP;
                    state.alarms.push(`✓ Советчик: уставка ΔP поднята до ${newSP} кПа для набора сорбционного пирога`);
                }
            };
        } else {
            const neededFresh = parseFloat(Math.min(10.0, Math.max(IDEAL.freshFeed, I.freshFeed + (O.hfOut > 1.0 ? 2.0 : 1.2))).toFixed(1));
            const neededRecirc = parseFloat(Math.min(40.0, Math.max(IDEAL.recircFeed, neededFresh * 4)).toFixed(1));
            recHF = {
                id: 'increase_sorbent_feed',
                module: 'alumina',
                type: 'danger',
                title: `Превышение ПДК по HF (${O.hfOut.toFixed(2)} мг/нм³)`,
                reason: `Текущей подачи сорбента (${I.freshFeed}/${I.recircFeed} т/ч) недостаточно для связывания ${O.hfGenKgH.toFixed(1)} кг/ч фтористого водорода.`,
                actionText: `Увеличить подачу: свежий ${neededFresh} т/ч, рецирк ${neededRecirc} т/ч`,
                effectText: 'Снижение HF на выходе ниже 0.45 мг/нм³, отмена экологических штрафов',
                apply: () => {
                    I.freshFeed = neededFresh;
                    I.recircFeed = neededRecirc;
                    state.alarms.push(`✓ Советчик: подача глинозёма увеличена до ${neededFresh}/${neededRecirc} т/ч`);
                }
            };
        }
        recs.push(recHF);
    } else if (I.freshFeed > 0.5 && I.recircFeed / I.freshFeed < 2.2) {
        aluminaStatus = 'warn';
        aluminaLabel = 'МАЛАЯ РЕЦИРКУЛЯЦИЯ';
        aluminaDesc = `Кратность рециркуляции ${(I.recircFeed / I.freshFeed).toFixed(1)}× (оптимум 3.5–4.5×). Недогрузка аэрожелоба`;
        score -= 8;

        const optRecirc = parseFloat(clamp(I.freshFeed * 4.0, 10, 40).toFixed(1));
        recs.push({
            id: 'opt_recirc_ratio',
            module: 'alumina',
            type: 'warn',
            title: `Низкая кратность рециркуляции (${(I.recircFeed / I.freshFeed).toFixed(1)}×)`,
            reason: `При однократном проходе зерно свежего глинозёма не успевает полностью прореагировать с HF и сформировать плотный пирог на рукавах.`,
            actionText: `Увеличить рециркуляцию Al₂O₃·AlF₃ до ${optRecirc} т/ч (4× от свежего)`,
            effectText: 'Повышение глубины фторирования глинозёма и стабильности η₂ пирога',
            apply: () => {
                I.recircFeed = optRecirc;
                state.alarms.push(`✓ Советчик: подача на рециркуляцию выставлена на ${optRecirc} т/ч`);
            }
        });
    } else if (P.tickCount > 40 && O.fContent < 0.48 && I.freshFeed > 4.0) {
        aluminaStatus = 'warn';
        aluminaLabel = 'БЕДНЫЙ ГЛИНОЗЁМ';
        aluminaDesc = `Насыщение фтором ${O.fContent.toFixed(2)} wt% (норма ТРП 0.6–1.5%). Избыток свежего глинозёма`;
        score -= 7;

        const captKgH = O.hfGenKgH * (O.effHF / 100) * (19 / 20);
        const optFresh = parseFloat(clamp(captKgH / 8.5, 3.5, I.freshFeed - 0.5).toFixed(1));
        recs.push({
            id: 'opt_f_low',
            module: 'alumina',
            type: 'warn',
            title: `Низкое насыщение глинозёма фтором (${O.fContent.toFixed(2)} wt%)`,
            reason: `Свежего глинозёма (${I.freshFeed} т/ч) подаётся больше, чем нужно для связывания ${O.hfGenKgH.toFixed(0)} кг/ч HF — глинозём уходит в электролиз «бедным» по фтору.`,
            actionText: `Снизить свежий Al₂O₃ до ${optFresh} т/ч (рецирк ${(optFresh * 4).toFixed(1)} т/ч)`,
            effectText: 'Выход на целевое насыщение ~0.85–1.0 wt% F по требованию электролиза',
            apply: () => {
                I.freshFeed = optFresh;
                I.recircFeed = parseFloat(Math.min(40, optFresh * 4).toFixed(1));
                state.alarms.push(`✓ Советчик: подача свежего скорректирована до ${optFresh} т/ч`);
            }
        });
    } else if (P.tickCount > 40 && O.fContent > 1.75) {
        aluminaStatus = 'warn';
        aluminaLabel = 'ПЕРЕНАСЫЩЕНИЕ F';
        aluminaDesc = `Насыщение глинозёма ${O.fContent.toFixed(2)} wt% F (>1.75%) — падает сорбционная ёмкость`;
        score -= 10;

        const captKgH = O.hfGenKgH * (O.effHF / 100) * (19 / 20);
        const optFresh = parseFloat(clamp(captKgH / 10.5, I.freshFeed + 1.0, 10).toFixed(1));
        recs.push({
            id: 'opt_f_high',
            module: 'alumina',
            type: 'warn',
            title: `Перенасыщение глинозёма фтором (${O.fContent.toFixed(2)} wt%)`,
            reason: `При F > 1.8 wt% свободная поверхность Al₂O₃ близка к насыщению, что грозит резким проскоком HF в трубу.`,
            actionText: `Увеличить подачу свежего до ${optFresh} т/ч (рецирк ${(optFresh * 4).toFixed(1)} т/ч)`,
            effectText: 'Снижение F% до безопасных ~1.0–1.2 wt%, восстановление запаса сорбции',
            apply: () => {
                I.freshFeed = optFresh;
                I.recircFeed = parseFloat(Math.min(40, optFresh * 4).toFixed(1));
                state.alarms.push(`✓ Советчик: подача свежего увеличена до ${optFresh} т/ч`);
            }
        });
    }

    adv.modules.alumina = { status: aluminaStatus, label: aluminaLabel, desc: aluminaDesc };

    // ══════════════════════════════════════════════════════════════════
    //  3. МОДУЛЬ «ДЫМОСОС, ТЯГА КОРПУСОВ И СЕЗОННОСТЬ»
    // ══════════════════════════════════════════════════════════════════
    let fanStatus = 'ok';
    let fanLabel = 'В НОРМЕ';
    let fanDesc = 'Проектное разрежение выдерживается, режим дымососа оптимален';

    const FLOW_PER_VANE = 3100;
    const actualPotFlow = O.potroomFlow || O.normalFlow;
    const vaneForTarget = Math.round(clamp(I.guideVane + (targetFlow - actualPotFlow) / FLOW_PER_VANE, 15, 100));
    const fugitivePipes = O.pipeFlows.filter(p => p.fugitive);
    const closedPipes = I.pipes.filter(p => p.damper < 90);

    if (O.normalFlow > 0 && closedPipes.length > 0 && fugitivePipes.length > 0) {
        fanStatus = 'danger';
        fanLabel = 'ВЫБИВАНИЕ (ШИБЕР)';
        const ids = closedPipes.map(p => p.id).join(', ');
        fanDesc = `Прикрыт шибер ${ids}: потеря тяги в ветви и выбивание газа в корпус!`;
        score -= 30;
        recs.push({
            id: 'open_damper',
            module: 'fan',
            type: 'danger',
            title: `Выбивание фтористых газов в корпус (прикрыт шибер ${ids})`,
            reason: `Из-за поджатия шибера ${ids} разрежение в ветви упало ниже порога удержания (50 Па). Газы идут под фонарь цеха, а соседние трубы перегружены.`,
            actionText: `Полностью открыть шибер(ы) ${ids} (100%)`,
            effectText: 'Выравнивание потоков по 4 ветвям, прекращение выбивания газов',
            apply: () => {
                I.pipes.forEach(p => { p.damper = 100; });
                state.alarms.push(`✓ Советчик: шиберы газоходов (${ids}) открыты на 100%`);
            }
        });
    } else if (I.fanRPM === 0 || O.normalFlow < 1000) {
        fanStatus = 'danger';
        fanLabel = 'ДЫМОСОС СТОП';
        fanDesc = 'Отсос газов прекращён! Загазованность корпусов электролиза!';
        score -= 55;
        recs.push({
            id: 'start_fan',
            module: 'fan',
            type: 'danger',
            title: 'Аварийный останов газоотсоса от серии электролиза',
            reason: 'Дымосос остановлен или полностью перекрыт тракт. Все фтористые газы поступают в рабочую зону корпусов.',
            actionText: 'Запустить дымосос (RPM 100%, НА 69%, открыть шиберы)',
            effectText: 'Восстановление проектного разрежения −150 Па и очистки газов',
            apply: () => {
                I.fanRPM = 100;
                I.guideVane = Math.max(69, I.guideVane);
                I.pipes.forEach(p => { p.damper = 100; });
                state.alarms.push('✓ Советчик: дымосос введён в работу на проектном режиме');
            }
        });
    } else if (fugitivePipes.length > 0 || O.calcDraft > Math.min(-65, I.inletDraft * 0.65)) {
        const isFug = fugitivePipes.length > 0;
        fanStatus = isFug ? 'danger' : 'warn';
        fanLabel = isFug ? 'ВЫБИВАНИЕ' : 'СЛАБАЯ ТЯГА';
        fanDesc = `Разрежение ${Math.round(O.calcDraft)} Па при уставке ${I.inletDraft} Па. ${isFug ? 'Выбивание в корпус!' : 'Ниже проектной уставки'}`;
        score -= isFug ? 28 : 12;
        const neededVane = Math.max(vaneForTarget, Math.min(100, Math.round(I.guideVane + 8)));
        recs.push({
            id: 'restore_draft',
            module: 'fan',
            type: isFug ? 'danger' : 'warn',
            title: `${isFug ? 'Выбивание газов в корпус' : 'Недостаточное разрежение'} (факт ${Math.round(O.calcDraft)} Па / уст ${I.inletDraft} Па)`,
            reason: I.dilutionValve > 25
                ? `Открытый клапан подсоса (${I.dilutionValve}%) забирает часть тяги дымососа на себя, ослабляя отсос от корпусов.`
                : `Отсос от корпусов (${Math.round(actualPotFlow / 1000)} тыс. нм³/ч) ниже необходимого (${Math.round(targetFlow / 1000)} тыс. нм³/ч) для поддержания уставки ${I.inletDraft} Па.`,
            actionText: I.dilutionValve > 25 && O.actualTemp < 115
                ? `Закрыть клапан подсоса и выставить НА ${vaneForTarget}%`
                : `Приоткрыть НА дымососа до ${neededVane}%`,
            effectText: `Восстановление разрежения ${I.inletDraft} Па под укрытиями электролизёров`,
            apply: () => {
                if (I.dilutionValve > 25 && O.actualTemp < 115) I.dilutionValve = 0;
                I.guideVane = neededVane;
                state.alarms.push(`✓ Советчик: НА выставлен на ${neededVane}% под уставку разрежения ${I.inletDraft} Па`);
            }
        });
    } else if (O.fanAmps > config.fanMaxAmps) {
        fanStatus = 'danger';
        fanLabel = 'ПЕРЕГРУЗКА';
        fanDesc = `Ток двигателя ${Math.round(O.fanAmps)} А превышает номинал ${config.fanMaxAmps} А!`;
        score -= 25;
        recs.push({
            id: 'fan_overload',
            module: 'fan',
            type: 'danger',
            title: `Токовая перегрузка двигателя дымососа (${Math.round(O.fanAmps)} А > ${config.fanMaxAmps} А)`,
            reason: `Потребляемая мощность ${Math.round(O.fanPowerKW)} кВт выше номинала 1600 кВт. Угроза отключения дымососа релейной защитой.`,
            actionText: `Прикрыть НА до ${vaneForTarget}%`,
            effectText: 'Снижение тока в безопасную зону, защита высоковольтного двигателя 6 кВ',
            apply: () => {
                I.guideVane = vaneForTarget;
                if (I.dilutionValve > 20 && O.actualTemp < 115) I.dilutionValve = 0;
                state.alarms.push(`✓ Советчик: НА прикрыт до ${vaneForTarget}%, перегрузка двигателя снята`);
            }
        });
    } else if (I.dilutionValve > 15 && O.actualTemp < 108 && P.anodeEffectTimer === 0) {
        fanStatus = 'warn';
        fanLabel = 'ХОЛОСТОЙ ПОДСОС';
        fanDesc = `Клапан подсоса открыт на ${I.dilutionValve}% без перегрева (T=${O.actualTemp.toFixed(0)}°C)`;
        score -= 8;
        recs.push({
            id: 'close_dilution_valve',
            module: 'fan',
            type: 'eco',
            title: `Холостой подсос наружного воздуха (клапан ${I.dilutionValve}%)`,
            reason: `Температура газа в норме (${O.actualTemp.toFixed(0)}°C), но открытый клапан подсоса нагружает дымосос балластным воздухом и переохлаждает тракт.`,
            actionText: 'Закрыть клапан подсоса (0%)',
            effectText: 'Снижение тока дымососа и устранение балластного расхода',
            apply: () => {
                I.dilutionValve = 0;
                state.alarms.push('✓ Советчик: клапан аварийного подсоса закрыт');
            }
        });
    } else if (actualPotFlow > targetFlow * 1.08 && I.guideVane > 25) {
        const winter = I.outdoorTemp <= -5;
        const r = targetFlow / actualPotFlow;
        const savedKW = Math.max(10, Math.round(O.fanPowerKW * (1 - Math.pow(r, 2.5))));
        const savedRubDay = Math.round(savedKW * 3.5 * 24);
        const savedRubMonth = savedRubDay * 30;
        fanStatus = 'warn';
        fanLabel = winter ? 'ЗИМНИЙ РЕЗЕРВ' : 'ИЗБЫТОЧНАЯ ТЯГА';
        fanDesc = winter
            ? `Тнар=${I.outdoorTemp}°C (самотяга трубы ${(O.stackDraft * 1000).toFixed(0)} Па). Перерасход ~${savedKW} кВт`
            : `Разрежение ${Math.round(O.calcDraft)} Па глубже уставки ${I.inletDraft} Па, перерасход ~${savedKW} кВт`;
        score -= winter ? 10 : 8;
        recs.push({
            id: winter ? 'winter_energy_saving' : 'over_draft_saving',
            module: 'fan',
            type: 'eco',
            title: winter
                ? `Зимний резерв энергосбережения (${I.outdoorTemp}°C, самотяга ${(O.stackDraft * 1000).toFixed(0)} Па)`
                : `Избыточная тяга дымососа (факт ${Math.round(O.calcDraft)} Па при уставке ${I.inletDraft} Па)`,
            reason: winter
                ? `На морозе плотность газа и естественная тяга 90-метровой трубы растут. Чтобы не выстужать корпуса электролиза и не жечь лишнюю энергию, НА следует прижать.`
                : `Дымосос качает на ${Math.round((1 / r - 1) * 100)}% больше проектного расхода. По закону подобия мощность растёт как Q^2.5.`,
            actionText: `Прижать НА с ${Math.round(I.guideVane)}% до ${vaneForTarget}%`,
            effectText: `Экономия ~${savedKW} кВт (~${savedRubDay.toLocaleString('ru-RU')} ₽/сут, ~${savedRubMonth.toLocaleString('ru-RU')} ₽/мес)`,
            apply: () => {
                I.guideVane = vaneForTarget;
                state.alarms.push(`✓ Советчик: НА поджат до ${vaneForTarget}% (экономия ~${savedKW} кВт)`);
            }
        });
    }

    adv.modules.fan = { status: fanStatus, label: fanLabel, desc: fanDesc };

    // ── ИТОГОВЫЙ HEALTH INDEX ──
    score = clamp(Math.round(score), 10, 100);
    adv.healthIndex = score;
    if (score >= 90) adv.healthStatus = 'ОТЛИЧНО';
    else if (score >= 70) adv.healthStatus = 'ВНИМАНИЕ';
    else adv.healthStatus = 'ТРЕВОГА';

    adv.recommendations = recs;
}

/**
 * Запуск обучающих и демонстрационных сценариев аномалий (6 сценариев)
 */
export function triggerScenario(state, name) {
    const I = state.inputs;
    const P = state.phys;
    const adv = state.advisor;

    if (name === 'anode_effect') {
        P.anodeEffectTimer = 200; // 20 сек реального времени при 1x
        adv.activeScenario = 'anode_effect';
        state.alarms.push('🔥 СЦЕНАРИЙ: Анодный эффект в корпусе (+55°C, залповый выброс HF в 3.5×)!');
    } else if (name === 'winter_frost') {
        I.outdoorTemp = -32;
        if (I.guideVane < 75) I.guideVane = 78;
        adv.activeScenario = 'winter_frost';
        state.alarms.push('❄ СЦЕНАРИЙ: Сибирский мороз −32°C (рост плотности газа, самотяги трубы и тока дымососа)!');
    } else if (name === 'bag_wear') {
        I.tornBags = Math.max(3, I.tornBags + 3);
        adv.activeScenario = 'bag_wear';
        state.alarms.push('🔍 СЦЕНАРИЙ: Скрытый порыв 3 рукавов (прострелы пыли и HF при регенерации секций С1–С3)!');
    } else if (name === 'feeder_fault') {
        I.freshFeed = 0.0;
        I.recircFeed = 2.0;
        P.cakeActivity = 0.32;
        adv.activeScenario = 'feeder_fault';
        state.alarms.push('⛔ СЦЕНАРИЙ: Отказ питателя свежего глинозёма (истощение пирога и проскок HF > 5 мг/нм³)!');
    } else if (name === 'wet_blinding') {
        I.gasHumidity = 18;
        I.gasTempSP = 88;
        adv.activeScenario = 'wet_blinding';
        state.alarms.push('💧 СЦЕНАРИЙ: Сырой глинозём и конденсация (точка росы ~86°C, цементация и залипание рукавов)!');
    } else if (name === 'air_drop') {
        P.receiverPressure = 0.29;
        I.regenSP = 0.85;
        adv.activeScenario = 'air_drop';
        state.alarms.push('🌬 СЦЕНАРИЙ: Падение давления сжатого воздуха в ресивере (0.29 МПа, срыв регенерации)!');
    }
}

/**
 * Применение рекомендации советчика по ID
 */
export function applyRecommendation(state, recId) {
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
