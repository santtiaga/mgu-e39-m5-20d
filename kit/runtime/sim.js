'use strict';
/**
 * sim.js - a believable simulated drive for demo mode (VM / bench).
 *
 * 46 s loop: idle -> full-throttle pull through the 8 gears -> lift -> hard stop
 * from speed -> a few corners -> idle. Engine temperatures start cold and warm
 * up over ~4 minutes. Units: rpm, km/h, g, deg C.
 *
 * Drivetrain: BMW 8HP51, G31 520d MHEV RWD, 2.93 final drive,
 * 275/40 R19 driven tyres. Full-throttle shift points follow the tuned
 * 246 hp / ~528 Nm power curve and the supplied shift table.
 */
const RATIOS = [0, 5.250, 3.360, 2.172, 1.720, 1.316, 1.000, 0.823, 0.640];
const FINAL = 2.93, WHEEL_M = 0.7026 * Math.PI; // final drive, nominal tyre circumference
const SHIFT_RPM = [0, 3900, 4200, 4400, 4500, 4500, 4400, 4500];
const POWER_POINTS = [
    [2500, 186], [2700, 199], [3400, 234], [3500, 236],
    [3600, 240], [3900, 245], [4200, 246], [4400, 242], [4500, 239],
];
const rpmFor = (kmh, g) => (kmh / 3.6) / WHEEL_M * 60 * RATIOS[g] * FINAL;
const powerHpAt = (rpm) => {
    // Below the measured curve, hold the tuned engine's ~528 Nm torque plateau.
    if (rpm <= POWER_POINTS[0][0]) return 528 * rpm / 7121;
    for (let i = 1; i < POWER_POINTS.length; i++) {
        const [r1, p1] = POWER_POINTS[i - 1];
        const [r2, p2] = POWER_POINTS[i];
        if (rpm <= r2) return p1 + (p2 - p1) * (rpm - r1) / (r2 - r1);
    }
    return POWER_POINTS[POWER_POINTS.length - 1][1];
};

class Sim {
    constructor() {
        this.t0 = Date.now(); this.last = null;
        this.v = 0; this.gear = 1; this.oil = 18; this.coolant = 20; this.lat = 0;
        this.red = 5000;
    }

    /** Rev limit for the simulated diesel engine. */
    setRedline(rpm) { this.red = rpm; }

    sample(now) {
        now = now || Date.now();
        const dt = this.last ? Math.min(0.2, (now - this.last) / 1000) : 0.05;
        this.last = now;
        const t = ((now - this.t0) / 1000) % 46;
        let accel = 0, lat = 0, throttle = 0;
        if (t < 4) { accel = -this.v / 3.6 * 0.5; }                         // roll to a stop / idle
        else if (t < 17) {                                                  // full-throttle pull
            throttle = 1;
            const shifting = this.shiftUntil && now < this.shiftUntil;
            const engineRpm = this.rpm || 2500;
            const pwr = powerHpAt(engineRpm) * 745.7;
            accel = shifting ? 0.2 : Math.min(9.5, pwr * 0.85 / 1750 / Math.max(3, this.v / 3.6)) - 0.39 * Math.pow(this.v / 3.6, 2) / 1750 - 0.13;
        } else if (t < 19) { accel = -0.6; }                                // lift
        else if (t < 25) { accel = this.v > 0.3 ? -10.2 : 0; }              // hard stop
        else if (t < 29) { throttle = 0.5; accel = this.v < 70 ? 4.5 : 0; } // back up to speed
        else if (t < 43) {                                                  // corners
            throttle = 0.4; accel = this.v < 75 ? 1.5 : -0.3;
            lat = 0.92 * Math.sin((t - 29) / 14 * Math.PI * 4) * 9.81;
        } else { accel = -2.5; }
        this.v = Math.max(0, this.v + accel * dt * 3.6);
        if (this.v === 0 && accel < 0) accel = 0;

        // 8HP51: gear-specific full-throttle shifts; part-throttle upshifts at 3000 rpm.
        if (this.v < 3) this.gear = 1;
        let rpm = Math.max(850, rpmFor(this.v, this.gear));
        if (throttle > 0.9 && this.gear < 8 && rpm >= SHIFT_RPM[this.gear]) {
            this.gear++;
            this.shiftUntil = now + 180;
            rpm = rpmFor(this.v, this.gear);
        }
        if (throttle <= 0.9 && rpm > 3000 && this.gear < 8) {
            this.gear++;
            rpm = rpmFor(this.v, this.gear);
        }
        if (rpm < 1400 && this.gear > 1) {
            this.gear--;
            rpm = rpmFor(this.v, this.gear);
        }
        if (this.v < 3) rpm = throttle > 0.9 ? 2500 : 850 + Math.random() * 20;
        rpm = Math.min(rpm, this.red + 20);                                // rev limiter
        this.rpm = rpm;

        // warm-up: oil lags coolant
        this.coolant = Math.min(92, this.coolant + dt * (0.35 + throttle * 0.5));
        this.oil = Math.min(104, this.oil + dt * (0.22 + throttle * 0.55) * (this.coolant > 70 ? 1.2 : 1));
        this.lat += (lat - this.lat) * Math.min(1, dt * 8);
        const torque = throttle > 0.9 ? powerHpAt(rpm) * 7121 / Math.max(850, rpm) : 40;
        return {
            rpm, speed: this.v, gear: this.v < 0.5 && throttle < 0.9 ? 0 : this.gear,
            gLong: accel / 9.81 + (Math.random() - 0.5) * 0.02, gLat: this.lat / 9.81 + (Math.random() - 0.5) * 0.02,
            coolant: this.coolant, oil: this.oil, torque, throttle,
        };
    }
}

module.exports = Sim;
