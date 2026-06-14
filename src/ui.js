// --- UI-UX-Agent ---
// Визуализация на Canvas и Chart.js

const particles = [];
let canvas, ctx;
let cw, ch;
let charts = {};

// Геометрия установки
const geo = {
    pipes: [
        { id: '1A', x: 50, y: 350, outX: 50, outY: 250 },
        { id: '1B', x: 100, y: 350, outX: 100, outY: 250 },
        { id: '2A', x: 150, y: 350, outX: 150, outY: 250 },
        { id: '2B', x: 200, y: 350, outX: 200, outY: 250 },
    ],
    mainDuct: { y: 250, startX: 50, endX: 300 },
    reactor: { x: 300, y: 200, w: 80, h: 100 },
    siloFresh: { x: 300, y: 50, w: 40, h: 80 },
    siloRecirc: { x: 360, y: 50, w: 40, h: 80 },
    filter: { x: 450, y: 150, w: 150, h: 150 },
    hopper: { x: 450, y: 300, w: 150, h: 80 },
    fan: { x: 650, y: 200, r: 40 },
    stack: { x: 750, y: 50, w: 40, h: 250 },
    chute: { y: 390 }
};

class Particle {
    constructor(type, x, y, vx, vy) {
        this.type = type; // 'gas', 'clean', 'fresh', 'recirc', 'fugitive'
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.life = 1.0;
        this.active = true;
        this.target = null;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        
        // Логика перемещения по трубам
        if (this.type === 'gas') {
            if (this.target === 'duct' && this.y <= geo.mainDuct.y) {
                this.y = geo.mainDuct.y;
                this.vy = 0;
                this.vx = 2 + Math.random(); // Движение вправо по главному газоходу
                this.target = 'reactor';
            }
            if (this.target === 'reactor' && this.x >= geo.reactor.x) {
                // В реакторе двигаемся вниз и вправо
                this.vx = 1 + Math.random();
                this.vy = 1 + Math.random();
                this.target = 'filter';
            }
            if (this.target === 'filter' && this.x >= geo.filter.x) {
                this.vx = 2 + Math.random();
                this.vy = (Math.random() - 0.5) * 2;
                // Внутри фильтра оседаем или проходим
                if (this.x >= geo.filter.x + 20) {
                    if (Math.random() > 0.05) { // 95% газа становится чистым
                        this.type = 'clean';
                        this.target = 'stack';
                    } else { // Пыль падает вниз
                        this.type = 'recirc';
                        this.target = 'hopper';
                    }
                }
            }
        } else if (this.type === 'clean') {
            if (this.target === 'stack') {
                if (this.x >= geo.stack.x + 10) {
                    this.vx = 0;
                    this.vy = -3 - Math.random(); // Выход в трубу
                } else if (this.x >= geo.fan.x) {
                    this.vx = 4;
                    this.vy = 0;
                }
            }
        } else if (this.type === 'fresh') {
            if (this.y >= geo.reactor.y + 20) {
                this.vx = 2; // Летит в фильтр
                this.vy = (Math.random() - 0.5);
                this.type = 'recirc'; // Сразу становится грязным
                this.target = 'hopper';
            }
        } else if (this.type === 'recirc') {
            if (this.target === 'hopper') {
                this.vy += 0.1; // Гравитация в бункере
                if (this.y >= geo.hopper.y + geo.hopper.h - 10) {
                    this.y = geo.hopper.y + geo.hopper.h - 10;
                    this.vx = -2; // Идет по аэрожелобу влево
                    this.vy = 0;
                    this.target = 'chute';
                }
            } else if (this.target === 'chute') {
                // Вверх в силос
                if (this.x <= geo.siloRecirc.x + 20 && Math.random() < 0.3) {
                    this.vx = 0;
                    this.vy = -3;
                }
            } else if (this.target === 'reactor') { // Подача из рецирк силоса
                if (this.y >= geo.reactor.y + 20) {
                    this.vx = 2;
                    this.vy = (Math.random() - 0.5);
                    this.target = 'hopper';
                }
            }
        }

        // Уничтожение
        if (this.x > cw || this.y < 0 || this.x < 0 || this.y > ch) {
            this.active = false;
        }
        if (this.type === 'fugitive') {
            this.life -= 0.01;
            if (this.life <= 0) this.active = false;
        }
    }

