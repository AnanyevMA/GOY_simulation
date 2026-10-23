// ═══════════════════════════════════════════════════════════════════════
//  ANTIGRAVITY СГОУ — CANVAS RENDERER v8.0
//  Честная траектория свежего Al₂O₃ по течке в реактор, непрерывная
//  рециркуляция в аэрожелобе, однократная фильтрация частиц (видимый
//  проскок HF в трубу), посекционная отрисовка даже 1–3 рваных рукавов,
//  клапан подсоса холодного воздуха перед реактором и индикация точки росы.
// ═══════════════════════════════════════════════════════════════════════

import { getTornBagsInSection } from './config.js';

const VW = 1600, VH = 900;

const COL = {
    bg:      '#05070a',
    wall:    '#2d333b',
    wallLt:  '#3d4450',
    wallDk:  '#1b2028',
    fill:    '#0d1117',
    label:   '#6e7681',
    dirty:   '#ef4444',
    clean:   '#34d399',
    fresh:   '#e2e8f0',
    fluor:   '#fbbf24',
    dust:    '#fb923c',
    recirc:  '#fbbf24',
    regen:   '#58a6ff',
    coldAir: '#38bdf8',
    torn:    '#f85149',
    flange:  '#404854',
};

const PIPE_W = 36;
const DUCT_WALL = 4;

const G = {
    pipes: [
        { x: 60,  y: 610 },
        { x: 140, y: 610 },
        { x: 230, y: 610 },
        { x: 310, y: 610 },
    ],
    dilution: { x: 355, y: 610, w: 28 }, // Клапан подсоса атмосферного воздуха перед реактором
    pipeW: PIPE_W,
    duct:      { x: 40,   y: 470, w: 340, h: 80 },
    reactor:   { x: 380,  y: 170, w: 120, h: 380 },
    siloF:     { x: 280,  y: 20,  w: 75,  h: 120 },
    ductMid:   { x: 500,  y: 170, w: 130, h: 80 },
    filter:    { x: 630,  y: 130, w: 290, h: 450 },
    hopper:    { x: 660,  y: 580, w: 230, h: 140 },
    ductOut:   { x: 920,  y: 370, w: 120, h: 80 },
    fan:       { x: 1100, y: 410, r: 55 },
    ductStack: { x: 1155, y: 370, w: 145, h: 80 },
    stack:     { x: 1300, y: 40,  w: 110, h: 770 },
    chute:     { midY: 740 },
};

const particles = [];
let frameCount = 0;

class Particle {
    constructor(type, x, y, vx, vy) {
        this.type = type;
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.alive = true;
        this.life = 1.0;
        this.phase = 'normal';
        this.size = 3;
        this.turbulence = Math.random() * Math.PI * 2;
        this.pipeIdx = -1;
        this.filterChecked = false;
    }
}

// ══════════════════════════════════════════════════════════════════════
//  Ограничение частиц внутри труб и газоходов (clamping)
// ══════════════════════════════════════════════════════════════════════
function clampParticle(p) {
    const hw = G.pipeW / 2;

    if (p.phase === 'pipe' && p.pipeIdx >= 0) {
        const gp = G.pipes[p.pipeIdx];
        p.x = Math.max(gp.x - hw + 4, Math.min(gp.x + hw - 4, p.x));
    }

    if (p.phase === 'dilution_pipe') {
        const dw = G.dilution.w / 2;
        p.x = Math.max(G.dilution.x - dw + 3, Math.min(G.dilution.x + dw - 3, p.x));
    }

    if (p.phase === 'normal' && p.x >= G.duct.x && p.x <= G.duct.x + G.duct.w && (p.type === 'dirty' || p.type === 'cold_air')) {
        p.y = Math.max(G.duct.y + 5, Math.min(G.duct.y + G.duct.h - 5, p.y));
    }

    // Реактор Вентури
    if (p.phase === 'reactor' && p.x >= G.reactor.x - 22 && p.x <= G.reactor.x + G.reactor.w + 22 && p.y >= G.reactor.y && p.y <= G.duct.y + G.duct.h) {
        let leftWall = G.reactor.x - 14;
        let rightWall = G.reactor.x + G.reactor.w + 14;
        if (p.y > G.reactor.y + 150) {
            const frac = Math.min(1, (p.y - (G.reactor.y + 150)) / 200);
            leftWall = (G.reactor.x - 14) + frac * 22;
            rightWall = (G.reactor.x + G.reactor.w + 14) - frac * 50;
        }
        p.x = Math.max(leftWall, Math.min(rightWall, p.x));
        p.y = Math.max(G.reactor.y + 6, p.y);
    }

    // Верхний газоход реактор → фильтр
    if (p.x > G.ductMid.x && p.x < G.ductMid.x + G.ductMid.w) {
        if (p.type !== 'fugitive' && p.type !== 'pulse_blast' && p.phase !== 'fresh_pipe') {
            p.y = Math.max(G.ductMid.y + 5, Math.min(G.ductMid.y + G.ductMid.h - 5, p.y));
        }
    }

    // Выходной газоход фильтр → дымосос
    if (p.x > G.ductOut.x && p.x < G.ductOut.x + G.ductOut.w) {
        if (p.type === 'clean' || p.type === 'dust' || p.type === 'dirty') {
            p.y = Math.max(G.ductOut.y + 5, Math.min(G.ductOut.y + G.ductOut.h - 5, p.y));
        }
    }

    // Газоход дымосос → дымовая труба
    if (p.x > G.ductStack.x && p.x < G.ductStack.x + G.ductStack.w) {
        if (p.type === 'clean' || p.type === 'dust' || p.type === 'dirty') {
            p.y = Math.max(G.ductStack.y + 5, Math.min(G.ductStack.y + G.ductStack.h - 5, p.y));
        }
    }

    // Дымовая труба
    if (p.x > G.stack.x && p.x < G.stack.x + G.stack.w) {
        if (p.type !== 'fugitive') {
            p.x = Math.max(G.stack.x + 8, Math.min(G.stack.x + G.stack.w - 8, p.x));
        }
    }
}

