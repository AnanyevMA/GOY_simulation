// --- QA-Failure-Agent ---
window.SGOFailures = {
    init: function(state) {
        const checkScrew = document.getElementById('fail-screw');
        const checkFan = document.getElementById('fail-fan');
        const checkAir = document.getElementById('fail-air');
        const checkBags = document.getElementById('fail-bags');
        const sliderTornBags = document.getElementById('slider-torn-bags');

        if (checkScrew) checkScrew.addEventListener('change', e => state.failures.screwClogged = e.target.checked);
        if (checkFan) checkFan.addEventListener('change', e => state.failures.fanFailed = e.target.checked);
        if (checkAir) checkAir.addEventListener('change', e => state.failures.airPressureDrop = e.target.checked);
        
        if (checkBags) {
            checkBags.addEventListener('change', e => {
                state.failures.tornBags = e.target.checked;
                sliderTornBags.disabled = !e.target.checked;
                state.failures.tornBagsCount = e.target.checked ? parseInt(sliderTornBags.value, 10) : 0;
            });
        }

        if (sliderTornBags) {
            sliderTornBags.addEventListener('input', e => {
                if (state.failures.tornBags) state.failures.tornBagsCount = parseInt(e.target.value, 10);
            });
        }
    }
};
