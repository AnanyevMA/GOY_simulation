// ═══════════════════════════════════════════════════════════════════════
//  ANTIGRAVITY СГОУ — CANVAS RENDERER v4.2
//  Реалистичные трубы с двойными стенками и фланцами, clamping частиц,
//  полосы потока, glow перегрева, турбулентность, импульс продувки,
//  частицы ∝ расходу, улитка дымососа, тепловая дымка.
// ═══════════════════════════════════════════════════════════════════════

const VW = 1600, VH = 900;

const COL = {
    bg:     '#05070a',
    wall:   '#2d333b',
    wallLt: '#3d4450',  // Светлая грань стенки трубы
    wallDk: '#1b2028',  // Тёмная грань стенки трубы
    fill:   '#0d1117',
    label:  '#6e7681',
    dirty:  '#ef4444',
    clean:  '#34d399',
    fresh:  '#e2e8f0',
    fluor:  '#fbbf24',
    dust:   '#fb923c',
    recirc: '#fbbf24',
    regen:  '#58a6ff',
    torn:   '#f85149',
    flange: '#404854',
};

// Геометрия оборудования (в виртуальных пикселях)
// Трубы теперь имеют ширину (pipeW) для реалистичной отрисовки
const PIPE_W = 36; // Ширина вертикальных труб от корпусов
const DUCT_WALL = 4; // Толщина стенки газохода

const G = {
    pipes: [
        { x: 60,  y: 610 },
        { x: 140, y: 610 },
        { x: 230, y: 610 },
        { x: 310, y: 610 },
    ],
    pipeW: PIPE_W,
    duct:     { x: 40,  y: 470, w: 340, h: 80 }, 
    reactor:  { x: 380, y: 170, w: 120, h: 380 }, 
    siloF:    { x: 280, y: 20,  w: 75,  h: 120 }, 
    ductMid:  { x: 500, y: 170, w: 130, h: 80 }, 
    filter:   { x: 630, y: 130, w: 290, h: 450 },
    hopper:   { x: 660, y: 580, w: 230, h: 140 },
    ductOut:  { x: 920, y: 370, w: 120, h: 80 },
    fan:      { x: 1100, y: 410, r: 55 },
    ductStack:{ x: 1155, y: 370, w: 145, h: 80 },
    stack:    { x: 1300, y: 40,  w: 110, h: 770 },
    chute:    { midY: 740 },
};

// ── Частицы ──
const particles = [];
let frameCount = 0;

class Particle {
    constructor(type, x, y, vx, vy) {
        this.type = type; this.x = x; this.y = y;
        this.vx = vx; this.vy = vy;
        this.alive = true; this.life = 1.0;
        this.phase = 'normal';
        this.size = 3;
        this.turbulence = 0;
        this.pipeIdx = -1; // К какой трубе привязана частица
    }
}

// ══════════════════════════════════════════════════════════════════════
//  Ограничение частиц внутри труб и газоходов (clamping)
// ══════════════════════════════════════════════════════════════════════
function clampParticle(p) {
    const hw = G.pipeW / 2;

    // Вертикальная труба (фаза 'pipe') — ограничить по X в пределах трубы
    if (p.phase === 'pipe' && p.pipeIdx >= 0) {
        const gp = G.pipes[p.pipeIdx];
        p.x = Math.max(gp.x - hw + 4, Math.min(gp.x + hw - 4, p.x));
    }

    // Входной газоход
    if (p.phase === 'normal' && p.x >= G.duct.x && p.x <= G.duct.x + G.duct.w && p.type === 'dirty') {
        p.y = Math.max(G.duct.y + 4, Math.min(G.duct.y + G.duct.h - 4, p.y));
    }

    // Реактор — ограничить внутри стенок (расширение Вентури)
    if (p.x >= G.reactor.x && p.x <= G.reactor.x + G.reactor.w && p.y >= G.reactor.y && p.y <= G.duct.y + G.duct.h) {
        if (p.type === 'dirty' || p.type === 'fresh' || p.type === 'fluor') {
            let leftWall = G.reactor.x + 6;
            let rightWall = G.reactor.x + G.reactor.w - 6;
            // Сужение (горловина) внизу
            if (p.y > G.reactor.y + G.reactor.h - 100) {
                leftWall = G.reactor.x + 20;
                rightWall = G.reactor.x + G.reactor.w - 20;
            }
            p.x = Math.max(leftWall, Math.min(rightWall, p.x));
            // Ограничение по Y
            if (p.phase === 'reactor') p.y = Math.max(G.reactor.y + 6, p.y);
        }
    }

    // Промежуточный газоход
    if (p.x > G.ductMid.x && p.x < G.ductMid.x + G.ductMid.w) {
        if (p.type !== 'fugitive' && p.type !== 'pulse_blast') {
            p.y = Math.max(G.ductMid.y + 4, Math.min(G.ductMid.y + G.ductMid.h - 4, p.y));
        }
    }

    // Фильтр → не ограничиваем строго (частицы должны проходить)

    // Выходной газоход
    if (p.x > G.ductOut.x && p.x < G.ductOut.x + G.ductOut.w) {
        if (p.type === 'clean' || p.type === 'dust') {
            p.y = Math.max(G.ductOut.y + 4, Math.min(G.ductOut.y + G.ductOut.h - 4, p.y));
        }
    }

    // Газоход после дымососа
    if (p.x > G.ductStack.x && p.x < G.ductStack.x + G.ductStack.w) {
        if (p.type === 'clean' || p.type === 'dust') {
            p.y = Math.max(G.ductStack.y + 4, Math.min(G.ductStack.y + G.ductStack.h - 4, p.y));
        }
    }

    // Дымовая труба
    if (p.x > G.stack.x && p.x < G.stack.x + G.stack.w) {
        if (p.type !== 'fugitive') {
            p.x = Math.max(G.stack.x + 6, Math.min(G.stack.x + G.stack.w - 6, p.x));
        }
    }
}