function updateParticle(p, speedMul, state) {
    const O = state.out;
    const s = Math.max(0.03, speedMul);

    // 1. Течка свежего глинозёма из силоса в горловину реактора
    if (p.phase === 'fresh_pipe') {
        const targetX = G.reactor.x + 40;
        const targetY = G.duct.y - 6;
        const dx = targetX - p.x;
        const dy = targetY - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 10 || p.y >= targetY) {
            if (O.gasFlow > 500) {
                p.phase = 'reactor';
                p.x = G.reactor.x + 30 + (Math.random() - 0.5) * 20;
                p.y = G.duct.y + 10;
                p.vx = (Math.random() - 0.5) * 1.2;
                p.vy = -2.8 * Math.max(0.4, s);
            } else {
                p.alive = false;
            }
        } else {
            p.x += (dx / dist) * 4.2;
            p.y += (dy / dist) * 4.2;
        }
        return;
    }

    // 2. Аэрожелоб рециркуляции (из бункера фильтра в горловину реактора)
    if (p.type === 'recirc_return') {
        switch (p.phase) {
            case 'hopper':
                p.y += 2.4;
                if (p.y >= G.chute.midY - 6) {
                    p.y = G.chute.midY;
                    p.phase = 'left';
                }
                break;
            case 'left':
                p.x -= 4.0;
                if (p.x <= G.reactor.x + 40) {
                    p.x = G.reactor.x + 40;
                    p.phase = 'up';
                }
                break;
            case 'up':
                p.y -= 3.8;
                if (p.y <= G.duct.y + G.duct.h - 18) {
                    if (O.gasFlow > 500) {
                        p.type = 'fluor';
                        p.phase = 'reactor';
                        p.vx = (Math.random() - 0.5) * 1.5;
                        p.vy = -3.0 - Math.random() * 1.5;
                    } else {
                        p.alive = false;
                    }
                }
                break;
        }
        return;
    }

    // 3. Выбивание газа у основания труб (fugitive)
    if (p.type === 'fugitive') {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.016;
        if (p.life <= 0) p.alive = false;
        return;
    }

    // 4. Вспышка импульсной продувки внутри секции фильтра
    if (p.type === 'pulse_blast') {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.15;
        p.life -= 0.025;
        if (p.life <= 0 || p.y > G.hopper.y + G.hopper.h) p.alive = false;
        return;
    }

    // Основное перемещение
    if (p.type === 'fresh' || p.type === 'fluor') {
        p.x += p.vx * Math.max(0.4, s);
        p.y += p.vy * Math.max(0.4, s);
    } else {
        p.x += p.vx * s;
        p.y += p.vy * s;
    }

    // Поворот из сборного газохода в реактор Вентури
    if (p.phase === 'normal' && p.x >= G.reactor.x + 10 && p.y >= G.duct.y) {
        if (p.type === 'dirty' || p.type === 'cold_air') {
            p.vx *= 0.45;
            p.vy = -2.5;
            p.phase = 'reactor';
            if (p.type === 'cold_air') {
                // Холодный воздух смешивается с основным потоком в горловине
                p.life -= 0.35;
                if (p.life <= 0.3) p.type = 'dirty';
            }
        }
    }

    // Турбулентное восходящее движение в реакторе Вентури
    if (p.phase === 'reactor') {
        p.turbulence += 0.12;
        const tForce = Math.sin(p.turbulence) * 1.6 + (Math.random() - 0.5) * 0.9;
        p.vx = tForce * 0.6;
        if (p.y > G.reactor.y + 180) {
            p.vy = -3.4; // Ускорение в узкой горловине Вентури
        } else {
            p.vy = -2.4 + (Math.random() - 0.5) * 0.4;
        }
        // Переход из верхней части реактора в горизонтальный газоход ductMid
        if (p.y <= G.reactor.y + 42) {
            p.phase = 'ductMid';
            p.y = G.ductMid.y + 15 + Math.random() * (G.ductMid.h - 30);
            p.vx = 3.2;
            p.vy = 0;
        }
    }

    // Движение по верхнему газоходу к рукавному фильтру
    if (p.phase === 'ductMid' && p.x >= G.filter.x) {
        p.phase = 'in_filter';
    }

    // Прохождение через рукавный фильтр (ОДНОКРАТНАЯ проверка очистки!)
    if (p.x > G.filter.x && p.x < G.filter.x + G.filter.w) {
        if (p.type === 'dirty') {
            // Плавно направляем газ сверху вниз-вправо к выходному коллектору ductOut
            const targetY = G.ductOut.y + G.ductOut.h * 0.5;
            p.vy += ((targetY - p.y) * 0.018 - p.vy * 0.15);
            p.vx = 3.0;

            // В середине фильтра частица пересекает ткань рукавов:
            if (!p.filterChecked && p.x >= G.filter.x + G.filter.w * 0.45) {
                p.filterChecked = true;
                // Визуальная вероятность очистки: если HF в норме (<0.5), почти все частицы становятся зелёными;
                // если идёт проскок HF (>0.5 мг/нм³), доля красных частиц пропорциональна превышению ПДК!
                const cleanProb = O.hfOut <= 0.50
                    ? 99.2
                    : Math.max(20, 95 - (O.hfOut - 0.5) * 14);
                if (Math.random() * 100 < cleanProb) {
                    p.type = 'clean';
                    p.size = 2.5;
                } else {
                    p.type = 'dirty'; // Проскочивший HF остаётся красным до конца трубы!
                    p.size = 3.2;
                }
            }
        } else if (p.type === 'clean' || p.type === 'dust') {
            const targetY = G.ductOut.y + G.ductOut.h * 0.5;
            p.vy += ((targetY - p.y) * 0.025 - p.vy * 0.2);
            p.vx = 3.2;
        } else if (p.type === 'fresh' || p.type === 'fluor') {
            // Частицы сорбента оседают на рукавах фильтра, формируя пирог, и ссыпаются в бункер
            p.vx *= 0.88;
            p.vy = 2.2;
            if (p.y > G.filter.y + G.filter.h - 10) {
                p.alive = false;
            }
        }
    }

    // Притяжение к всасу дымососа
    if (p.x > G.ductOut.x && p.x < G.fan.x + G.fan.r) {
        const ty = G.fan.y;
        p.vy += (ty - p.y) * 0.06 * s;
    }

    // После улитки дымососа — выравнивание в напорный газоход
    if (p.x > G.fan.x + G.fan.r && p.x < G.stack.x) {
        p.vy += (G.ductStack.y + G.ductStack.h / 2 - p.y) * 0.09;
    }

    // Подъём по дымовой трубе
    if (p.x >= G.stack.x) {
        const cx = G.stack.x + G.stack.w / 2;
        p.vx += (cx - p.x) * 0.03;
        p.vx *= 0.88;
        p.vy = -4.2 * s;
    }

    clampParticle(p);

    if (p.x > VW + 20 || p.x < -20 || p.y < -20 || p.y > VH + 20) {
        p.alive = false;
    }
}