    draw(ctx) {
        ctx.fillStyle = this.getColor();
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.getSize(), 0, Math.PI * 2);
        ctx.fill();
    }

    getColor() {
        switch(this.type) {
            case 'gas': return '#ef4444'; // Красный (Грязный)
            case 'clean': return '#3b82f6'; // Синий (Чистый)
            case 'fresh': return '#ffffff'; // Белый
            case 'recirc': return '#eab308'; // Желтый (Фторированный)
            case 'fugitive': return `rgba(239, 68, 68, ${this.life})`;
            default: return '#fff';
        }
    }

    getSize() {
        return this.type === 'fresh' || this.type === 'recirc' ? 2 : 3;
    }
}

window.SGOUi = {
    init: function(state) {
        canvas = document.getElementById('simCanvas');
        ctx = canvas.getContext('2d');
        
        // Разрешение
        const resize = () => {
            canvas.width = canvas.parentElement.clientWidth;
            canvas.height = canvas.parentElement.clientHeight;
            cw = canvas.width;
            ch = canvas.height;
        };
        window.addEventListener('resize', resize);
        resize();

        this.initControls(state);
        this.initCharts();
    },

    initControls: function(state) {
        const bindSlider = (id, valId, stateKey, parser) => {
            const slider = document.getElementById(id);
            const valLabel = document.getElementById(valId);
            if(slider && valLabel) {
                slider.value = state[stateKey];
                valLabel.textContent = state[stateKey];
                slider.addEventListener('input', (e) => {
                    const val = parser(e.target.value);
                    valLabel.textContent = val;
                    state[stateKey] = val;
                });
            }
        };

        bindSlider('slider-current', 'val-current', 'potroomCurrent', parseInt);
        bindSlider('slider-fan', 'val-fan', 'fanSpeed', parseInt);
        bindSlider('slider-alumina', 'val-alumina', 'aluminaFeedRate', parseFloat);
        bindSlider('slider-recirc', 'val-recirc', 'aluminaRecircRate', parseFloat);
        
        // Регенерация DP
        const sliderRegen = document.getElementById('slider-regen-dp');
        const valRegen = document.getElementById('val-regen-dp');
        if (sliderRegen && valRegen) {
            sliderRegen.value = state.regen.startDp;
            valRegen.textContent = state.regen.startDp;
            sliderRegen.addEventListener('input', (e) => {
                const val = parseInt(e.target.value);
                valRegen.textContent = val;
                state.regen.startDp = val;
            });
        }

        ['1A', '1B', '2A', '2B'].forEach(id => {
            const slider = document.getElementById(`slider-damper-${id}`);
            const valLabel = document.getElementById(`val-damper-${id}`);
            if(slider && valLabel) {
                slider.addEventListener('input', (e) => {
                    const val = parseInt(e.target.value);
                    valLabel.textContent = val;
                    const pipe = state.inletPipes.find(p => p.id === id);
                    if(pipe) pipe.damper = val;
                });
            }
        });

        const btnForce = document.getElementById('btn-force-pulse');
        if (btnForce) {
            btnForce.addEventListener('click', () => {
                if(window.SGOModel) window.SGOModel.forcePulse();
            });
        }
    },

    initCharts: function() {
        Chart.defaults.color = '#8b949e';
        Chart.defaults.font.family = 'monospace';

        const createChart = (id, label, color, max) => {
            const ctx = document.getElementById(id).getContext('2d');
            return new Chart(ctx, {
                type: 'line',
                data: { labels: Array(30).fill(''), datasets: [{ label, data: Array(30).fill(0), borderColor: color, borderWidth: 2, tension: 0.3, pointRadius: 0 }] },
                options: { responsive: true, maintainAspectRatio: false, animation: false, scales: { y: { suggestedMin: 0, suggestedMax: max, grid: { color: '#30363d' } }, x: { grid: { display: false } } }, plugins: { legend: { display: true, position: 'top' } } }
            });
        };

        charts.hf = createChart('hfChart', 'Выбросы HF (мг/нм³)', '#f85149', 5);
        charts.dp = createChart('dpChart', 'Сопротивление ΔP (Па)', '#58a6ff', 2000);
        charts.eff = createChart('effChart', 'Эффективность (%)', '#3fb950', 100);
    },

    update: function(state) {
        this.updateTelemetry(state);
        this.updateCharts(state);
        this.emitParticles(state);
    },

    updateTelemetry: function(state) {
        document.getElementById('ind-hf-out').textContent = `${state.outletHF.toFixed(2)} мг/нм³`;
        document.getElementById('ind-delta-p').textContent = `${state.globalDeltaP.toFixed(0)} Па`;
        document.getElementById('ind-draft').textContent = `${state.globalDraft.toFixed(0)} Па`;
        
        document.getElementById('ind-clean-eff').textContent = `${state.cleaningEfficiency.toFixed(2)}%`;
        document.getElementById('ind-overall-eff').textContent = `${state.overallEfficiency.toFixed(2)}%`;

        const fugitiveStatus = document.getElementById('ind-fugitive');
        const isGlobalFugitive = state.inletPipes.every(p => p.isFugitive);
        const isPartialFugitive = state.inletPipes.some(p => p.isFugitive);

        if (isGlobalFugitive) {
            fugitiveStatus.textContent = 'ПОЛНОЕ ВЫБИВАНИЕ';
            fugitiveStatus.className = 'val-warn';
        } else if (isPartialFugitive) {
            fugitiveStatus.textContent = 'ЛОКАЛЬНОЕ ВЫБИВАНИЕ';
            fugitiveStatus.className = 'val-warn text-yellow-500';
        } else {
            fugitiveStatus.textContent = 'НОРМА';
            fugitiveStatus.className = 'val-ok';
        }

        // Подсветка проблем
        document.getElementById('ind-hf-out').className = state.outletHF > 1.0 ? 'val-warn' : 'val-num';
        document.getElementById('ind-delta-p').className = state.globalDeltaP > 1400 ? 'val-warn text-yellow-500' : 'val-num';
    },

    updateCharts: function(state) {
        const addData = (chart, val) => {
            chart.data.datasets[0].data.shift();
            chart.data.datasets[0].data.push(val);
            chart.update();
        };
        addData(charts.hf, state.outletHF);
        addData(charts.dp, state.globalDeltaP);
        addData(charts.eff, state.overallEfficiency);
    },

    emitParticles: function(state) {
        const fanRunning = !state.failures.fanFailed && state.fanSpeed > 0;

        // Корпуса
        state.inletPipes.forEach(pipe => {
            const pDef = geo.pipes.find(p => p.id === pipe.id);
            if (!pDef) return;

            // Генерация газа
            if (Math.random() < 0.4) {
                if (pipe.isFugitive) {
                    let p = new Particle('fugitive', pDef.x + (Math.random() * 20 - 10), pDef.y, (Math.random() - 0.5), -1 - Math.random());
                    particles.push(p);
                }
                
                // Даже при выбивании часть может идти в трубу
                if (pipe.gasFlow > 0 && fanRunning && pipe.damper > 0) {
                    let p = new Particle('gas', pDef.x, pDef.y, 0, -2);
                    p.target = 'duct';
                    particles.push(p);
                }
            }
        });

        // Свежий глинозем
        if (!state.failures.screwClogged && state.aluminaFeedRate > 0 && Math.random() < (state.aluminaFeedRate / 30)) {
            let p = new Particle('fresh', geo.siloFresh.x + 20, geo.siloFresh.y + geo.siloFresh.h, 0, 2);
            particles.push(p);
        }

        // Рециркуляция
        if (state.aluminaRecircRate > 0 && Math.random() < (state.aluminaRecircRate / 50)) {
            let p = new Particle('recirc', geo.siloRecirc.x + 20, geo.siloRecirc.y + geo.siloRecirc.h, 0, 2);
            p.target = 'reactor';
            particles.push(p);
        }
    },

    renderCanvas: function() {
        if (!ctx) return;
        
        ctx.fillStyle = '#0a0c10';
        ctx.fillRect(0, 0, cw, ch);

        // Отрисовка оборудования
        ctx.strokeStyle = '#30363d';
        ctx.lineWidth = 2;
        ctx.fillStyle = '#161b22';

        // Главный газоход
        ctx.strokeRect(geo.mainDuct.startX, geo.mainDuct.y - 15, geo.mainDuct.endX - geo.mainDuct.startX, 30);
        
        // Трубы от корпусов
        geo.pipes.forEach(p => {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.outX, p.outY);
            ctx.stroke();
            
            // Корпус
            ctx.fillRect(p.x - 20, p.y, 40, 40);
            ctx.strokeRect(p.x - 20, p.y, 40, 40);
        });

        // Реактор
        ctx.fillRect(geo.reactor.x, geo.reactor.y, geo.reactor.w, geo.reactor.h);
        ctx.strokeRect(geo.reactor.x, geo.reactor.y, geo.reactor.w, geo.reactor.h);
        ctx.fillStyle = '#8b949e';
        ctx.fillText('РЕАКТОР', geo.reactor.x + 15, geo.reactor.y + 50);

        // Силосы
        ctx.fillStyle = '#112233'; ctx.fillRect(geo.siloFresh.x, geo.siloFresh.y, geo.siloFresh.w, geo.siloFresh.h);
        ctx.strokeRect(geo.siloFresh.x, geo.siloFresh.y, geo.siloFresh.w, geo.siloFresh.h);
        ctx.fillStyle = '#332211'; ctx.fillRect(geo.siloRecirc.x, geo.siloRecirc.y, geo.siloRecirc.w, geo.siloRecirc.h);
        ctx.strokeRect(geo.siloRecirc.x, geo.siloRecirc.y, geo.siloRecirc.w, geo.siloRecirc.h);

        // Газоход от реактора к фильтру
        ctx.strokeRect(geo.reactor.x + geo.reactor.w, geo.reactor.y + geo.reactor.h - 30, geo.filter.x - (geo.reactor.x + geo.reactor.w), 30);

        // Фильтр (Корпус)
        ctx.fillStyle = '#161b22';
        ctx.fillRect(geo.filter.x, geo.filter.y, geo.filter.w, geo.filter.h);
        ctx.strokeRect(geo.filter.x, geo.filter.y, geo.filter.w, geo.filter.h);
        
        // 4 Секции внутри фильтра (визуализация забивания)
        if (window.SGOModel && window.SGOModel.state) {
            const sections = window.SGOModel.state.filterSections;
            const secW = geo.filter.w / 4;
            sections.forEach((sec, i) => {
                // Вычисляем забитость (от 0 до 1, где 1 это startDp)
                let clogRatio = (sec.deltaP - window.SGOModel.config.baseDeltaP) / (window.SGOModel.state.regen.startDp - window.SGOModel.config.baseDeltaP);
                if (clogRatio < 0) clogRatio = 0;
                if (clogRatio > 1) clogRatio = 1;
                
                // Если регенерация, рисуем синим
                if (sec.isRegenerating) {
                    ctx.fillStyle = 'rgba(59, 130, 246, 0.6)'; // Blue
                } else {
                    // Цвет от серого к красному
                    let r = Math.floor(48 + (239 - 48) * clogRatio);
                    let g = Math.floor(54 + (68 - 54) * clogRatio);
                    let b = Math.floor(61 + (68 - 61) * clogRatio);
                    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.8)`;
                }
                
                // Рисуем уровень пирога (растет снизу вверх)
                let cakeHeight = geo.filter.h * clogRatio;
                ctx.fillRect(geo.filter.x + i * secW, geo.filter.y + geo.filter.h - cakeHeight, secW, cakeHeight);
                ctx.strokeRect(geo.filter.x + i * secW, geo.filter.y, secW, geo.filter.h);
            });
        }
        
        // Бункер фильтра
        ctx.beginPath();
        ctx.moveTo(geo.filter.x, geo.filter.y + geo.filter.h);
        ctx.lineTo(geo.hopper.x + geo.hopper.w, geo.filter.y + geo.filter.h);
        ctx.lineTo(geo.hopper.x + geo.hopper.w - 30, geo.hopper.y + geo.hopper.h);
        ctx.lineTo(geo.hopper.x + 30, geo.hopper.y + geo.hopper.h);
        ctx.closePath();
        ctx.stroke();

        // Труба к дымососу и дымосос
        ctx.strokeRect(geo.filter.x + geo.filter.w, geo.fan.y - 15, geo.fan.x - (geo.filter.x + geo.filter.w), 30);
        
        ctx.beginPath(); ctx.arc(geo.fan.x, geo.fan.y, geo.fan.r, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#8b949e'; ctx.fillText('ВЕНТ', geo.fan.x - 15, geo.fan.y + 5);
        
        // Выхлопная труба
        ctx.strokeRect(geo.fan.x + geo.fan.r, geo.stack.y + 200, geo.stack.x - (geo.fan.x + geo.fan.r), 30);
        ctx.fillRect(geo.stack.x, geo.stack.y, geo.stack.w, geo.stack.h);
        ctx.strokeRect(geo.stack.x, geo.stack.y, geo.stack.w, geo.stack.h);

        // Аэрожелоб
        ctx.beginPath();
        ctx.moveTo(geo.hopper.x + 75, geo.hopper.y + geo.hopper.h);
        ctx.lineTo(geo.hopper.x + 75, geo.chute.y);
        ctx.lineTo(geo.siloRecirc.x + 20, geo.chute.y);
        ctx.lineTo(geo.siloRecirc.x + 20, geo.siloRecirc.y + geo.siloRecirc.h);
        ctx.stroke();

        // Частицы
        for (let i = particles.length - 1; i >= 0; i--) {
            let p = particles[i];
            p.update();
            p.draw(ctx);
            if (!p.active) particles.splice(i, 1);
        }
    }
};