function updateParticle(p, speedMul, effHF) {
    const s = Math.max(0.05, speedMul);

    // Рециркуляция (по аэрожелобу к подножию реактора)
    if (p.type === 'recirc_return') {
        switch (p.phase) {
            case 'hopper': p.y += 2; if (p.y > G.chute.midY - 10) { p.phase = 'left'; } break;
            case 'left':   p.x -= 3.5; if (p.x < G.reactor.x + G.reactor.w/2) { p.phase = 'up'; } break;
            case 'up':     
                p.y -= 3.5; 
                // Впрыск в горловину реактора: превращаем в fluor
                if (p.y < G.duct.y + G.duct.h - 20) { 
                    p.type = 'fluor';
                    p.phase = 'reactor';
                    p.vx = (Math.random() - 0.5) * 1.5;
                    p.vy = -3 - Math.random() * 2;
                }
                break;
        }
        return;
    }
    if (p.type === 'fugitive') {
        p.x += p.vx; p.y += p.vy; p.life -= 0.015;
        if (p.life <= 0) p.alive = false;
        return;
    }
    if (p.type === 'pulse_blast') {
        p.x += p.vx; p.y += p.vy;
        p.vy += 0.15;
        p.life -= 0.025;
        if (p.life <= 0) p.alive = false;
        // Ограничить pulse_blast внутри фильтра + бункера
        if (p.y > G.hopper.y + G.hopper.h) p.alive = false;
        return;
    }

    if (p.type === 'fresh' || p.type === 'fluor') {
        p.x += p.vx; p.y += p.vy;
    } else {
        p.x += p.vx * s; p.y += p.vy * s;
    }

    // Поворот из газохода в реактор
    if (p.phase === 'normal' && p.x >= G.reactor.x && p.y >= G.duct.y) {
        if (p.type === 'dirty') {
            p.vx *= 0.5;
            p.vy -= 1.5 * s; // Подхват потоком вверх
            if (p.y < G.duct.y + G.duct.h - 20) p.phase = 'reactor';
        }
    }

    // Турбулентность в вертикальном реакторе (движение вверх)
    if (p.phase === 'reactor' && p.y > G.reactor.y && p.y <= G.duct.y + G.duct.h) {
        if (p.type === 'dirty' || p.type === 'fresh' || p.type === 'fluor') {
            p.turbulence += 0.08;
            const tForce = Math.sin(p.turbulence) * 1.5 + (Math.random() - 0.5) * 0.8;
            p.vx += tForce * 0.3;
            // Ускорение в горловине
            if (p.y > G.reactor.y + G.reactor.h - 100) {
                p.vy -= 0.5 * s;
            } else {
                p.vy = -2 * s + (Math.random() - 0.5) * 0.5;
            }
            // Выход из реактора в ductMid
            if (p.y <= G.reactor.y + 40) {
                p.phase = 'ductMid';
                p.vx = 3 * s;
                p.vy = 0;
            }
        }
    }
    // Газоход→фильтр
    if (p.phase === 'ductMid' || (p.x > G.ductMid.x && p.x < G.ductMid.x + G.ductMid.w)) {
        if (p.type === 'fresh' || p.type === 'fluor') p.vx = 3 * s;
    }
    // Фильтр
    if (p.x > G.filter.x && p.x < G.filter.x + G.filter.w) {
        if (p.type === 'dirty') {
            if (Math.random() * 100 < effHF) {
                p.type = 'clean'; p.vx = 3; p.vy = (Math.random() - 0.5) * 0.3;
                p.size = 2.5;
            } else p.vx = 3;
        }
        if (p.type === 'fresh' || p.type === 'fluor') {
            p.vx = 0; p.vy = 1.5;
            if (p.y > G.filter.y + G.filter.h) p.alive = false;
        }
    }
    // К дымососу — притягивать к центру дымососа
    if (p.x > G.ductOut.x && p.x < G.fan.x + G.fan.r) {
        const ty = G.fan.y; p.vy += (ty - p.y) * 0.05 * s;
    }
    // После дымососа — направить в трубу
    if (p.x > G.fan.x + G.fan.r && p.x < G.stack.x) {
        p.vy += (G.ductStack.y + G.ductStack.h / 2 - p.y) * 0.08;
    }
    // Дымовая труба — вверх + центрирование
    if (p.x > G.stack.x) {
        const cx = G.stack.x + G.stack.w / 2;
        p.vx += (cx - p.x) * 0.03; // центрируем по X
        p.vx *= 0.9;
        p.vy = -4 * s;
    }

    // Clamping — жёсткое ограничение внутри труб
    clampParticle(p);

    if (p.x > VW + 20 || p.x < -20 || p.y < -20 || p.y > VH + 20) p.alive = false;
}

