// --- Core-Architect-Agent ---
// Главный контроллер приложения

document.addEventListener('DOMContentLoaded', () => {
    if (!window.SGOModel || !window.SGOUi || !window.SGOFailures) {
        console.error("Не удалось загрузить все модули (Model, UI, Failures).");
        return;
    }

    const model = window.SGOModel;
    const ui = window.SGOUi;
    const failures = window.SGOFailures;

    ui.init(model.state);
    failures.init(model.state);

    // Логическая симуляция ускорена: каждые 100 мс = 1 игровой шаг (в 10 раз быстрее)
    setInterval(() => {
        model.tick();
    }, 100); // 100ms вместо 1000ms

    // Рендеринг интерфейса и частиц (60 FPS)
    function renderLoop() {
        ui.update(model.state);
        ui.renderCanvas(); // Отрисовка частиц на Canvas
        requestAnimationFrame(renderLoop);
    }

    // Запуск цикла рендера
    requestAnimationFrame(renderLoop);
});