function drawParticle(ctx, p) {
    ctx.beginPath();
    let r = p.size || 3;
    let col = '#fff';
    switch (p.type) {
        case 'dirty':         col = COL.dirty;   r = p.size || 3.5; break;
        case 'clean':         col = COL.clean;   r = 2.5; break;
        case 'fresh':         col = COL.fresh;   r = 2.2; break;
        case 'fluor':         col = COL.fluor;   r = 2.2; break;
        case 'dust':          col = COL.dust;    r = 3.2; break;
        case 'cold_air':      col = COL.coldAir; r = 2.8; break;
        case 'fugitive':      col = `rgba(239,68,68,${p.life})`; r = 4.2; break;
        case 'recirc_return': col = COL.recirc;  r = 2.2; break;
        case 'pulse_blast':   col = `rgba(88,166,255,${p.life * 0.8})`; r = 3 + (1 - p.life) * 4; break;
    }
    ctx.fillStyle = col;
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
}

// ── Эмиссия частиц пропорционально расходам потоков ──
function emitParticles(state) {
    const O = state.out;
    const I = state.inputs;
    const P = state.phys;
    const nomFlow = 300000;
    const emitRate = O.gasFlow > 100 ? Math.min(1.6, O.gasFlow / nomFlow) : 0;

    // 1. Потоки по 4 трубам от корпусов и выбивание при слабом разрежении
    state.inputs.pipes.forEach((pipe, i) => {
        const pf = O.pipeFlows[i];
        const gp = G.pipes[i];
        if (pf.fugitive && Math.random() < 0.22) {
            particles.push(new Particle('fugitive', gp.x + (Math.random() - 0.5) * 14, gp.y + 45, (Math.random() - 0.5) * 2.5, -2.2 - Math.random() * 2));
        }
        if (pf.flow > 100 && Math.random() < emitRate * 0.28 * (pf.flow / 55000)) {
            const hw = G.pipeW / 2;
            const px = gp.x + (Math.random() - 0.5) * (hw - 6);
            const p = new Particle('dirty', px, gp.y + 40, 0, -3.2);
            p.phase = 'pipe';
            p.pipeIdx = i;
            particles.push(p);
        }
    });

    // 2. Клапан аварийного подсоса холодного воздуха перед реактором
    if (I.dilutionValve > 0 && O.gasFlow > 100 && Math.random() < (I.dilutionValve / 100) * 0.45) {
        const px = G.dilution.x + (Math.random() - 0.5) * 10;
        const p = new Particle('cold_air', px, G.dilution.y + 35, 0, -3.5);
        p.phase = 'dilution_pipe';
        particles.push(p);
    }

    // 3. Свежий глинозём по наклонной течке из силоса в горловину реактора
    if (I.freshFeed > 0 && Math.random() < (I.freshFeed / 5.5) * 0.28) {
        const px = G.siloF.x + G.siloF.w / 2 + (Math.random() - 0.5) * 6;
        const py = G.siloF.y + G.siloF.h;
        const pt = new Particle('fresh', px, py, 1.5, 4.0);
        pt.phase = 'fresh_pipe';
        particles.push(pt);
    }

    // 4. Непрерывная циркуляция фторированного глинозёма по аэрожелобу
    if (I.recircFeed > 0 && O.gasFlow > 100 && Math.random() < (I.recircFeed / 22) * 0.28) {
        const pt = new Particle(
            'recirc_return',
            G.hopper.x + G.hopper.w / 2 + (Math.random() - 0.5) * 24,
            G.hopper.y + G.hopper.h - 15,
            0,
            2.5
        );
        pt.phase = 'hopper';
        particles.push(pt);
    }

    // 5. Проскок пыли через порванные рукава (фоновый + усиленный в момент продувки рваной секции)
    if (I.tornBags > 0 && O.gasFlow > 100) {
        const spikeBoost = (P.dustSpikeTicks > 0 && P.spikeTornCount > 0) ? 0.35 : 0;
        if (Math.random() < Math.min(0.65, I.tornBags * 0.03 + spikeBoost)) {
            const p = new Particle(
                'dust',
                G.filter.x + G.filter.w * 0.6 + Math.random() * G.filter.w * 0.35,
                G.filter.y + 60 + Math.random() * (G.filter.h - 120),
                3.2,
                (Math.random() - 0.5) * 1.2
            );
            particles.push(p);
        }
    }

    // 6. Сброс пирога в бункер при импульсе регенерации секции
    const sectW = G.filter.w / state.sections.length;
    state.sections.forEach((sec, i) => {
        if (sec.isRegen && Math.random() < 0.4) {
            const pt = new Particle(
                'recirc_return',
                G.filter.x + i * sectW + sectW / 2 + (Math.random() - 0.5) * 30,
                G.filter.y + G.filter.h - 10,
                0,
                3.5
            );
            pt.phase = 'hopper';
            particles.push(pt);
        }
    });

    if (O.pulseFlash) {
        O.pulseFlash.forEach((flash, si) => {
            if (flash) {
                const secW = G.filter.w / 4;
                const sx = G.filter.x + si * secW + secW / 2;
                for (let j = 0; j < 15; j++) {
                    const p = new Particle(
                        'pulse_blast',
                        sx + (Math.random() - 0.5) * secW * 0.6,
                        G.filter.y + 30 + Math.random() * G.filter.h * 0.7,
                        (Math.random() - 0.5) * 2,
                        2 + Math.random() * 2
                    );
                    p.size = 2 + Math.random() * 3;
                    particles.push(p);
                }
            }
        });
    }

    while (particles.length > 1300) particles.shift();
}

let canvas, ctx;

export function initRenderer(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    canvas.width = VW;
    canvas.height = VH;
}