function drawParticle(ctx, p) {
    ctx.beginPath();
    let r = p.size || 3, col = '#fff';
    switch (p.type) {
        case 'dirty':        col = COL.dirty; r = 3.5; break;
        case 'clean':        col = COL.clean; r = 2.5; break;
        case 'fresh':        col = COL.fresh; r = 2; break;
        case 'fluor':        col = COL.fluor; r = 2; break;
        case 'dust':         col = COL.dust;  r = 3; break;
        case 'fugitive':     col = `rgba(239,68,68,${p.life})`; r = 4; break;
        case 'recirc_return':col = COL.recirc; r = 2; break;
        case 'pulse_blast':  col = `rgba(88,166,255,${p.life * 0.8})`; r = 3 + (1 - p.life) * 4; break;
    }
    ctx.fillStyle = col;
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
}

// ── Эмиссия частиц ∝ расходу ──
function emitParticles(state) {
    const O = state.out;
    const I = state.inputs;
    const nomFlow = 350000;
    const emitRate = O.gasFlow > 0 ? Math.min(1.5, O.gasFlow / nomFlow) : 0;

    if (O.gasFlow > 0) {
        state.inputs.pipes.forEach((pipe, i) => {
            const pf = O.pipeFlows[i];
            const gp = G.pipes[i];
            if (pf.fugitive && Math.random() < 0.15) {
                particles.push(new Particle('fugitive', gp.x, gp.y, (Math.random()-0.5)*2.5, -2.5-Math.random()*2));
            }
            if (pf.flow > 0 && Math.random() < emitRate * 0.25 * (pipe.damper/100)) {
                const hw = G.pipeW / 2;
                const px = gp.x + (Math.random() - 0.5) * (hw - 8); // внутри трубы
                const p = new Particle('dirty', px, gp.y, 0, -3);
                p.phase = 'pipe';
                p.pipeIdx = i;
                particles.push(p);
            }
        });
        if (Math.random() < emitRate * 0.3) {
            const dy = G.duct.y + G.duct.h * 0.2 + Math.random() * G.duct.h * 0.6;
            particles.push(new Particle('dirty', G.duct.x + G.duct.w, dy, 3, 0));
        }
    }

    if (I.freshFeed > 0 && Math.random() < 0.2) {
        // Свежий глинозём падает по течке прямо в горловину
        const px = G.siloF.x + G.siloF.w/2 + (Math.random() - 0.5) * 10;
        const py = G.siloF.y + G.siloF.h;
        const pt = new Particle('fresh', px, py, 1.5, 4); // летит вправо-вниз
        pt.phase = 'fresh_pipe';
        particles.push(pt);
    }
    if (I.recircFeed > 0 && Math.random() < 0.3) {
        // Фторированный глинозём теперь спавнится из аэрожелоба (ниже), это делает recirc_return
        // Но для начального наполнения спавним в горловине:
        if (Math.random() < 0.05) {
            const pt = new Particle('fluor', G.reactor.x + 25 + Math.random()*20, G.duct.y + G.duct.h - 10, (Math.random()-0.5)*1, -2);
            pt.phase = 'reactor';
            particles.push(pt);
        }
    }
    if (I.tornBags > 0 && O.gasFlow > 0 && Math.random() < I.tornBags * 0.012) {
        particles.push(new Particle('dust', G.filter.x + Math.random()*G.filter.w, G.filter.y + Math.random()*G.filter.h*0.6, 3, (Math.random()-0.5)*1.5));
    }
    
    // Пыль падает в бункер при регенерации секций
    const sectW = G.filter.w / state.sections.length;
    state.sections.forEach((sec, i) => {
        if (sec.isRegen && Math.random() < 0.3) {
            const pt = new Particle('recirc_return', G.filter.x + i * sectW + sectW/2 + (Math.random()-0.5)*30, G.filter.y + G.filter.h, 0, 4);
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
                    const p = new Particle('pulse_blast',
                        sx + (Math.random()-0.5) * secW * 0.6,
                        G.filter.y + 30 + Math.random() * G.filter.h * 0.7,
                        (Math.random()-0.5) * 2,
                        2 + Math.random() * 2
                    );
                    p.size = 2 + Math.random() * 3;
                    particles.push(p);
                }
            }
        });
    }

    while (particles.length > 1200) particles.shift();
}

