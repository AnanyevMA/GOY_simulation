// ═══════════════════════════════════════════════════════════════════════
//  ANTIGRAVITY СГОУ — CANVAS RENDERER v4.1
//  Полосы потока, glow перегрева, турбулентность, импульс продувки,
//  частицы ∝ расходу, улитка дымососа, тепловая дымка.
// ═══════════════════════════════════════════════════════════════════════

const VW = 1600, VH = 900;

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

const G = {
    pipes: [
        { x: 60,  y: 610 },
        { x: 140, y: 610 },
        { x: 230, y: 610 },
        { x: 310, y: 610 },
    ],
    duct:     { x: 40,  y: 370, w: 310, h: 80 },
    reactor:  { x: 350, y: 170, w: 180, h: 460 },
    siloF:    { x: 355, y: 18,  w: 75,  h: 120 },
    siloR:    { x: 455, y: 18,  w: 75,  h: 120 },
    ductMid:  { x: 530, y: 360, w: 100, h: 90 },
    filter:   { x: 630, y: 130, w: 290, h: 450 },
    hopper:   { x: 660, y: 600, w: 230, h: 140 },
    ductOut:  { x: 920, y: 370, w: 120, h: 80 },
    fan:      { x: 1100, y: 410, r: 55 },
    ductStack:{ x: 1155, y: 370, w: 145, h: 80 },
    stack:    { x: 1300, y: 40,  w: 110, h: 770 },
    chute:    { midY: 800 },
};

// ── Частицы ──
const particles = [];
let frameCount = 0; // Для анимации полос потока