export function render(state, config) {
    if (!ctx) return;
    frameCount++;
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, VW, VH);

    drawEquipment(state, config);
    emitParticles(state);

    const spd = state.out.gasFlow / 220000;
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if ((p.phase === 'pipe' || p.phase === 'dilution_pipe') && p.y <= G.duct.y + G.duct.h / 2) {
            p.y = G.duct.y + G.duct.h / 2 + (Math.random() - 0.5) * (G.duct.h * 0.45);
            p.vy = 0;
            p.vx = 3.2;
            p.phase = 'normal';
            p.pipeIdx = -1;
        }
        updateParticle(p, spd, state);
        drawParticle(ctx, p);
        if (!p.alive) particles.splice(i, 1);
    }

    drawHeatHaze(state);
}

export function burstDust() {
    for (let i = 0; i < 22; i++) {
        particles.push(new Particle(
            'dust',
            G.filter.x + G.filter.w * 0.5 + Math.random() * G.filter.w * 0.45,
            G.filter.y + G.filter.h * 0.3 + Math.random() * G.filter.h * 0.4,
            4 + Math.random() * 4,
            (Math.random() - 0.5) * 4
        ));
    }
}

// ══════════════════════════════════════════════════════════════════════
//  Отрисовка труб, газоходов и аппаратов
// ══════════════════════════════════════════════════════════════════════

function drawDuct(x, y, w, h) {
    ctx.fillStyle = COL.fill;
    ctx.fillRect(x, y, w, h);

    const gTop = ctx.createLinearGradient(x, y, x, y + DUCT_WALL);
    gTop.addColorStop(0, COL.wallLt);
    gTop.addColorStop(1, COL.wallDk);
    ctx.fillStyle = gTop;
    ctx.fillRect(x, y, w, DUCT_WALL);

    const gBot = ctx.createLinearGradient(x, y + h - DUCT_WALL, x, y + h);
    gBot.addColorStop(0, COL.wallDk);
    gBot.addColorStop(1, COL.wallLt);
    ctx.fillStyle = gBot;
    ctx.fillRect(x, y + h - DUCT_WALL, w, DUCT_WALL);

    ctx.strokeStyle = COL.wall;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
}

function drawVerticalPipe(cx, y1, y2, w, highlight = false, tintCol = null) {
    const hw = w / 2;
    const x = cx - hw;
    const h = y2 - y1;

    ctx.fillStyle = COL.fill;
    ctx.fillRect(x, y1, w, h);

    const edgeCol = highlight ? '#5a2020' : (tintCol || COL.wallLt);
    const gLeft = ctx.createLinearGradient(x, y1, x + DUCT_WALL, y1);
    gLeft.addColorStop(0, edgeCol);
    gLeft.addColorStop(1, COL.wallDk);
    ctx.fillStyle = gLeft;
    ctx.fillRect(x, y1, DUCT_WALL, h);

    const gRight = ctx.createLinearGradient(x + w - DUCT_WALL, y1, x + w, y1);
    gRight.addColorStop(0, COL.wallDk);
    gRight.addColorStop(1, edgeCol);
    ctx.fillStyle = gRight;
    ctx.fillRect(x + w - DUCT_WALL, y1, DUCT_WALL, h);

    ctx.strokeStyle = highlight ? '#f8514955' : COL.wall;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y1, w, h);
}

function drawFlange(cx, y, w, isHorizontal = false) {
    if (isHorizontal) {
        ctx.fillStyle = COL.flange;
        ctx.fillRect(cx - 3, y, 6, w);
        ctx.strokeStyle = '#505a66';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx - 3, y, 6, w);
    } else {
        const hw = w / 2;
        ctx.fillStyle = COL.flange;
        ctx.fillRect(cx - hw - 4, y - 3, w + 8, 6);
        ctx.strokeStyle = '#505a66';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx - hw - 4, y - 3, w + 8, 6);
    }
}