// ── Контекст канваса ──
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

    const spd = state.out.gasFlow / 200000;
    const effHF = state.out.effHF;
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        // Переход из вертикальной трубы в горизонтальный газоход
        if (p.phase === 'pipe' && p.y <= G.duct.y + G.duct.h / 2) {
            p.y = G.duct.y + G.duct.h / 2 + (Math.random() - 0.5) * (G.duct.h * 0.4);
            p.vy = 0; p.vx = 3;
            p.phase = 'normal';
            p.pipeIdx = -1;
        }
        updateParticle(p, spd, effHF);
        drawParticle(ctx, p);
        if (!p.alive) particles.splice(i, 1);
    }

    drawHeatHaze(state);
}

export function burstDust() {
    for (let i = 0; i < 20; i++) {
        particles.push(new Particle('dust',
            G.filter.x + Math.random() * G.filter.w,
            G.filter.y + G.filter.h * 0.3 + Math.random() * G.filter.h * 0.4,
            4 + Math.random() * 4, (Math.random() - 0.5) * 5));
    }
}

// ══════════════════════════════════════════════════════════════════════
//  Отрисовка реалистичных труб и газоходов
// ══════════════════════════════════════════════════════════════════════

/**
 * Горизонтальный газоход с двойной стенкой и 3D-рельефом
 */
function drawDuct(x, y, w, h) {
    // Тёмная заливка внутренности
    ctx.fillStyle = COL.fill;
    ctx.fillRect(x, y, w, h);

    // Верхняя стенка (светлая грань сверху, тёмная снизу)
    const gTop = ctx.createLinearGradient(x, y, x, y + DUCT_WALL);
    gTop.addColorStop(0, COL.wallLt);
    gTop.addColorStop(1, COL.wallDk);
    ctx.fillStyle = gTop;
    ctx.fillRect(x, y, w, DUCT_WALL);

    // Нижняя стенка (тёмная сверху, светлая снизу)
    const gBot = ctx.createLinearGradient(x, y + h - DUCT_WALL, x, y + h);
    gBot.addColorStop(0, COL.wallDk);
    gBot.addColorStop(1, COL.wallLt);
    ctx.fillStyle = gBot;
    ctx.fillRect(x, y + h - DUCT_WALL, w, DUCT_WALL);

    // Обводка
    ctx.strokeStyle = COL.wall;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
}

/**
 * Вертикальная труба с двойной стенкой (от корпуса до газохода)
 */
function drawVerticalPipe(cx, y1, y2, w, highlight = false) {
    const hw = w / 2;
    const x = cx - hw;
    const h = y2 - y1;

    // Заливка внутренности
    ctx.fillStyle = COL.fill;
    ctx.fillRect(x, y1, w, h);

    // Левая стенка (с 3D эффектом)
    const gLeft = ctx.createLinearGradient(x, y1, x + DUCT_WALL, y1);
    gLeft.addColorStop(0, highlight ? '#5a2020' : COL.wallLt);
    gLeft.addColorStop(1, COL.wallDk);
    ctx.fillStyle = gLeft;
    ctx.fillRect(x, y1, DUCT_WALL, h);

    // Правая стенка
    const gRight = ctx.createLinearGradient(x + w - DUCT_WALL, y1, x + w, y1);
    gRight.addColorStop(0, COL.wallDk);
    gRight.addColorStop(1, highlight ? '#5a2020' : COL.wallLt);
    ctx.fillStyle = gRight;
    ctx.fillRect(x + w - DUCT_WALL, y1, DUCT_WALL, h);

    // Обводка
    ctx.strokeStyle = highlight ? '#f8514955' : COL.wall;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y1, w, h);
}

/**
 * Фланец (горизонтальная полоска-утолщение на стыке труб)
 */
function drawFlange(cx, y, w, isHorizontal = false) {
    if (isHorizontal) {
        // Фланец на горизонтальном газоходе (вертикальная полоска)
        ctx.fillStyle = COL.flange;
        ctx.fillRect(cx - 3, y, 6, w);
        ctx.strokeStyle = '#505a66';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx - 3, y, 6, w);
    } else {
        // Фланец на вертикальной трубе (горизонтальная полоска)
        const hw = w / 2;
        ctx.fillStyle = COL.flange;
        ctx.fillRect(cx - hw - 4, y - 3, w + 8, 6);
        ctx.strokeStyle = '#505a66';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx - hw - 4, y - 3, w + 8, 6);
    }
}

/**
 * Дымовая труба (конусная, расширяется к основанию)
 */
