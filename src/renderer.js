// ═══════════════════════════════════════════════════════════════════════
//  ANTIGRAVITY СГОУ — CANVAS RENDERER
//  Виртуальные координаты 1600×900, масштабируется CSS aspect-ratio.
//  Отрисовка оборудования + частицы + рециркуляция + индикатор НА.
// ═══════════════════════════════════════════════════════════════════════

// Виртуальное разрешение (фиксированное)
const VW = 1600, VH = 900;

// Цвета
const COL = {
    bg:    '#05070a',
    wall:  '#2d333b',
    fill:  '#0d1117',
    label: '#6e7681',
    dirty: '#ef4444',
    clean: '#34d399',
    fresh: '#e2e8f0',
    fluor: '#fbbf24',
    dust:  '#fb923c',
    recirc:'#fbbf24',
    regen: '#58a6ff',
    torn:  '#f85149',
};

// Геометрия оборудования (в виртуальных пикселях)
const G = {
    // Входные трубы от корпусов (4 шт, внизу слева)
    pipes: [
        { x: 60,  y: 610 }, // 1A
        { x: 140, y: 610 }, // 1B
        { x: 230, y: 610 }, // 2A
        { x: 310, y: 610 }, // 2B
    ],
    // Главный газоход
    duct:     { x: 40,  y: 370, w: 310, h: 80 },
    // Реактор
    reactor:  { x: 350, y: 170, w: 180, h: 460 },
    // Силос свежий
    siloF:    { x: 355, y: 18,  w: 75,  h: 120 },
    // Силос рецирк.
    siloR:    { x: 455, y: 18,  w: 75,  h: 120 },
    // Газоход реактор→фильтр
    ductMid:  { x: 530, y: 360, w: 100, h: 90 },
    // Рукавный фильтр
    filter:   { x: 630, y: 130, w: 290, h: 450 },
    // Бункер
    hopper:   { x: 660, y: 600, w: 230, h: 140 },
    // Газоход фильтр→дымосос
    ductOut:  { x: 920, y: 370, w: 120, h: 80 },
    // Дымосос
    fan:      { x: 1100, y: 410, r: 55 },
    // Газоход дымосос→труба
    ductStack:{ x: 1155, y: 370, w: 145, h: 80 },
    // Труба
    stack:    { x: 1300, y: 40,  w: 110, h: 770 },
    // Аэрожелоб (путь рециркуляции)
    chute:    { midY: 800 },
};

// ── Частицы ──
const particles = [];

class Particle {
    constructor(type, x, y, vx, vy) {
        this.type = type; this.x = x; this.y = y;
        this.vx = vx; this.vy = vy;
        this.alive = true; this.life = 1.0;
        this.phase = 'normal';
    }
}

function updateParticle(p, speedMul, effHF) {
    const s = Math.max(0.05, speedMul);

    // Рециркуляция
    if (p.type === 'recirc_return') {
        switch (p.phase) {
            case 'hopper': p.y += 2; if (p.y > G.chute.midY - 10) { p.phase = 'left'; } break;
            case 'left':   p.x -= 3.5; if (p.x < G.siloR.x + 40) { p.phase = 'up'; } break;
            case 'up':     p.y -= 3.5; if (p.y < G.siloR.y + G.siloR.h) p.alive = false; break;
        }
        return;
    }
    if (p.type === 'fugitive') {
        p.x += p.vx; p.y += p.vy; p.life -= 0.015;
        if (p.life <= 0) p.alive = false;
        return;
    }
    if (p.type === 'fresh' || p.type === 'fluor') {
        p.x += p.vx; p.y += p.vy;
    } else {
        p.x += p.vx * s; p.y += p.vy * s;
    }

    // Реактор
    if (p.x > G.reactor.x && p.x < G.reactor.x + G.reactor.w) {
        if (p.type === 'dirty') {
            p.vy += (Math.random() - 0.5) * 0.8;
            if (p.y < G.reactor.y + 20) p.vy = Math.abs(p.vy);
            if (p.y > G.reactor.y + G.reactor.h - 20) p.vy = -Math.abs(p.vy);
        }
        if ((p.type === 'fresh' || p.type === 'fluor') && p.y > G.reactor.y + G.reactor.h * 0.4) {
            p.vx = 2 * s; p.vy = (Math.random() - 0.5) * 0.5;
        }
    }
    // Газоход→фильтр
    if (p.x > G.ductMid.x && p.x < G.ductMid.x + G.ductMid.w) {
        if (p.type === 'fresh' || p.type === 'fluor') p.vx = 3 * s;
    }
    // Фильтр
    if (p.x > G.filter.x && p.x < G.filter.x + G.filter.w) {
        if (p.type === 'dirty') {
            if (Math.random() * 100 < effHF) {
                p.type = 'clean'; p.vx = 3; p.vy = (Math.random() - 0.5) * 0.5;
            } else p.vx = 3;
        }
        if (p.type === 'fresh' || p.type === 'fluor') {
            p.vx = 0; p.vy = 1.5;
            if (p.y > G.filter.y + G.filter.h) p.alive = false;
        }
    }
    // К дымососу
    if (p.x > G.ductOut.x && p.x < G.fan.x + G.fan.r) {
        const ty = G.fan.y; p.vy += (ty - p.y) * 0.05 * s;
    }
    // Труба
    if (p.x > G.stack.x) { p.vx *= 0.92; p.vy = -4 * s; }

    if (p.x > VW + 20 || p.x < -20 || p.y < -20 || p.y > VH + 20) p.alive = false;
}