class Particle {
    constructor(type, x, y, vx, vy) {
        this.type = type; this.x = x; this.y = y;
        this.vx = vx; this.vy = vy;
        this.alive = true; this.life = 1.0;
        this.phase = 'normal';
        this.size = 3;
        this.turbulence = 0; // Для турбулентности в реакторе
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
    // Импульсный выброс при продувке
    if (p.type === 'pulse_blast') {
        p.x += p.vx; p.y += p.vy;
        p.vy += 0.15; // Гравитация — пыль падает
        p.life -= 0.025;
        if (p.life <= 0) p.alive = false;
        return;
    }

    if (p.type === 'fresh' || p.type === 'fluor') {
        p.x += p.vx; p.y += p.vy;
    } else {
        p.x += p.vx * s; p.y += p.vy * s;
    }

    // [FIX C] Турбулентность в реакторе
    if (p.x > G.reactor.x && p.x < G.reactor.x + G.reactor.w) {
        if (p.type === 'dirty') {
            // Сильная турбулентность — вихревое движение
            p.turbulence += 0.08;
            const tForce = Math.sin(p.turbulence) * 1.2 + (Math.random() - 0.5) * 0.6;
            p.vy += tForce * 0.3;
            p.vx += (Math.random() - 0.5) * 0.4;
            if (p.y < G.reactor.y + 20) p.vy = Math.abs(p.vy) * 0.8;
            if (p.y > G.reactor.y + G.reactor.h - 20) p.vy = -Math.abs(p.vy) * 0.8;
        }
        if ((p.type === 'fresh' || p.type === 'fluor') && p.y > G.reactor.y + G.reactor.h * 0.3) {
            // Глинозём подхватывается потоком и закручивается
            p.vx = 1.5 * s + Math.sin(p.turbulence || 0) * 0.5;
            p.vy = (Math.random() - 0.5) * 1.0;
            p.turbulence = (p.turbulence || 0) + 0.1;
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
                p.size = 2.5;
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
    let r = p.size || 3, col = '#fff';
    switch (p.type) {
        case 'dirty':        col = COL.dirty; r = 4; break;
        case 'clean':        col = COL.clean; r = 2.5; break;
        case 'fresh':        col = COL.fresh; r = 2.5; break;
        case 'fluor':        col = COL.fluor; r = 2.5; break;
        case 'dust':         col = COL.dust;  r = 3; break;
        case 'fugitive':     col = `rgba(239,68,68,${p.life})`; r = 4; break;
        case 'recirc_return':col = COL.recirc; r = 2.5; break;
        case 'pulse_blast':  col = `rgba(88,166,255,${p.life * 0.8})`; r = 3 + (1 - p.life) * 4; break;
    }
    ctx.fillStyle = col;
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
}

// ── [FIX E] Эмиссия частиц ∝ расходу ──
function emitParticles(state) {
    const O = state.out;
    const I = state.inputs;
    const C = 350000; // номинал
    const emitRate = O.gasFlow > 0 ? Math.min(1.5, O.gasFlow / C) : 0;

    // Грязный газ (из труб → газоход → реактор)
    if (O.gasFlow > 0) {
        state.inputs.pipes.forEach((pipe, i) => {
            const pf = O.pipeFlows[i];
            const gp = G.pipes[i];
            if (pf.fugitive && Math.random() < 0.15) {
                particles.push(new Particle('fugitive', gp.x, gp.y, (Math.random()-0.5)*2.5, -2.5-Math.random()*2));
            }
            // [FIX E] Количество частиц ∝ расходу × шибер
            if (pf.flow > 0 && Math.random() < emitRate * 0.25 * (pipe.damper/100)) {
                const p = new Particle('dirty', gp.x, gp.y, 0, -3);
                p.phase = 'pipe';
                particles.push(p);
            }
        });
        // Из газохода в реактор — тоже ∝ расходу
        if (Math.random() < emitRate * 0.3) {
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
    if (I.tornBags > 0 && O.gasFlow > 0 && Math.random() < I.tornBags * 0.012) {
        particles.push(new Particle('dust', G.filter.x + Math.random()*G.filter.w, G.filter.y + Math.random()*G.filter.h*0.6, 3, (Math.random()-0.5)*1.5));
    }
    // Рециркуляция
    if (O.gasFlow > 0 && Math.random() < 0.07) {
        const p = new Particle('recirc_return', G.hopper.x + G.hopper.w/2 + (Math.random()-0.5)*40, G.hopper.y, 0, 0);
        p.phase = 'hopper';
        particles.push(p);
    }

    // [FIX D] Импульс продувки — визуальный выброс при регенерации
    if (O.pulseFlash) {
        O.pulseFlash.forEach((flash, si) => {
            if (flash) {
                const secW = G.filter.w / 4;
                const sx = G.filter.x + si * secW + secW / 2;
                for (let j = 0; j < 15; j++) {
                    const p = new Particle('pulse_blast',
                        sx + (Math.random()-0.5) * secW * 0.6,
                        G.filter.y + 30 + Math.random() * G.filter.h * 0.7,
                        (Math.random()-0.5) * 3,
                        2 + Math.random() * 3
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
        if (p.phase === 'pipe' && p.y <= G.duct.y + G.duct.h / 2) {
            p.y = G.duct.y + G.duct.h / 2;
            p.vy = 0; p.vx = 3;
            p.phase = 'normal';
        }
        updateParticle(p, spd, effHF);
        drawParticle(ctx, p);
        if (!p.alive) particles.splice(i, 1);
    }

    // [FIX G] Тепловая дымка на трубе при высокой температуре
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
//  [FIX A] Анимированные полосы потока в газоходах
// ══════════════════════════════════════════════════════════════════════
function drawFlowStripes(x, y, w, h, speed, direction = 'right') {
    if (speed < 0.01) return;
    const intensity = Math.min(1, speed * 1.5);
    ctx.save();
    ctx.globalAlpha = 0.12 + intensity * 0.15;
    ctx.strokeStyle = '#58a6ff';
    ctx.lineWidth = 1;

    const spacing = 25;
    const offset = (frameCount * speed * 3) % spacing;
    const count = Math.ceil(w / spacing) + 2;

    for (let i = -1; i < count; i++) {
        let sx;
        if (direction === 'right') {
            sx = x + i * spacing + offset;
        } else if (direction === 'left') {
            sx = x + w - i * spacing - offset;
        } else { // up
            const sy = y + h - i * spacing - offset;
            if (sy < y || sy > y + h) continue;
            ctx.beginPath();
            ctx.moveTo(x + 4, sy);
            ctx.lineTo(x + w - 4, sy);
            ctx.stroke();
            continue;
        }
        if (sx < x || sx > x + w) continue;
        ctx.beginPath();
        ctx.moveTo(sx, y + 4);
        ctx.lineTo(sx, y + h - 4);
        ctx.stroke();
    }
    ctx.restore();
}

// ══════════════════════════════════════════════════════════════════════
//  [FIX B] Glow-эффект перегрева
// ══════════════════════════════════════════════════════════════════════
function drawHeatGlow(x, y, w, h, temp) {
    if (temp < 120) return;
    const intensity = Math.min(1, (temp - 120) / 80); // 0 при 120, 1 при 200
    ctx.save();
    // Внутреннее свечение
    const grd = ctx.createLinearGradient(x, y, x, y + h);
    grd.addColorStop(0, `rgba(255, ${Math.floor(100 - intensity * 70)}, 0, ${intensity * 0.15})`);
    grd.addColorStop(0.5, `rgba(255, ${Math.floor(60 - intensity * 40)}, 0, ${intensity * 0.25})`);
    grd.addColorStop(1, `rgba(255, ${Math.floor(100 - intensity * 70)}, 0, ${intensity * 0.15})`);
    ctx.fillStyle = grd;
    ctx.fillRect(x, y, w, h);

    // Внешнее свечение (outline glow)
    if (intensity > 0.3) {
        ctx.shadowColor = `rgba(255, 80, 0, ${intensity * 0.5})`;
        ctx.shadowBlur = 10 + intensity * 15;
        ctx.strokeStyle = `rgba(255, 100, 30, ${intensity * 0.4})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
        ctx.shadowBlur = 0;
    }
    ctx.restore();
}

// ══════════════════════════════════════════════════════════════════════
//  [FIX G] Тепловая дымка на трубе
// ══════════════════════════════════════════════════════════════════════
function drawHeatHaze(state) {
    const T = state.out.actualTemp;
    if (T < 90) return;
    const intensity = Math.min(1, (T - 80) / 120);
    const stackTop = G.stack.y;
    const cx = G.stack.x + G.stack.w / 2;

    ctx.save();
    ctx.globalAlpha = intensity * 0.35;
    // Волнистый тепловой «мираж» выходящий из трубы
    for (let i = 0; i < 4; i++) {
        const waveX = cx + Math.sin(frameCount * 0.03 + i * 1.5) * (8 + i * 5);
        const waveY = stackTop - 10 - i * 12;
        const r = 10 + i * 6 + Math.sin(frameCount * 0.05 + i) * 3;
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
//  [FIX F] Улитка дымососа
// ══════════════════════════════════════════════════════════════════════
function drawFanVolute(fx, fy, fr, state) {
    const I = state.inputs;
    const P = state.phys;

    // Корпус-улитка (спиральный кожух)
    ctx.save();
    ctx.beginPath();
    // Спираль: от входа (слева) закручивается и выходит вверх-вправо
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * Math.PI * 1.8; // 324°
        const r = fr + 4 + (i / steps) * 15; // Расширяющийся
        const x = fx + Math.cos(t - Math.PI * 0.5) * r;
        const y = fy + Math.sin(t - Math.PI * 0.5) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    // Выходной патрубок (прямой, вправо)
    const lastR = fr + 4 + 15;
    ctx.lineTo(fx + lastR + 20, fy - fr * 0.3);
    ctx.strokeStyle = I.fanRPM > 0 ? '#3d5a80' : COL.torn;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Заливка корпуса
    ctx.fillStyle = '#0a0f18';
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(fx, fy, fr + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Дуга НА (направляющий аппарат)
    const vaneAngle = (I.guideVane / 100) * Math.PI * 2;
    ctx.beginPath(); ctx.arc(fx, fy, fr + 8, 0, vaneAngle);
    ctx.strokeStyle = I.guideVane > 50 ? '#3fb950' : (I.guideVane > 20 ? '#d29922' : '#f85149');
    ctx.lineWidth = 4; ctx.stroke();

    // Лопасти рабочего колеса (загнутые назад — как у реального центробежного)
    ctx.translate(fx, fy);
    ctx.rotate(P.fanAngle);
    const bladeCount = 8;
    for (let i = 0; i < bladeCount; i++) {
        const a = (i / bladeCount) * Math.PI * 2;
        ctx.save();
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(8, 0);
        // Кривая лопатка: загнутая назад
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
    const speed = O.gasFlow / 350000; // 0..~1.2

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
        // [A] Полосы потока в вертикальных трубах
        if (pf.flow > 0) {
            drawFlowStripes(gp.x - 12, gp.y, 24, G.duct.y + G.duct.h - gp.y, speed * (I.pipes[i].damper/100), 'up');
        }
        ctx.strokeStyle = COL.wall;
    });
    ctx.font = '16px monospace';

    // ── Входной газоход ──
    ctx.fillStyle = COL.fill; ctx.fillRect(G.duct.x, G.duct.y, G.duct.w, G.duct.h); ctx.strokeRect(G.duct.x, G.duct.y, G.duct.w, G.duct.h);
    // [B] Тепловое свечение газохода
    drawHeatGlow(G.duct.x, G.duct.y, G.duct.w, G.duct.h, T);
    // [A] Полосы потока
    drawFlowStripes(G.duct.x, G.duct.y, G.duct.w, G.duct.h, speed, 'right');

    ctx.fillStyle = COL.dirty; ctx.fillText('ГРЯЗНЫЙ ГАЗ', G.duct.x + 5, G.duct.y - 8);
    // Расчётное разрежение
    const draftVal = O.calcDraft;
    const draftCol = draftVal < -100 ? '#3fb950' : (draftVal < -50 ? '#d29922' : '#f85149');
    ctx.fillStyle = draftCol; ctx.font = '13px monospace';
    ctx.fillText(`Разр: ${Math.round(draftVal)} Па`, G.duct.x + 5, G.duct.y + G.duct.h + 18);

    // ── Реактор ──
    ctx.fillStyle = COL.fill; ctx.fillRect(G.reactor.x, G.reactor.y, G.reactor.w, G.reactor.h);
    ctx.strokeRect(G.reactor.x, G.reactor.y, G.reactor.w, G.reactor.h);
    drawHeatGlow(G.reactor.x, G.reactor.y, G.reactor.w, G.reactor.h, T);
    ctx.fillStyle = COL.label; ctx.font = '16px monospace'; ctx.fillText('РЕАКТОР', G.reactor.x + 35, G.reactor.y - 5);
    // Завихритель — двойная спираль
    ctx.save();
    ctx.strokeStyle = `rgba(88,166,255,${0.15 + speed * 0.2})`;
    ctx.lineWidth = 1.5;
    const rcx = G.reactor.x + G.reactor.w/2, rcy = G.reactor.y + G.reactor.h/2;
    for (let s = 0; s < 2; s++) {
        ctx.beginPath();
        for (let a = 0; a < Math.PI * 3; a += 0.1) {
            const r = 5 + a * 10;
            const x = rcx + Math.cos(a + frameCount * speed * 0.02 + s * Math.PI) * r;
            const y = rcy + Math.sin(a + frameCount * speed * 0.02 + s * Math.PI) * r * 0.6;
            if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            if (r > 80) break;
        }
        ctx.stroke();
    }
    ctx.restore();
    // Время контакта
    ctx.fillStyle = '#8b949e'; ctx.font = '11px monospace';
    ctx.fillText(`τ=${O.contactTime.toFixed(1)}с`, G.reactor.x + 60, G.reactor.y + G.reactor.h - 10);
    ctx.strokeStyle = COL.wall; ctx.lineWidth = 2;

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
    drawHeatGlow(G.ductMid.x, G.ductMid.y, G.ductMid.w, G.ductMid.h, T);
    drawFlowStripes(G.ductMid.x, G.ductMid.y, G.ductMid.w, G.ductMid.h, speed, 'right');

    // ── Рукавный фильтр ──
    ctx.fillStyle = COL.fill; ctx.fillRect(G.filter.x, G.filter.y, G.filter.w, G.filter.h);
    ctx.strokeRect(G.filter.x, G.filter.y, G.filter.w, G.filter.h);
    ctx.fillStyle = COL.label; ctx.font = '16px monospace'; ctx.fillText('РУКАВНЫЙ ФИЛЬТР', G.filter.x + 35, G.filter.y - 8);

    // Рукава по секциям
    const secW = G.filter.w / cfg.numSections;
    state.sections.forEach((sec, si) => {
        const sx = G.filter.x + si * secW;
        const dp01 = Math.min(1, (sec.dp - cfg.baseDP) / (I.regenSP * 1.5 - cfg.baseDP));

        // [D] Пульсация фона при регенерации
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

    // ΔP label
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
    drawFlowStripes(G.ductOut.x, G.ductOut.y, G.ductOut.w, G.ductOut.h, speed, 'right');

    // ── [F] Дымосос — улитка ──
    const fx = G.fan.x, fy = G.fan.y, fr = G.fan.r;
    drawFanVolute(fx, fy, fr, state);
    ctx.fillStyle = COL.label; ctx.font = '14px monospace'; ctx.fillText('ДЫМОСОС', fx - 32, fy - fr - 18);
    ctx.fillStyle = I.guideVane > 50 ? '#3fb950' : '#d29922'; ctx.font = '12px monospace';
    ctx.fillText(`НА: ${I.guideVane}%`, fx - 20, fy - fr - 4);

    // ── Газоход дымосос→труба ──
    ctx.fillStyle = COL.fill; ctx.fillRect(G.ductStack.x, G.ductStack.y, G.ductStack.w, G.ductStack.h);
    ctx.strokeRect(G.ductStack.x, G.ductStack.y, G.ductStack.w, G.ductStack.h);
    drawFlowStripes(G.ductStack.x, G.ductStack.y, G.ductStack.w, G.ductStack.h, speed, 'right');

    // ── Труба ──
    ctx.fillStyle = COL.fill; ctx.fillRect(G.stack.x, G.stack.y, G.stack.w, G.stack.h);
    ctx.strokeRect(G.stack.x, G.stack.y, G.stack.w, G.stack.h);
    // Полосы потока в трубе (вверх)
    drawFlowStripes(G.stack.x, G.stack.y, G.stack.w, G.stack.h, speed, 'up');
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

    // ── Сжатый воздух ──
    ctx.fillStyle = COL.label; ctx.font = '11px monospace';
    const airCol = P.receiverPressure > 0.5 ? '#3fb950' : (P.receiverPressure > 0.35 ? '#d29922' : '#f85149');
    ctx.fillStyle = airCol;
    ctx.fillText(`🌬 Ресивер: ${P.receiverPressure.toFixed(2)} МПа`, G.filter.x + 30, G.filter.y + G.filter.h + 42);
}