function drawStackPipe(x, y, w, h) {
    const topW = w * 0.85;  // Верх уже
    const botW = w;          // Низ шире
    const topX = x + (w - topW) / 2;

    // Заливка — градиент чтобы было «объёмно»
    const grd = ctx.createLinearGradient(x, y, x + w, y);
    grd.addColorStop(0, '#1a1f28');
    grd.addColorStop(0.3, '#0d1117');
    grd.addColorStop(0.7, '#0d1117');
    grd.addColorStop(1, '#1a1f28');
    ctx.fillStyle = grd;

    // Трапециевидный силуэт
    ctx.beginPath();
    ctx.moveTo(topX, y);
    ctx.lineTo(topX + topW, y);
    ctx.lineTo(x + botW, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fill();

    // Стенки — левая и правая грани
    ctx.strokeStyle = COL.wallLt;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(topX, y); ctx.lineTo(x, y + h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(topX + topW, y); ctx.lineTo(x + botW, y + h);
    ctx.stroke();

    // Верхний срез (оголовок)
    ctx.strokeStyle = COL.wallLt;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(topX - 3, y); ctx.lineTo(topX + topW + 3, y); ctx.stroke();

    // Кольца жёсткости (3 штуки по высоте)
    ctx.strokeStyle = COL.flange;
    ctx.lineWidth = 2;
    for (let ri = 1; ri <= 3; ri++) {
        const ry = y + (h * ri / 4);
        const frac = ri / 4;
        const rw = topW + (botW - topW) * frac;
        const rx = x + (w - rw) / 2;
        ctx.beginPath();
        ctx.moveTo(rx - 2, ry);
        ctx.lineTo(rx + rw + 2, ry);
        ctx.stroke();
    }

    // Нижний обводочный фланец
    ctx.strokeStyle = COL.flange;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x - 4, y + h); ctx.lineTo(x + botW + 4, y + h); ctx.stroke();
}

// ══════════════════════════════════════════════════════════════════════
//  Анимированные полосы потока в газоходах
// ══════════════════════════════════════════════════════════════════════
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

    // Clip region — строго внутри газохода
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
            const sx = (direction === 'right')
                ? x + i * spacing + offset
                : x + w - i * spacing - offset;
            if (sx < x || sx > x + w) continue;
            ctx.beginPath();
            ctx.moveTo(sx, y + DUCT_WALL + 2);
            ctx.lineTo(sx, y + h - DUCT_WALL - 2);
            ctx.stroke();
        }
    }
    ctx.restore();
}

// ══════════════════════════════════════════════════════════════════════
//  Glow-эффект перегрева
// ══════════════════════════════════════════════════════════════════════
function drawHeatGlow(x, y, w, h, temp) {
    if (temp < 120) return;
    const intensity = Math.min(1, (temp - 120) / 80);
    ctx.save();
    const grd = ctx.createLinearGradient(x, y, x, y + h);
    grd.addColorStop(0, `rgba(255, ${Math.floor(100 - intensity * 70)}, 0, ${intensity * 0.12})`);
    grd.addColorStop(0.5, `rgba(255, ${Math.floor(60 - intensity * 40)}, 0, ${intensity * 0.2})`);
    grd.addColorStop(1, `rgba(255, ${Math.floor(100 - intensity * 70)}, 0, ${intensity * 0.12})`);
    ctx.fillStyle = grd;
    ctx.fillRect(x, y, w, h);
    if (intensity > 0.3) {
        ctx.shadowColor = `rgba(255, 80, 0, ${intensity * 0.5})`;
        ctx.shadowBlur = 10 + intensity * 15;
        ctx.strokeStyle = `rgba(255, 100, 30, ${intensity * 0.3})`;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.shadowBlur = 0;
    }
    ctx.restore();
}