function drawParticle(ctx, p) {
    ctx.beginPath();
    let r = 3, col = '#fff';
    switch (p.type) {
        case 'dirty':        col = COL.dirty; r = 4; break;
        case 'clean':        col = COL.clean; r = 3; break;
        case 'fresh':        col = COL.fresh; r = 2.5; break;
        case 'fluor':        col = COL.fluor; r = 2.5; break;
        case 'dust':         col = COL.dust;  r = 3; break;
        case 'fugitive':     col = `rgba(239,68,68,${p.life})`; r = 4; break;
        case 'recirc_return':col = COL.recirc; r = 2.5; break;
    }
    ctx.fillStyle = col;
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
}

// ── Эмиссия частиц ──
function emitParticles(state) {
    const O = state.out;
    const I = state.inputs;
    const f = O.gasFlow;
    const em = Math.min(2, f / 200000);

    // Грязный газ (из труб → газоход → реактор)
    if (f > 0) {
        state.inputs.pipes.forEach((pipe, i) => {
            const pf = O.pipeFlows[i];
            const gp = G.pipes[i];
            if (pf.fugitive && Math.random() < 0.15) {
                particles.push(new Particle('fugitive', gp.x, gp.y, (Math.random()-0.5)*2.5, -2.5-Math.random()*2));
            }
            if (pf.flow > 0 && Math.random() < 0.25 * (pipe.damper/100)) {
                const p = new Particle('dirty', gp.x, gp.y, 0, -3);
                p.phase = 'pipe';
                particles.push(p);
            }
        });
        // Из газохода в реактор
        if (Math.random() < em * 0.3) {
            particles.push(new Particle('dirty', G.duct.x + G.duct.w, G.duct.y + G.duct.h/2 + (Math.random()-0.5)*30, 3, 0));
        }
    }

    // Свежий глинозём
    if (I.freshFeed > 0 && Math.random() < I.freshFeed / 8) {
        particles.push(new Particle('fresh', G.siloF.x + G.siloF.w/2, G.siloF.y + G.siloF.h, 0, 2));
    }
    // Рецирк.
    if (I.recircFeed > 0 && Math.random() < I.recircFeed / 30) {
        particles.push(new Particle('fluor', G.siloR.x + G.siloR.w/2, G.siloR.y + G.siloR.h, 0, 2));
    }
    // Пыль через порванные рукава
    if (I.tornBags > 0 && f > 0 && Math.random() < I.tornBags * 0.012) {
        particles.push(new Particle('dust', G.filter.x + Math.random()*G.filter.w, G.filter.y + Math.random()*G.filter.h*0.6, 3, (Math.random()-0.5)*1.5));
    }
    // Рециркуляция (бункер → аэрожелоб → силос)
    if (f > 0 && Math.random() < 0.07) {
        const p = new Particle('recirc_return', G.hopper.x + G.hopper.w/2 + (Math.random()-0.5)*40, G.hopper.y, 0, 0);
        p.phase = 'hopper';
        particles.push(p);
    }

    while (particles.length > 900) particles.shift();
}