function drawStackPipe(x, y, w, h) {
    const topW = w * 0.85;
    const botW = w;
    const topX = x + (w - topW) / 2;

    const grd = ctx.createLinearGradient(x, y, x + w, y);
    grd.addColorStop(0, '#1a1f28');
    grd.addColorStop(0.3, '#0d1117');
    grd.addColorStop(0.7, '#0d1117');
    grd.addColorStop(1, '#1a1f28');
    ctx.fillStyle = grd;

    ctx.beginPath();
    ctx.moveTo(topX, y);
    ctx.lineTo(topX + topW, y);
    ctx.lineTo(x + botW, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = COL.wallLt;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(topX, y);
    ctx.lineTo(x, y + h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(topX + topW, y);
    ctx.lineTo(x + botW, y + h);
    ctx.stroke();

    ctx.strokeStyle = COL.wallLt;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(topX - 3, y);
    ctx.lineTo(topX + topW + 3, y);
    ctx.stroke();

    ctx.strokeStyle = COL.flange;
    ctx.lineWidth = 2;
    for (let ri = 1; ri <= 3; ri++) {
        const ry = y + (h * ri) / 4;
        const frac = ri / 4;
        const rw = topW + (botW - topW) * frac;
        const rx = x + (w - rw) / 2;
        ctx.beginPath();
        ctx.moveTo(rx - 2, ry);
        ctx.lineTo(rx + rw + 2, ry);
        ctx.stroke();
    }

    ctx.strokeStyle = COL.flange;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 4, y + h);
    ctx.lineTo(x + botW + 4, y + h);
    ctx.stroke();
}

function drawFlowStripes(x, y, w, h, speed, direction = 'right') {
    if (speed < 0.01) return;
    const intensity = Math.min(1, speed * 1.5);
    ctx.save();
    ctx.globalAlpha = 0.1 + intensity * 0.12;
    ctx.strokeStyle = '#58a6ff';
    ctx.lineWidth = 1;

    const spacing = 25;
    const offset = (frameCount * speed * 3) % spacing;
    const count = Math.ceil((direction === 'up' ? h : w) / spacing) + 2;

    ctx.beginPath();
    ctx.rect(x + DUCT_WALL, y + DUCT_WALL, w - DUCT_WALL * 2, h - DUCT_WALL * 2);
    ctx.clip();

    for (let i = -1; i < count; i++) {
        if (direction === 'up') {
            const sy = y + h - i * spacing - offset;
            if (sy < y || sy > y + h) continue;
            ctx.beginPath();
            ctx.moveTo(x + DUCT_WALL + 2, sy);
            ctx.lineTo(x + w - DUCT_WALL - 2, sy);
            ctx.stroke();
        } else {
            const sx = direction === 'right' ? x + i * spacing + offset : x + w - i * spacing - offset;
            if (sx < x || sx > x + w) continue;
            ctx.beginPath();
            ctx.moveTo(sx, y + DUCT_WALL + 2);
            ctx.lineTo(sx, y + h - DUCT_WALL - 2);
            ctx.stroke();
        }
    }
    ctx.restore();
}

function drawHeatGlow(x, y, w, h, temp) {
    if (temp < 118) return;
    const intensity = Math.min(1, (temp - 118) / 75);
    ctx.save();
    const grd = ctx.createLinearGradient(x, y, x, y + h);
    grd.addColorStop(0, `rgba(255, ${Math.floor(100 - intensity * 70)}, 0, ${intensity * 0.12})`);
    grd.addColorStop(0.5, `rgba(255, ${Math.floor(60 - intensity * 40)}, 0, ${intensity * 0.22})`);
    grd.addColorStop(1, `rgba(255, ${Math.floor(100 - intensity * 70)}, 0, ${intensity * 0.12})`);
    ctx.fillStyle = grd;
    ctx.fillRect(x, y, w, h);
    if (intensity > 0.25) {
        ctx.shadowColor = `rgba(255, 80, 0, ${intensity * 0.5})`;
        ctx.shadowBlur = 10 + intensity * 15;
        ctx.strokeStyle = `rgba(255, 100, 30, ${intensity * 0.35})`;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.shadowBlur = 0;
    }
    ctx.restore();
}

function drawHeatHaze(state) {
    const T = state.out.actualTemp;
    if (T < 85 || state.out.gasFlow < 100) return;
    const intensity = Math.min(1, (T - 75) / 110);
    const topW = G.stack.w * 0.85;
    const topX = G.stack.x + (G.stack.w - topW) / 2;
    const cx = topX + topW / 2;
    const stackTop = G.stack.y;

    ctx.save();
    ctx.globalAlpha = intensity * 0.35;
    for (let i = 0; i < 5; i++) {
        const waveX = cx + Math.sin(frameCount * 0.03 + i * 1.5) * (6 + i * 4);
        const waveY = stackTop - 10 - i * 10;
        const r = 8 + i * 5 + Math.sin(frameCount * 0.05 + i) * 3;
        const grd = ctx.createRadialGradient(waveX, waveY, 0, waveX, waveY, r);
        const isDirty = state.out.hfOut > 0.5;
        grd.addColorStop(0, isDirty ? `rgba(248,113,113,${0.35 * intensity})` : `rgba(200,220,240,${0.3 * intensity})`);
        grd.addColorStop(1, 'rgba(200,220,240,0)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(waveX, waveY, r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function drawFanVolute(fx, fy, fr, state) {
    const I = state.inputs;
    const P = state.phys;

    ctx.save();
    ctx.beginPath();
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * Math.PI * 1.8;
        const r = fr + 4 + (i / steps) * 15;
        const x = fx + Math.cos(t - Math.PI * 0.5) * r;
        const y = fy + Math.sin(t - Math.PI * 0.5) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    const lastR = fr + 4 + 15;
    ctx.lineTo(fx + lastR + 20, fy - fr * 0.3);
    ctx.strokeStyle = I.fanRPM > 0 ? '#3d5a80' : COL.torn;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = '#0a0f18';
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(fx, fy, fr + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    const vaneAngle = (I.guideVane / 100) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(fx, fy, fr + 8, 0, vaneAngle);
    ctx.strokeStyle = I.guideVane > 50 ? '#3fb950' : (I.guideVane > 20 ? '#d29922' : '#f85149');
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.translate(fx, fy);
    ctx.rotate(P.fanAngle);
    const bladeCount = 8;
    for (let i = 0; i < bladeCount; i++) {
        const a = (i / bladeCount) * Math.PI * 2;
        ctx.save();
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.quadraticCurveTo(fr * 0.5, -8, fr - 8, -4);
        ctx.strokeStyle = I.fanRPM > 0 ? '#58a6ff88' : '#6e768155';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#30363d';
    ctx.fill();
    ctx.strokeStyle = '#58a6ff55';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
}

// ══════════════════════════════════════════════════════════════════════
//  Отрисовка всей технологической схемы
// ══════════════════════════════════════════════════════════════════════
function drawEquipment(state, cfg) {
    const I = state.inputs;
    const O = state.out;
    const P = state.phys;
    const T = O.actualTemp;
    const speed = O.gasFlow / 350000;

    ctx.lineWidth = 2;
    ctx.strokeStyle = COL.wall;
    ctx.font = '16px monospace';

    // ── 1. Четыре вертикальные трубы от корпусов электролиза ──
    G.pipes.forEach((gp, i) => {
        const pf = O.pipeFlows[i];
        const pipeTop = G.duct.y + G.duct.h;
        const pipeBot = gp.y;

        drawVerticalPipe(gp.x, pipeTop, pipeBot + 50, G.pipeW, pf.fugitive);
        drawFlange(gp.x, pipeTop, G.pipeW);
        drawFlange(gp.x, pipeBot + 46, G.pipeW);

        if (pf.flow > 100) {
            drawFlowStripes(gp.x - G.pipeW / 2, pipeTop, G.pipeW, pipeBot - pipeTop + 50, speed * (pf.flow / 55000), 'up');
        }
        if (T > 118) {
            drawHeatGlow(gp.x - G.pipeW / 2, pipeTop, G.pipeW, pipeBot - pipeTop + 50, T);
        }

        // Шибер трубы
        const damperFrac = I.pipes[i].damper / 100;
        if (damperFrac < 1.0) {
            const damperY = pipeBot + 20;
            const closedW = (G.pipeW * (1 - damperFrac)) / 2;
            ctx.fillStyle = '#94a3b8aa';
            ctx.fillRect(gp.x - G.pipeW / 2, damperY, closedW, 5);
            ctx.fillRect(gp.x + G.pipeW / 2 - closedW, damperY, closedW, 5);
        }

        ctx.fillStyle = pf.fugitive ? COL.torn : COL.label;
        ctx.font = '11px monospace';
        ctx.fillText(I.pipes[i].id, gp.x - 8, pipeBot + 68);
        ctx.fillText(`${I.pipes[i].damper}%`, gp.x - 12, pipeBot + 80);
        ctx.fillStyle = pf.fugitive ? COL.torn : '#58a6ffaa';
        ctx.font = '10px monospace';
        ctx.fillText(`${Math.round(pf.draft)}Па`, gp.x - 16, pipeBot + 92);
    });

    // ── 2. Клапан подсоса атмосферного воздуха перед реактором ──
    {
        const dx = G.dilution.x;
        const dw = G.dilution.w;
        const pipeTop = G.duct.y + G.duct.h;
        const pipeBot = G.dilution.y;
        const isOpen = I.dilutionValve > 0;
        drawVerticalPipe(dx, pipeTop, pipeBot + 35, dw, false, isOpen ? '#38bdf8' : null);
        drawFlange(dx, pipeTop, dw);

        // Заслонка клапана подсоса
        const openFrac = I.dilutionValve / 100;
        const damperY = pipeBot + 15;
        const closedW = (dw * (1 - openFrac)) / 2;
        ctx.fillStyle = isOpen ? '#38bdf8aa' : '#6e7681cc';
        ctx.fillRect(dx - dw / 2, damperY, closedW, 4);
        ctx.fillRect(dx + dw / 2 - closedW, damperY, closedW, 4);

        ctx.fillStyle = isOpen ? COL.coldAir : COL.label;
        ctx.font = '10px monospace';
        ctx.fillText('ПОДСОС', dx - 18, pipeBot + 52);
        ctx.fillText(`${I.dilutionValve}%`, dx - 10, pipeBot + 64);
    }

    ctx.font = '16px monospace';

    // ── 3. Сборный входной газоход ──
    drawDuct(G.duct.x, G.duct.y, G.duct.w, G.duct.h);
    drawHeatGlow(G.duct.x, G.duct.y, G.duct.w, G.duct.h, T);
    drawFlowStripes(G.duct.x, G.duct.y, G.duct.w, G.duct.h, speed, 'right');
    drawFlange(G.duct.x, G.duct.y, G.duct.h, true);
    drawFlange(G.duct.x + G.duct.w, G.duct.y, G.duct.h, true);

    ctx.fillStyle = COL.dirty;
    ctx.fillText('ГРЯЗНЫЙ ГАЗ', G.duct.x + 5, G.duct.y - 10);
    const draftVal = O.calcDraft;
    const draftCol = draftVal < -100 ? '#3fb950' : (draftVal < -50 ? '#d29922' : '#f85149');
    ctx.fillStyle = draftCol;
    ctx.font = '13px monospace';
    ctx.fillText(`Разр: ${Math.round(draftVal)} Па (уст ${I.inletDraft})`, G.duct.x + 5, G.duct.y - 28);

    // ── 4. Реактор Вентури ──
    ctx.fillStyle = COL.wallDk;
    ctx.strokeStyle = COL.wallLt;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(G.reactor.x, G.duct.y);
    ctx.lineTo(G.reactor.x - 20, G.reactor.y + 150);
    ctx.lineTo(G.reactor.x - 20, G.reactor.y);
    ctx.lineTo(G.reactor.x + G.reactor.w + 20, G.reactor.y);
    ctx.lineTo(G.reactor.x + G.reactor.w + 20, G.reactor.y + 150);
    ctx.lineTo(G.reactor.x + 80, G.duct.y);
    ctx.lineTo(G.reactor.x + 80, G.duct.y + G.duct.h);
    ctx.lineTo(G.reactor.x, G.duct.y + G.duct.h);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    drawHeatGlow(G.reactor.x - 20, G.reactor.y, G.reactor.w + 40, G.duct.y + G.duct.h - G.reactor.y, T);
    ctx.fillStyle = COL.label;
    ctx.font = '16px monospace';
    ctx.fillText('РЕАКТОР', G.reactor.x + 25, G.reactor.y - 6);

    // Завихритель в диффузоре реактора
    ctx.save();
    ctx.strokeStyle = `rgba(88,166,255,${0.15 + speed * 0.2})`;
    ctx.lineWidth = 1.5;
    const rcx = G.reactor.x + G.reactor.w / 2;
    const rcy = G.reactor.y + 100;
    for (let s = 0; s < 2; s++) {
        ctx.beginPath();
        for (let a = 0; a < Math.PI * 3; a += 0.1) {
            const r = 5 + a * 15;
            if (r > 60) break;
            const x = rcx + Math.cos(a + frameCount * speed * 0.02 + s * Math.PI) * r;
            const y = rcy + Math.sin(a + frameCount * speed * 0.02 + s * Math.PI) * r * 0.6;
            if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = '#8b949e';
    ctx.font = '11px monospace';
    ctx.fillText(`τ=${O.contactTime.toFixed(1)}с`, G.reactor.x + G.reactor.w + 24, G.reactor.y + 145);
    ctx.fillText(`η₁=${O.effReactor.toFixed(0)}%`, G.reactor.x + G.reactor.w + 24, G.reactor.y + 162);
    ctx.strokeStyle = COL.wall;
    ctx.lineWidth = 2;

    // ── 5. Силос свежего Al₂O₃ и наклонная течка ──
    ctx.fillStyle = '#111827';
    ctx.fillRect(G.siloF.x, G.siloF.y, G.siloF.w, G.siloF.h);
    ctx.strokeRect(G.siloF.x, G.siloF.y, G.siloF.w, G.siloF.h);

    // Индикатор заполнения/работы питателя свежего глинозёма
    const freshBarH = Math.min(G.siloF.h - 10, (I.freshFeed / 10) * (G.siloF.h - 10));
    ctx.fillStyle = I.freshFeed > 0.2 ? 'rgba(226,232,240,0.22)' : 'rgba(248,81,73,0.25)';
    ctx.fillRect(G.siloF.x + 4, G.siloF.y + G.siloF.h - freshBarH - 4, G.siloF.w - 8, freshBarH);

    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.moveTo(G.siloF.x + G.siloF.w / 2 - 6, G.siloF.y + G.siloF.h);
    ctx.lineTo(G.reactor.x + 34, G.duct.y - 6);
    ctx.lineTo(G.reactor.x + 46, G.duct.y - 6);
    ctx.lineTo(G.siloF.x + G.siloF.w / 2 + 6, G.siloF.y + G.siloF.h);
    ctx.fill();

    ctx.fillStyle = I.freshFeed > 0.2 ? COL.fresh : COL.torn;
    ctx.font = '12px monospace';
    ctx.fillText(`Al₂O₃ ${I.freshFeed.toFixed(1)}т/ч`, G.siloF.x - 10, G.siloF.y - 5);

    // ── 6. Аэрожелоб рециркуляции вторичного глинозёма ──
    ctx.strokeStyle = I.recircFeed > 0.5 ? '#fbbf24' : '#6e7681';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(G.hopper.x + G.hopper.w / 2, G.hopper.y + G.hopper.h);
    ctx.lineTo(G.hopper.x + G.hopper.w / 2, G.chute.midY);
    ctx.lineTo(G.reactor.x + 40, G.chute.midY);
    ctx.lineTo(G.reactor.x + 40, G.duct.y + G.duct.h - 10);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#fbbf24';
    ctx.font = '11px monospace';
    ctx.fillText(`АЭРОЖЕЛОБ РЕЦИРКУЛЯЦИИ (${I.recircFeed.toFixed(1)} т/ч · F=${O.fContent.toFixed(2)}%)`, G.reactor.x + 65, G.chute.midY + 16);

    // ── 7. Переходной газоход реактор → фильтр ──
    drawDuct(G.ductMid.x, G.ductMid.y, G.ductMid.w, G.ductMid.h);
    drawFlange(G.ductMid.x, G.ductMid.y, G.ductMid.h, true);
    drawFlange(G.ductMid.x + G.ductMid.w, G.ductMid.y, G.ductMid.h, true);
    drawHeatGlow(G.ductMid.x, G.ductMid.y, G.ductMid.w, G.ductMid.h, T);
    drawFlowStripes(G.ductMid.x, G.ductMid.y, G.ductMid.w, G.ductMid.h, speed, 'right');

    // ── 8. Рукавный фильтр (4 секции) ──
    ctx.fillStyle = COL.fill;
    ctx.fillRect(G.filter.x, G.filter.y, G.filter.w, G.filter.h);

    // Подсветка сырого режима / конденсации, если температура близка к точке росы
    if (O.dewPointMargin < 20) {
        const wetAlpha = Math.min(0.22, (20 - O.dewPointMargin) * 0.015);
        ctx.fillStyle = `rgba(56, 189, 248, ${wetAlpha})`;
        ctx.fillRect(G.filter.x + 2, G.filter.y + 2, G.filter.w - 4, G.filter.h - 4);
    }

    const grFl = ctx.createLinearGradient(G.filter.x, 0, G.filter.x + 5, 0);
    grFl.addColorStop(0, COL.wallLt);
    grFl.addColorStop(1, '#0d111700');
    ctx.fillStyle = grFl;
    ctx.fillRect(G.filter.x, G.filter.y, 5, G.filter.h);

    const grFr = ctx.createLinearGradient(G.filter.x + G.filter.w - 5, 0, G.filter.x + G.filter.w, 0);
    grFr.addColorStop(0, '#0d111700');
    grFr.addColorStop(1, COL.wallLt);
    ctx.fillStyle = grFr;
    ctx.fillRect(G.filter.x + G.filter.w - 5, G.filter.y, 5, G.filter.h);

    ctx.strokeStyle = COL.wall;
    ctx.lineWidth = 2;
    ctx.strokeRect(G.filter.x, G.filter.y, G.filter.w, G.filter.h);
    ctx.fillStyle = COL.label;
    ctx.font = '16px monospace';
    ctx.fillText('РУКАВНЫЙ ФИЛЬТР', G.filter.x + 35, G.filter.y - 8);

    // Отрисовка 4 секций и рукавов внутри них
    const secW = G.filter.w / cfg.numSections;
    state.sections.forEach((sec, si) => {
        const sx = G.filter.x + si * secW;
        const dp01 = Math.min(1, Math.max(0, (sec.dp - cfg.baseDP) / (I.regenSP * 1.5 - cfg.baseDP)));
        const tornInSec = getTornBagsInSection(si, I.tornBags, cfg.numSections);
        // Сколько из 3 визуальных рукавов секции рисуем порванными (даже 1 рваный рукав в секции виден!)
        const visualTorn = tornInSec <= 0 ? 0 : (tornInSec === 1 ? 1 : (tornInSec <= 4 ? 2 : 3));

        if (sec.isRegen && sec.regenTimer > sec.regenTimerMax - 4) {
            const flashIntensity = (sec.regenTimerMax - sec.regenTimer + 1) / 4;
            ctx.fillStyle = `rgba(88,166,255,${0.18 * (1 - flashIntensity * 0.25)})`;
            ctx.fillRect(sx + 1, G.filter.y + 1, secW - 2, G.filter.h - 2);
        }

        for (let bi = 0; bi < 3; bi++) {
            const bx = sx + (secW / 4) * (bi + 1);
            if (bi < visualTorn) {
                ctx.strokeStyle = COL.torn;
                ctx.lineWidth = 3.5;
                ctx.setLineDash([7, 6]);
            } else if (sec.isRegen) {
                ctx.strokeStyle = COL.regen;
                ctx.lineWidth = 4;
                ctx.setLineDash([]);
            } else {
                const r = Math.floor(70 + 185 * dp01);
                const g = Math.floor(115 * (1 - dp01 * 0.7) * O.cakeActivity);
                const b = Math.floor(65 * (1 - dp01));
                ctx.strokeStyle = `rgb(${r},${g},${b})`;
                ctx.lineWidth = 3 + dp01 * 5;
                ctx.setLineDash([]);
            }
            ctx.beginPath();
            ctx.moveTo(bx, G.filter.y + 22);
            ctx.lineTo(bx, G.filter.y + G.filter.h - 15);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Подпись секции и индикатор порывов в ней
        ctx.font = '10px monospace';
        ctx.fillStyle = tornInSec > 0 ? COL.torn : '#8b949e';
        ctx.fillText(tornInSec > 0 ? `С${si + 1} ⚡${tornInSec}` : `С${si + 1}`, sx + 8, G.filter.y + 15);

        if (si > 0) {
            ctx.strokeStyle = '#30363d77';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(sx, G.filter.y);
            ctx.lineTo(sx, G.filter.y + G.filter.h);
            ctx.stroke();
        }
    });
    ctx.lineWidth = 2;

    const dpC = O.avgFilterDP > I.regenSP * 1.15 ? COL.torn : (O.avgFilterDP > I.regenSP * 0.85 ? '#d29922' : '#3fb950');
    ctx.fillStyle = dpC;
    ctx.font = 'bold 14px monospace';
    ctx.fillText(`ΔP: ${O.avgFilterDP.toFixed(2)} кПа | Акт.пирога: ${(O.cakeActivity * 100).toFixed(0)}%`, G.filter.x + 12, G.filter.y + G.filter.h + 20);

    // ── 9. Бункер фильтра ──
    ctx.strokeStyle = COL.wall;
    ctx.fillStyle = '#0a0c10';
    ctx.beginPath();
    ctx.moveTo(G.hopper.x, G.hopper.y);
    ctx.lineTo(G.hopper.x + G.hopper.w, G.hopper.y);
    ctx.lineTo(G.hopper.x + G.hopper.w - 40, G.hopper.y + G.hopper.h);
    ctx.lineTo(G.hopper.x + 40, G.hopper.y + G.hopper.h);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // ── 10. Газоход чистого газа (фильтр → дымосос) ──
    drawDuct(G.ductOut.x, G.ductOut.y, G.ductOut.w, G.ductOut.h);
    drawFlange(G.ductOut.x, G.ductOut.y, G.ductOut.h, true);
    drawFlange(G.ductOut.x + G.ductOut.w, G.ductOut.y, G.ductOut.h, true);
    drawFlowStripes(G.ductOut.x, G.ductOut.y, G.ductOut.w, G.ductOut.h, speed, 'right');

    // ── 11. Центробежный дымосос с направляющим аппаратом ──
    const fx = G.fan.x, fy = G.fan.y, fr = G.fan.r;
    drawFanVolute(fx, fy, fr, state);
    ctx.fillStyle = COL.label;
    ctx.font = '14px monospace';
    ctx.fillText('ДЫМОСОС', fx - 32, fy - fr - 20);
    ctx.fillStyle = I.guideVane > 50 ? '#3fb950' : '#d29922';
    ctx.font = '12px monospace';
    ctx.fillText(`НА: ${Math.round(I.guideVane)}% | ${Math.round(O.fanAmps)}А`, fx - 42, fy - fr - 5);

    // ── 12. Напорный газоход (дымосос → труба) ──
    drawDuct(G.ductStack.x, G.ductStack.y, G.ductStack.w, G.ductStack.h);
    drawFlange(G.ductStack.x, G.ductStack.y, G.ductStack.h, true);
    drawFlange(G.ductStack.x + G.ductStack.w, G.ductStack.y, G.ductStack.h, true);
    drawFlowStripes(G.ductStack.x, G.ductStack.y, G.ductStack.w, G.ductStack.h, speed, 'right');

    // ── 13. Дымовая труба (H = 90 м) ──
    drawStackPipe(G.stack.x, G.stack.y, G.stack.w, G.stack.h);
    drawFlowStripes(G.stack.x, G.stack.y, G.stack.w, G.stack.h, speed, 'up');
    ctx.fillStyle = O.hfOut > 0.5 ? COL.torn : COL.clean;
    ctx.font = '14px monospace';
    ctx.fillText('ДЫМОВАЯ ТРУБА', G.stack.x - 10, G.stack.y - 10);

    // Индикация газоанализатора на трубе и самотяги
    ctx.font = '11px monospace';
    ctx.fillStyle = O.hfOut > 0.5 ? COL.torn : '#3fb950';
    ctx.fillText(`HF: ${O.hfOut.toFixed(2)} мг/нм³`, G.stack.x - 15, G.stack.y + G.stack.h + 18);
    ctx.fillStyle = O.dustOut > 5.0 ? COL.dust : '#8b949e';
    ctx.fillText(`Пыль: ${O.dustOut.toFixed(1)} мг/нм³`, G.stack.x - 15, G.stack.y + G.stack.h + 32);
    ctx.fillStyle = '#58a6ffaa';
    ctx.fillText(`Самотяга: +${Math.round(O.stackDraft * 1000)} Па`, G.stack.x - 15, G.stack.y + G.stack.h + 46);

    // ── 14. Легенда частиц ──
    ctx.font = '11px monospace';
    const leg = [
        [COL.dirty, 'HF+Пыль'],
        [COL.clean, 'Чистый газ'],
        [COL.fresh, 'Al₂O₃ свеж.'],
        [COL.fluor, 'AlF₃ рецирк.'],
        [COL.dust, 'Проскок пыли'],
        [COL.coldAir, 'Подсос возд.'],
    ];
    leg.forEach(([c, t], i) => {
        const lx = 35 + i * 112;
        ctx.fillStyle = c;
        ctx.fillRect(lx, VH - 32, 8, 8);
        ctx.fillText(t, lx + 12, VH - 24);
    });

    // ── 15. Статус ресивера и точки росы под фильтром ──
    const airCol = P.receiverPressure >= 0.45 ? '#3fb950' : (P.receiverPressure >= 0.35 ? '#d29922' : '#f85149');
    ctx.fillStyle = airCol;
    ctx.font = '11px monospace';
    ctx.fillText(`🌬 Ресивер: ${P.receiverPressure.toFixed(2)} МПа`, G.filter.x + 12, G.filter.y + G.filter.h + 38);

    const dewCol = O.dewPointMargin < 15 ? '#f85149' : (O.dewPointMargin < 24 ? '#d29922' : '#8b949e');
    ctx.fillStyle = dewCol;
    ctx.fillText(`💧 Tросы: ${O.dewPointTemp.toFixed(0)}°C (запас ${O.dewPointMargin.toFixed(0)}°C)`, G.filter.x + 12, G.filter.y + G.filter.h + 54);
}
