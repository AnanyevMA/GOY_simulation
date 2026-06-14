# Skills & Capabilities: Antigravity

## 1. Domain Expertise (Industrial Physics)
- **Fluid Dynamics:** Calculation of pressure drops (ΔP) across porous media (filter bags).
- **Aerodynamics:** Fan performance curves (RPM vs. Flow vs. Power consumption).
- **Thermodynamics:** Gas volume expansion/contraction based on temperature.
- **Mass Transfer:** Particulate accumulation and adsorption kinetics (HF gas + Alumina).

## 2. Technical Stack (Web Simulation)
- **Core:** HTML5, modern vanilla JavaScript (ES6+), CSS3 (Tailwind-style utility classes or raw CSS).
- **Rendering Engine:** HTML5 `<canvas>` API for rendering thousands of moving particles (gas flow, dust, alumina) at 60 FPS.
- **UI/UX Components:** Custom sliders (`<input type="range">`), buttons, and real-time gauges.
- **Data Visualization:** Integration with lightweight charting libraries (e.g., Chart.js via CDN) or custom canvas-based line charts for real-time telemetry.

## 3. Simulation Architecture Methods
- **Particle Systems:** Implementing emitter and attractor logic to simulate gas flow through ducting.
- **State Management:** Maintaining a global `SimulationState` object that updates every frame.
- **PID Control Logic:** Simulating the behavior of automated control loops (e.g., maintaining pressure by adjusting fan RPM).