// ══════════════════════════════════════════════════════════════════════
//  Тепловая дымка на трубе
// ══════════════════════════════════════════════════════════════════════
function drawHeatHaze(state) {
    const T = state.out.actualTemp;
    if (T < 90) return;
    const intensity = Math.min(1, (T - 80) / 120);
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
        grd.addColorStop(0, `rgba(200,220,240,${0.3 * intensity})`);
        grd.addColorStop(1, 'rgba(200,220,240,0)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(waveX, waveY, r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

// ══════════════════════════════════════════════════════════════════════
//  Улитка дымососа
// ══════════════════════════════════════════════════════════════════════
function drawFanVolute(fx, fy, fr, state) {
    const I = state.inputs;
    const P = state.phys;

    ctx.save();
    // Корпус-улитка (спиральный кожух)
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

    // Заливка
    ctx.fillStyle = '#0a0f18';
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(fx, fy, fr + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Дуга НА
    const vaneAngle = (I.guideVane / 100) * Math.PI * 2;
    ctx.beginPath(); ctx.arc(fx, fy, fr + 8, 0, vaneAngle);
    ctx.strokeStyle = I.guideVane > 50 ? '#3fb950' : (I.guideVane > 20 ? '#d29922' : '#f85149');
    ctx.lineWidth = 4; ctx.stroke();

    // Лопасти
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
    // Ступица
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#30363d'; ctx.fill();
    ctx.strokeStyle = '#58a6ff55'; ctx.lineWidth = 1.5; ctx.stroke();

    ctx.restore();
}

// ══════════════════════════════════════════════════════════════════════
//  Отрисовка оборудования
// ══════════════════════════════════════════════════════════════════════
function drawEquipment(state, cfg) {
    const I = state.inputs;
    const O = state.out;
    const P = state.phys;
    const T = O.actualTemp;
    const speed = O.gasFlow / 350000;

    ctx.lineWidth = 2; ctx.strokeStyle = COL.wall; ctx.font = '16px monospace';

    // ── Вертикальные трубы от корпусов (реалистичные!) ──
    G.pipes.forEach((gp, i) => {
        const pf = O.pipeFlows[i];
        const pipeTop = G.duct.y + G.duct.h;
        const pipeBot = gp.y;

        // Труба с двойными стенками
        drawVerticalPipe(gp.x, pipeTop, pipeBot + 50, G.pipeW, pf.fugitive);

        // Фланец на стыке с газоходом (верх)
        drawFlange(gp.x, pipeTop, G.pipeW);

        // Фланец на входе (низ)
        drawFlange(gp.x, pipeBot + 46, G.pipeW);

        // Полосы потока внутри трубы
        if (pf.flow > 0) {
            drawFlowStripes(gp.x - G.pipeW/2, pipeTop, G.pipeW, pipeBot - pipeTop + 50, speed * (I.pipes[i].damper/100), 'up');
        }

        // Тепловое свечение
        if (T > 120) {
            drawHeatGlow(gp.x - G.pipeW/2, pipeTop, G.pipeW, pipeBot - pipeTop + 50, T);
        }

        // Шибер (визуализация % открытия) — горизонтальная заслонка
        const damperFrac = I.pipes[i].damper / 100;
        if (damperFrac < 1.0) {
            const damperY = pipeBot + 20;
            const closedW = G.pipeW * (1 - damperFrac) / 2;
            ctx.fillStyle = '#6e768199';
            ctx.fillRect(gp.x - G.pipeW/2, damperY, closedW, 4);
            ctx.fillRect(gp.x + G.pipeW/2 - closedW, damperY, closedW, 4);
        }

        // Подписи
        ctx.fillStyle = pf.fugitive ? COL.torn : COL.label;
        ctx.font = '11px monospace';
        ctx.fillText(I.pipes[i].id, gp.x - 8, pipeBot + 70);
        ctx.fillText(`${I.pipes[i].damper}%`, gp.x - 12, pipeBot + 82);
    });
    ctx.font = '16px monospace';

    // ── Входной газоход (с 3D стенками) ──
    drawDuct(G.duct.x, G.duct.y, G.duct.w, G.duct.h);
    drawHeatGlow(G.duct.x, G.duct.y, G.duct.w, G.duct.h, T);
    drawFlowStripes(G.duct.x, G.duct.y, G.duct.w, G.duct.h, speed, 'right');
    // Фланцы на входе и выходе газохода
    drawFlange(G.duct.x, G.duct.y, G.duct.h, true);
    drawFlange(G.duct.x + G.duct.w, G.duct.y, G.duct.h, true);

    ctx.fillStyle = COL.dirty; ctx.fillText('ГРЯЗНЫЙ ГАЗ', G.duct.x + 5, G.duct.y - 10);
    const draftVal = O.calcDraft;
    const draftCol = draftVal < -100 ? '#3fb950' : (draftVal < -50 ? '#d29922' : '#f85149');
    ctx.fillStyle = draftCol; ctx.font = '13px monospace';
    ctx.fillText(`Разр: ${Math.round(draftVal)} Па`, G.duct.x + 5, G.duct.y + G.duct.h + 20);

    // ── Реактор (Venturi type) ──
    ctx.fillStyle = COL.wallDk;
    ctx.strokeStyle = COL.wallLt;
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Левая стенка
    ctx.moveTo(G.reactor.x, G.duct.y); 
    ctx.lineTo(G.reactor.x - 20, G.reactor.y + 150); // диффузор
    ctx.lineTo(G.reactor.x - 20, G.reactor.y); // прямая часть к фильтру
    // Верх (переход в ductMid) - оставляем открытым
    ctx.lineTo(G.reactor.x + G.reactor.w + 20, G.reactor.y); 
    // Правая стенка
    ctx.lineTo(G.reactor.x + G.reactor.w + 20, G.reactor.y + 150); // прямая часть
    ctx.lineTo(G.reactor.x + 80, G.duct.y); // сужение к горловине
    // Низ (дно поворота)
    ctx.lineTo(G.reactor.x + 80, G.duct.y + G.duct.h); 
    ctx.lineTo(G.reactor.x, G.duct.y + G.duct.h); 
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    drawHeatGlow(G.reactor.x - 20, G.reactor.y, G.reactor.w + 40, G.duct.y + G.duct.h - G.reactor.y, T);
    ctx.fillStyle = COL.label; ctx.font = '16px monospace'; 
    ctx.fillText('РЕАКТОР', G.reactor.x + 30, G.reactor.y - 5);

    // Завихритель — турбулентные потоки в диффузоре
    ctx.save();
    ctx.strokeStyle = `rgba(88,166,255,${0.15 + speed * 0.2})`;
    ctx.lineWidth = 1.5;
    const rcx = G.reactor.x + G.reactor.w/2, rcy = G.reactor.y + 100;
    for (let s = 0; s < 2; s++) {
        ctx.beginPath();
        for (let a = 0; a < Math.PI * 3; a += 0.1) {
            const r = 5 + a * 15; // более широкий радиус
            if (r > 60) break;
            const x = rcx + Math.cos(a + frameCount * speed * 0.02 + s * Math.PI) * r;
            const y = rcy + Math.sin(a + frameCount * speed * 0.02 + s * Math.PI) * r * 0.6;
            if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = '#8b949e'; ctx.font = '11px monospace';
    ctx.fillText(`τ=${O.contactTime.toFixed(1)}с`, G.reactor.x + G.reactor.w + 25, G.reactor.y + 150);
    ctx.strokeStyle = COL.wall; ctx.lineWidth = 2;

    // ── Силос свежий Al2O3 и течка ──
    ctx.fillStyle = '#111827'; ctx.fillRect(G.siloF.x, G.siloF.y, G.siloF.w, G.siloF.h); 
    ctx.strokeRect(G.siloF.x, G.siloF.y, G.siloF.w, G.siloF.h);
    
    // Наклонная течка в горловину реактора
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.moveTo(G.siloF.x + G.siloF.w/2 - 6, G.siloF.y + G.siloF.h);
    ctx.lineTo(G.reactor.x + 34, G.duct.y - 10);
    ctx.lineTo(G.reactor.x + 46, G.duct.y - 10);
    ctx.lineTo(G.siloF.x + G.siloF.w/2 + 6, G.siloF.y + G.siloF.h);
    ctx.fill();

    ctx.fillStyle = COL.fresh; ctx.font = '12px monospace';
    ctx.fillText(`Al₂O₃ ${I.freshFeed}т/ч`, G.siloF.x - 5, G.siloF.y - 5);

    // ── Аэрожелоб рециркуляции ──
    ctx.strokeStyle = '#fbbf24';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    // Из бункера вниз
    ctx.moveTo(G.hopper.x + G.hopper.w/2, G.hopper.y + G.hopper.h);
    ctx.lineTo(G.hopper.x + G.hopper.w/2, G.chute.midY);
    // Налево к реактору
    ctx.lineTo(G.reactor.x + 40, G.chute.midY);
    // Вверх в инжектор
    ctx.lineTo(G.reactor.x + 40, G.duct.y + G.duct.h - 10);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Подпись аэрожелоба
    ctx.fillStyle = '#fbbf24'; ctx.font = '11px monospace';
    ctx.fillText("АЭРОЖЕЛОБ РЕЦИРКУЛЯЦИИ", G.reactor.x + 100, G.chute.midY + 15);
    ctx.fillText(`AlF₃ ${I.recircFeed}т/ч`, G.reactor.x - 30, G.duct.y + G.duct.h + 20);

    // ── Газоход реактор→фильтр ──
    drawDuct(G.ductMid.x, G.ductMid.y, G.ductMid.w, G.ductMid.h);
    drawFlange(G.ductMid.x, G.ductMid.y, G.ductMid.h, true);
    drawFlange(G.ductMid.x + G.ductMid.w, G.ductMid.y, G.ductMid.h, true);
    drawHeatGlow(G.ductMid.x, G.ductMid.y, G.ductMid.w, G.ductMid.h, T);
    drawFlowStripes(G.ductMid.x, G.ductMid.y, G.ductMid.w, G.ductMid.h, speed, 'right');

    // ── Рукавный фильтр ──
    ctx.fillStyle = COL.fill; ctx.fillRect(G.filter.x, G.filter.y, G.filter.w, G.filter.h);
    // 3D стенки фильтра
    const grFl = ctx.createLinearGradient(G.filter.x, 0, G.filter.x + 5, 0);
    grFl.addColorStop(0, COL.wallLt); grFl.addColorStop(1, '#0d111700');
    ctx.fillStyle = grFl; ctx.fillRect(G.filter.x, G.filter.y, 5, G.filter.h);
    const grFr = ctx.createLinearGradient(G.filter.x + G.filter.w - 5, 0, G.filter.x + G.filter.w, 0);
    grFr.addColorStop(0, '#0d111700'); grFr.addColorStop(1, COL.wallLt);
    ctx.fillStyle = grFr; ctx.fillRect(G.filter.x + G.filter.w - 5, G.filter.y, 5, G.filter.h);
    ctx.strokeStyle = COL.wall; ctx.lineWidth = 2;
    ctx.strokeRect(G.filter.x, G.filter.y, G.filter.w, G.filter.h);
    ctx.fillStyle = COL.label; ctx.font = '16px monospace'; ctx.fillText('РУКАВНЫЙ ФИЛЬТР', G.filter.x + 35, G.filter.y - 8);

    // Рукава по секциям
    const secW = G.filter.w / cfg.numSections;
    state.sections.forEach((sec, si) => {
        const sx = G.filter.x + si * secW;
        const dp01 = Math.min(1, (sec.dp - cfg.baseDP) / (I.regenSP * 1.5 - cfg.baseDP));

        if (sec.isRegen && sec.regenTimer > sec.regenTimerMax - 3) {
            const flashIntensity = (sec.regenTimerMax - sec.regenTimer + 1) / 3;
            ctx.fillStyle = `rgba(88,166,255,${0.15 * (1 - flashIntensity * 0.3)})`;
            ctx.fillRect(sx + 1, G.filter.y + 1, secW - 2, G.filter.h - 2);
        }

        for (let bi = 0; bi < 3; bi++) {
            const bx = sx + secW / 4 * (bi + 1);
            const tornInSec = Math.floor(I.tornBags / cfg.numSections);
            if (bi < tornInSec) {
                ctx.strokeStyle = COL.torn; ctx.lineWidth = 3; ctx.setLineDash([6, 6]);
            } else if (sec.isRegen) {
                ctx.strokeStyle = COL.regen; ctx.lineWidth = 4; ctx.setLineDash([]);
            } else {
                const r = Math.floor(70 + 185 * dp01), g = Math.floor(100 * (1 - dp01)), b = Math.floor(60 * (1 - dp01));
                ctx.strokeStyle = `rgb(${r},${g},${b})`; ctx.lineWidth = 3 + dp01 * 5; ctx.setLineDash([]);
            }
            ctx.beginPath(); ctx.moveTo(bx, G.filter.y + 15); ctx.lineTo(bx, G.filter.y + G.filter.h - 15); ctx.stroke();
            ctx.setLineDash([]);
        }
        if (si > 0) {
            ctx.strokeStyle = '#30363d55'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(sx, G.filter.y); ctx.lineTo(sx, G.filter.y + G.filter.h); ctx.stroke();
        }
    });
    ctx.lineWidth = 2;

    const dpC = O.avgFilterDP > I.regenSP ? COL.torn : (O.avgFilterDP > I.regenSP * 0.8 ? '#d29922' : '#3fb950');
    ctx.fillStyle = dpC; ctx.font = 'bold 15px monospace';
    ctx.fillText(`ΔP: ${O.avgFilterDP.toFixed(2)} кПа`, G.filter.x + 30, G.filter.y + G.filter.h + 22);

    // ── Бункер ──
    ctx.strokeStyle = COL.wall;
    ctx.fillStyle = '#0a0c10';
    ctx.beginPath();
    ctx.moveTo(G.hopper.x, G.hopper.y); ctx.lineTo(G.hopper.x + G.hopper.w, G.hopper.y);
    ctx.lineTo(G.hopper.x + G.hopper.w - 40, G.hopper.y + G.hopper.h);
    ctx.lineTo(G.hopper.x + 40, G.hopper.y + G.hopper.h);
    ctx.closePath(); ctx.fill(); ctx.stroke();



    // ── Газоход фильтр→дымосос ──
    drawDuct(G.ductOut.x, G.ductOut.y, G.ductOut.w, G.ductOut.h);
    drawFlange(G.ductOut.x, G.ductOut.y, G.ductOut.h, true);
    drawFlange(G.ductOut.x + G.ductOut.w, G.ductOut.y, G.ductOut.h, true);
    drawFlowStripes(G.ductOut.x, G.ductOut.y, G.ductOut.w, G.ductOut.h, speed, 'right');

    // ── Дымосос — улитка ──
    const fx = G.fan.x, fy = G.fan.y, fr = G.fan.r;
    drawFanVolute(fx, fy, fr, state);
    ctx.fillStyle = COL.label; ctx.font = '14px monospace'; ctx.fillText('ДЫМОСОС', fx - 32, fy - fr - 18);
    ctx.fillStyle = I.guideVane > 50 ? '#3fb950' : '#d29922'; ctx.font = '12px monospace';
    ctx.fillText(`НА: ${I.guideVane}%`, fx - 20, fy - fr - 4);

    // ── Газоход дымосос→труба ──
    drawDuct(G.ductStack.x, G.ductStack.y, G.ductStack.w, G.ductStack.h);
    drawFlange(G.ductStack.x, G.ductStack.y, G.ductStack.h, true);
    drawFlange(G.ductStack.x + G.ductStack.w, G.ductStack.y, G.ductStack.h, true);
    drawFlowStripes(G.ductStack.x, G.ductStack.y, G.ductStack.w, G.ductStack.h, speed, 'right');

    // ── Дымовая труба (реалистичная!) ──
    drawStackPipe(G.stack.x, G.stack.y, G.stack.w, G.stack.h);
    drawFlowStripes(G.stack.x, G.stack.y, G.stack.w, G.stack.h, speed, 'up');
    ctx.fillStyle = COL.clean; ctx.font = '14px monospace'; ctx.fillText('ДЫМОВАЯ ТРУБА', G.stack.x - 10, G.stack.y - 10);

    // ── Легенда ──
    ctx.font = '11px monospace';
    const leg = [
        [COL.dirty, 'HF+Пыль'], [COL.clean, 'Чистый газ'], [COL.fresh, 'Al₂O₃ свеж.'],
        [COL.fluor, 'AlF₃ рец.'], [COL.dust, 'Проскок пыли'],
    ];
    leg.forEach(([c, t], i) => {
        const lx = 40 + i * 120;
        ctx.fillStyle = c; ctx.fillRect(lx, VH - 35, 8, 8);
        ctx.fillText(t, lx + 12, VH - 27);
    });

    // ── Сжатый воздух ──
    const airCol = P.receiverPressure > 0.5 ? '#3fb950' : (P.receiverPressure > 0.35 ? '#d29922' : '#f85149');
    ctx.fillStyle = airCol; ctx.font = '11px monospace';
    ctx.fillText(`🌬 Ресивер: ${P.receiverPressure.toFixed(2)} МПа`, G.filter.x + 30, G.filter.y + G.filter.h + 42);
}