// ── Контекст канваса и масштаб ──
let canvas, ctx;

export function initRenderer(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    canvas.width = VW;
    canvas.height = VH;
}

export function render(state, config) {
    if (!ctx) return;
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, VW, VH);

    drawEquipment(state, config);
    emitParticles(state);

    const spd = state.out.gasFlow / 200000;
    const effHF = state.out.effHF;
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];

        // Труба → газоход: переход частиц из вертикальной трубы в горизонтальный газоход
        if (p.phase === 'pipe' && p.y <= G.duct.y + G.duct.h / 2) {
            p.y = G.duct.y + G.duct.h / 2;
            p.vy = 0; p.vx = 3;
            p.phase = 'normal';
        }

        updateParticle(p, spd, effHF);
        drawParticle(ctx, p);
        if (!p.alive) particles.splice(i, 1);
    }
}

/** Визуальный «взрыв» при прорыве рукава */
export function burstDust() {
    for (let i = 0; i < 20; i++) {
        particles.push(new Particle('dust',
            G.filter.x + Math.random() * G.filter.w,
            G.filter.y + G.filter.h * 0.3 + Math.random() * G.filter.h * 0.4,
            4 + Math.random() * 4, (Math.random() - 0.5) * 5));
    }
}

// ── Отрисовка оборудования ──
function drawEquipment(state, cfg) {
    const I = state.inputs;
    const O = state.out;
    const P = state.phys;
    ctx.lineWidth = 2; ctx.strokeStyle = COL.wall; ctx.font = '16px monospace';

    // ── Трубы от корпусов ──
    G.pipes.forEach((gp, i) => {
        const pf = O.pipeFlows[i];
        ctx.fillStyle = COL.fill;
        ctx.fillRect(gp.x - 25, gp.y, 50, 50); ctx.strokeRect(gp.x - 25, gp.y, 50, 50);
        ctx.fillStyle = pf.fugitive ? COL.torn : COL.label;
        ctx.font = '11px monospace';
        ctx.fillText(I.pipes[i].id, gp.x - 8, gp.y + 45);
        ctx.fillText(`${I.pipes[i].damper}%`, gp.x - 10, gp.y + 65);
        // Вертикальная труба
        ctx.strokeStyle = pf.fugitive ? '#f8514955' : COL.wall;
        ctx.beginPath(); ctx.moveTo(gp.x, gp.y); ctx.lineTo(gp.x, G.duct.y + G.duct.h); ctx.stroke();
        ctx.strokeStyle = COL.wall;
    });
    ctx.font = '16px monospace';

    // ── Входной газоход ──
    ctx.fillStyle = COL.fill; ctx.fillRect(G.duct.x, G.duct.y, G.duct.w, G.duct.h); ctx.strokeRect(G.duct.x, G.duct.y, G.duct.w, G.duct.h);
    ctx.fillStyle = COL.dirty; ctx.fillText('ГРЯЗНЫЙ ГАЗ', G.duct.x + 5, G.duct.y - 8);
    const draftCol = I.inletDraft < -100 ? '#3fb950' : (I.inletDraft < -50 ? '#d29922' : '#f85149');
    ctx.fillStyle = draftCol; ctx.font = '13px monospace';
    ctx.fillText(`Разр: ${I.inletDraft} Па`, G.duct.x + 5, G.duct.y + G.duct.h + 18);

    // ── Реактор ──
    ctx.fillStyle = COL.fill; ctx.fillRect(G.reactor.x, G.reactor.y, G.reactor.w, G.reactor.h);
    ctx.strokeRect(G.reactor.x, G.reactor.y, G.reactor.w, G.reactor.h);
    ctx.fillStyle = COL.label; ctx.font = '16px monospace'; ctx.fillText('РЕАКТОР', G.reactor.x + 35, G.reactor.y - 5);
    // Завихритель
    ctx.strokeStyle = '#30363d'; ctx.setLineDash([3, 3]);
    for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.arc(G.reactor.x + G.reactor.w/2, G.reactor.y + G.reactor.h/2, 15 + i * 15, 0, Math.PI * 1.5); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.strokeStyle = COL.wall;

    // ── Силос свежий ──
    ctx.fillStyle = '#111827'; ctx.fillRect(G.siloF.x, G.siloF.y, G.siloF.w, G.siloF.h); ctx.strokeRect(G.siloF.x, G.siloF.y, G.siloF.w, G.siloF.h);
    ctx.strokeStyle = COL.fresh; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(G.siloF.x + G.siloF.w/2, G.siloF.y + G.siloF.h); ctx.lineTo(G.siloF.x + G.siloF.w/2, G.reactor.y); ctx.stroke();
    ctx.strokeStyle = COL.wall; ctx.lineWidth = 2;
    ctx.fillStyle = COL.fresh; ctx.font = '12px monospace';
    ctx.fillText(`Al₂O₃ ${I.freshFeed}т/ч`, G.siloF.x - 5, G.siloF.y - 5);

    // ── Силос рецирк. ──
    ctx.fillStyle = '#1a1500'; ctx.fillRect(G.siloR.x, G.siloR.y, G.siloR.w, G.siloR.h); ctx.strokeRect(G.siloR.x, G.siloR.y, G.siloR.w, G.siloR.h);
    ctx.strokeStyle = COL.fluor; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(G.siloR.x + G.siloR.w/2, G.siloR.y + G.siloR.h); ctx.lineTo(G.siloR.x + G.siloR.w/2, G.reactor.y); ctx.stroke();
    ctx.strokeStyle = COL.wall; ctx.lineWidth = 2;
    ctx.fillStyle = COL.fluor; ctx.font = '12px monospace';
    ctx.fillText(`AlF₃ ${I.recircFeed}т/ч`, G.siloR.x - 5, G.siloR.y - 5);

    // ── Газоход реактор→фильтр ──
    ctx.fillStyle = COL.fill; ctx.fillRect(G.ductMid.x, G.ductMid.y, G.ductMid.w, G.ductMid.h);
    ctx.strokeRect(G.ductMid.x, G.ductMid.y, G.ductMid.w, G.ductMid.h);

    // ── Рукавный фильтр ──
    ctx.fillStyle = COL.fill; ctx.fillRect(G.filter.x, G.filter.y, G.filter.w, G.filter.h);
    ctx.strokeRect(G.filter.x, G.filter.y, G.filter.w, G.filter.h);
    ctx.fillStyle = COL.label; ctx.font = '16px monospace'; ctx.fillText('РУКАВНЫЙ ФИЛЬТР', G.filter.x + 35, G.filter.y - 8);

    // Рукава по секциям
    const secW = G.filter.w / cfg.numSections;
    state.sections.forEach((sec, si) => {
        const sx = G.filter.x + si * secW;
        const dp01 = Math.min(1, (sec.dp - cfg.baseDP) / (I.regenSP * 1.5 - cfg.baseDP));

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
        // Разделители
        if (si > 0) {
            ctx.strokeStyle = '#30363d55'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(sx, G.filter.y); ctx.lineTo(sx, G.filter.y + G.filter.h); ctx.stroke();
        }
    });
    ctx.lineWidth = 2;

    // ΔP label на фильтре
    const dpC = O.avgFilterDP > I.regenSP ? COL.torn : (O.avgFilterDP > I.regenSP * 0.8 ? '#d29922' : '#3fb950');
    ctx.fillStyle = dpC; ctx.font = 'bold 15px monospace';
    ctx.fillText(`ΔP: ${O.avgFilterDP.toFixed(2)} кПа`, G.filter.x + 30, G.filter.y + G.filter.h + 22);

    // ── Бункер ──
    ctx.strokeStyle = COL.wall;
    ctx.beginPath();
    ctx.moveTo(G.hopper.x, G.hopper.y); ctx.lineTo(G.hopper.x + G.hopper.w, G.hopper.y);
    ctx.lineTo(G.hopper.x + G.hopper.w - 40, G.hopper.y + G.hopper.h);
    ctx.lineTo(G.hopper.x + 40, G.hopper.y + G.hopper.h);
    ctx.closePath(); ctx.stroke();

    // ── Аэрожелоб рециркуляции ──
    ctx.strokeStyle = '#fbbf2455'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(G.hopper.x + G.hopper.w / 2, G.hopper.y + G.hopper.h);
    ctx.lineTo(G.hopper.x + G.hopper.w / 2, G.chute.midY);
    ctx.lineTo(G.siloR.x + G.siloR.w / 2, G.chute.midY);
    ctx.lineTo(G.siloR.x + G.siloR.w / 2, G.siloR.y + G.siloR.h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COL.fluor; ctx.font = '11px monospace';
    ctx.fillText('АЭРОЖЕЛОБ РЕЦИРКУЛЯЦИИ', G.siloR.x + G.siloR.w + 10, G.chute.midY + 4);
    ctx.strokeStyle = COL.wall; ctx.lineWidth = 2;

    // ── Газоход фильтр→дымосос ──
    ctx.fillStyle = COL.fill; ctx.fillRect(G.ductOut.x, G.ductOut.y, G.ductOut.w, G.ductOut.h);
    ctx.strokeRect(G.ductOut.x, G.ductOut.y, G.ductOut.w, G.ductOut.h);

    // ── Дымосос + НА ──
    const fx = G.fan.x, fy = G.fan.y, fr = G.fan.r;
    ctx.beginPath(); ctx.arc(fx, fy, fr, 0, Math.PI * 2); ctx.fillStyle = COL.fill; ctx.fill();
    ctx.strokeStyle = I.fanRPM > 0 ? '#58a6ff' : COL.torn; ctx.stroke();

    // Дуга НА
    const vaneAngle = (I.guideVane / 100) * Math.PI * 2;
    ctx.beginPath(); ctx.arc(fx, fy, fr + 8, 0, vaneAngle);
    ctx.strokeStyle = I.guideVane > 50 ? '#3fb950' : (I.guideVane > 20 ? '#d29922' : '#f85149');
    ctx.lineWidth = 4; ctx.stroke(); ctx.lineWidth = 2; ctx.strokeStyle = COL.wall;

    ctx.fillStyle = COL.label; ctx.font = '14px monospace'; ctx.fillText('ДЫМОСОС', fx - 32, fy - fr - 18);
    ctx.fillStyle = I.guideVane > 50 ? '#3fb950' : '#d29922'; ctx.font = '12px monospace';
    ctx.fillText(`НА: ${I.guideVane}%`, fx - 20, fy - fr - 4);

    // Лопасти
    ctx.save(); ctx.translate(fx, fy); ctx.rotate(P.fanAngle);
    ctx.strokeStyle = I.fanRPM > 0 ? '#58a6ff' : COL.label; ctx.lineWidth = 3;
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(fr - 5, 0); ctx.stroke(); ctx.rotate(Math.PI / 3); }
    ctx.restore(); ctx.strokeStyle = COL.wall; ctx.lineWidth = 2;

    // ── Газоход дымосос→труба ──
    ctx.fillStyle = COL.fill; ctx.fillRect(G.ductStack.x, G.ductStack.y, G.ductStack.w, G.ductStack.h);
    ctx.strokeRect(G.ductStack.x, G.ductStack.y, G.ductStack.w, G.ductStack.h);

    // ── Труба ──
    ctx.fillStyle = COL.fill; ctx.fillRect(G.stack.x, G.stack.y, G.stack.w, G.stack.h);
    ctx.strokeRect(G.stack.x, G.stack.y, G.stack.w, G.stack.h);
    ctx.fillStyle = COL.clean; ctx.font = '14px monospace'; ctx.fillText('ТРУБА', G.stack.x + 15, G.stack.y - 8);

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

    // ── Сжатый воздух (индикатор) ──
    ctx.fillStyle = COL.label; ctx.font = '11px monospace';
    const airCol = P.receiverPressure > 0.5 ? '#3fb950' : (P.receiverPressure > 0.35 ? '#d29922' : '#f85149');
    ctx.fillStyle = airCol;
    ctx.fillText(`🌬 Ресивер: ${P.receiverPressure.toFixed(2)} МПа`, G.filter.x + 30, G.filter.y + G.filter.h + 42);
}
