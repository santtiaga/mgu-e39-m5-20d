'use strict';

/*
 * CPU raster port of the E39DASH GLSL u_bgOnly branch.
 * Keep the formulas, coordinates, dial centres/radii, material colours,
 * hash noise and 0.5 px coverage ramps in sync with shared/shaders.js:
 *   page/panel background -> drawRingAndFace() x 4 -> return.
 *
 * This intentionally renders only what DIAG 10's u_bgOnly path renders:
 * panel + face grain + metallic rings. All scales, labels, windows and
 * needles remain excluded. It is generated once per layout build and sent
 * as a single immutable RGBA image layer.
 */

const PI = Math.PI;
const D2R = PI / 180;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const mix = (a, b, t) => a + (b - a) * t;
const cov = (d) => clamp(0.5 - d, 0, 1);
const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
};
const fract = (x) => x - Math.floor(x);

function hash12(x, y) {
    // GLSL hash12(vec2): fract(vec3(p.xyx)*.1031), dot with p3.yzx+33.33,
    // add the scalar to all components, then fract((x+y)*z).
    let px = fract(x * 0.1031);
    let py = fract(y * 0.1031);
    let pz = px;
    const d = px * (py + 33.33) + py * (pz + 33.33) + pz * (px + 33.33);
    px += d; py += d; pz += d;
    return fract((px + py) * pz);
}

function over(c, r, g, b, a) {
    if (a <= 0) return;
    const k = 1 - a;
    c.r = r * a + c.r * k;
    c.g = g * a + c.g * k;
    c.b = b * a + c.b * k;
}

function drawRingAndFace(px, py, cx, cy, R, big, night, c) {
    const qx = px - cx, qy = py - cy;
    const r = Math.sqrt(qx * qx + qy * qy);
    if (r > R + 18) return;

    // 1. Deep outer cast shadow on the cluster panel.
    const rs = Math.sqrt(qx * qx + (qy - 5) * (qy - 5));
    if (rs < R * 1.012 + 14) {
        over(c, 0, 0, 0, 0.82 * Math.exp(-Math.max(rs - R * 1.005, 0) / 5.5));
    }
    if (r > R + 1) return;

    const ringIn = big ? 0.953 : 0.925;
    const rf = R * (ringIn - 0.012);

    // 2. Matte dial face and its recessed top-lit shadow.
    if (r <= rf + 1) {
        const hx = qx + R * 0.05, hy = qy - R * 0.15;
        const t = clamp(Math.sqrt(hx * hx + hy * hy) / rf, 0, 1);
        const f0r = mix(0.337, 0.165, night), f0g = mix(0.376, 0.082, night), f0b = mix(0.439, 0.035, night);
        const f1r = mix(0.282, 0.082, night), f1g = mix(0.318, 0.043, night), f1b = mix(0.373, 0.024, night);
        const f2r = mix(0.200, 0.031, night), f2g = mix(0.227, 0.020, night), f2b = mix(0.271, 0.016, night);
        const f = t < 0.62 ? t / 0.62 : (t - 0.62) / 0.38;
        let fr = t < 0.62 ? mix(f0r, f1r, f) : mix(f1r, f2r, f);
        let fg = t < 0.62 ? mix(f0g, f1g, f) : mix(f1g, f2g, f);
        let fb = t < 0.62 ? mix(f0b, f1b, f) : mix(f1b, f2b, f);
        const gr = (hash12(Math.floor(px), Math.floor(py)) - 0.5) * mix(0.055, 0.025, night);
        fr = clamp(fr + gr, 0, 1); fg = clamp(fg + gr, 0, 1); fb = clamp(fb + gr, 0, 1);

        const shx = qx, shy = qy - R * 0.035;
        const rSh = Math.sqrt(shx * shx + shy * shy);
        const sh = smoothstep(rf * 0.86, rf * 1.02, rSh);
        const shade = sh * mix(0.62, 0.80, night);
        fr = mix(fr, 0, shade); fg = mix(fg, 0, shade); fb = mix(fb, 0, shade);

        if (night > 0.5) {
            const nh1 = clamp(1 - (r - R * 0.10) / (R * 0.42), 0, 1);
            fr += 1.0 * (0.28 * nh1 * nh1);
            fg += 0.47 * (0.28 * nh1 * nh1);
            fb += 0.12 * (0.28 * nh1 * nh1);
            const nh2 = 1 - Math.abs(r - R * 0.75) / (R * 0.20);
            if (nh2 > 0) {
                fr += 1.0 * (0.10 * nh2);
                fg += 0.43 * (0.10 * nh2);
                fb += 0.08 * (0.10 * nh2);
            }
        }
        over(c, fr, fg, fb, cov(r - rf));
    }

    // 3. Dark inner collar.
    if (r >= rf - 1 && r <= R * ringIn + 1) {
        const dCollar = Math.max(rf - r, r - R * ringIn);
        over(c, mix(0.055, 0.020, night), mix(0.059, 0.012, night),
            mix(0.071, 0.012, night), cov(dCollar));
    }

    // 4. Metallic conical-gradient bezel, matching E39DASH shader equations.
    if (r >= R * ringIn - 1) {
        const ang = Math.atan2(qy, qx) + PI * 0.75;
        let w = 0.5 + 0.32 * Math.cos(ang * 2) + 0.18 * Math.sin(ang * 3 - 0.7);
        let lr = mix(0.933, 0.227, night), lg = mix(0.945, 0.165, night), lb = mix(0.961, 0.118, night);
        let dr = mix(0.549, 0.078, night), dg = mix(0.569, 0.055, night), db = mix(0.612, 0.039, night);
        if (big && night < 0.5) {
            w = 0.5 + 0.29 * Math.cos(ang * 2) + 0.17 * Math.sin(ang * 3 - 0.7)
                + 0.12 * Math.cos(ang * 5 + 0.35);
            lr = 0.805; lg = 0.825; lb = 0.855;
            dr = 0.285; dg = 0.315; db = 0.365;
        }
        let rr = mix(dr, lr, clamp(w, 0, 1));
        let rg = mix(dg, lg, clamp(w, 0, 1));
        let rb = mix(db, lb, clamp(w, 0, 1));

        const u = clamp((r - R * ringIn) / (R * (1 - ringIn)), 0, 1);
        let inSh = clamp(1 - u / 0.22, 0, 1) * 0.55;
        let outSh = clamp((u - 0.80) / 0.20, 0, 1) * 0.60;
        let ridge = Math.max(0, 1 - Math.abs(u - 0.55) / 0.25) * 0.20;
        if (big && night < 0.5) {
            inSh = clamp(1 - u / 0.21, 0, 1) * 0.58;
            outSh = clamp((u - 0.83) / 0.17, 0, 1) * 0.62;
            ridge = Math.max(0, 1 - Math.abs(u - 0.52) / 0.23) * 0.23;

            const grain = (hash12(Math.floor(px * 1.35), Math.floor(py * 1.35)) - 0.5) * 0.105;
            const tangentLen = Math.sqrt(qx * qx + qy * qy) || 1;
            const brush = Math.sin((px * (-qy / tangentLen) + py * (qx / tangentLen)) * 0.72 + ang * 2) * 0.018;
            const textureMask = smoothstep(0.02, 0.12, u) * (1 - smoothstep(0.88, 0.99, u));
            rr += (grain + brush) * textureMask;
            rg += (grain + brush) * textureMask;
            rb += (grain + brush) * textureMask;

            const upperGlint = Math.pow(Math.max(0, Math.cos(ang - 0.42)), 15);
            const lowerGlint = Math.pow(Math.max(0, Math.cos(ang - 3.05)), 9);
            const ridgeMask = smoothstep(0.22, 0.39, u) * (1 - smoothstep(0.65, 0.79, u));
            rr += 0.075 * upperGlint * ridgeMask + 0.035 * lowerGlint * ridgeMask;
            rg += 0.080 * upperGlint * ridgeMask + 0.040 * lowerGlint * ridgeMask;
            rb += 0.090 * upperGlint * ridgeMask + 0.048 * lowerGlint * ridgeMask;

            const innerLip = 1 - smoothstep(0.035, 0.085, u);
            const outerLip = smoothstep(0.88, 0.96, u) * (1 - smoothstep(0.975, 1.0, u));
            rr += 0.055 * innerLip + 0.070 * outerLip;
            rg += 0.060 * innerLip + 0.075 * outerLip;
            rb += 0.070 * innerLip + 0.085 * outerLip;
        }
        const dark = Math.max(inSh, outSh);
        rr = mix(rr + ridge, 0, dark); rg = mix(rg + ridge, 0, dark); rb = mix(rb + ridge, 0, dark);
        const dRing = Math.max(R * ringIn - r, r - R);
        over(c, rr, rg, rb, cov(dRing));

        if (night > 0.5) {
            const dRef = Math.abs(r - R * (ringIn + 0.012)) - R * 0.006;
            if (dRef < 3.5) {
                const dash = smoothstep(-0.2, 0.3, Math.sin(Math.atan2(qy, qx) * 36));
                over(c, 1.0, 0.588, 0.196, 0.48 * dash * Math.exp(-Math.max(dRef, 0) / 1.5));
            }
        }
    }
}

function render(width, height, night) {
    const n = night ? 1 : 0;
    const out = Buffer.alloc(width * height * 4);
    const pageR = mix(0.039, 0.012, n), pageG = mix(0.043, 0.012, n), pageB = mix(0.051, 0.012, n);
    const dials = [
        [245, 398, 118, false],
        [1735, 398, 118, false],
        [625, 295, 214, true],
        [1155, 295, 214, true]
    ];
    const c = { r: 0, g: 0, b: 0 };
    for (let y = 0; y < height; y++) {
        const py = y + 0.5;
        for (let x = 0; x < width; x++) {
            const px = x + 0.5;
            c.r = pageR; c.g = pageG; c.b = pageB;

            // Page background and inner matte panel: same p, dPan, gradient,
            // hash12 and cov() operations as E39DASH's u_bgOnly path.
            const dPan = Math.max(Math.abs(px - 960) - 960, Math.abs(py - 360) - 360);
            if (dPan < 2) {
                const gy = clamp((py - 43) / 620, 0, 1);
                const p0r = mix(0.086, 0.035, n), p0g = mix(0.094, 0.027, n), p0b = mix(0.110, 0.024, n);
                const p1r = mix(0.059, 0.020, n), p1g = mix(0.063, 0.016, n), p1b = mix(0.075, 0.016, n);
                const f = 1 - Math.abs(gy - 0.55) * 1.8;
                const gr = (hash12(Math.floor(px), Math.floor(py)) - 0.5) * mix(0.018, 0.008, n);
                over(c, clamp(mix(p1r, p0r, f) + gr, 0, 1),
                    clamp(mix(p1g, p0g, f) + gr, 0, 1),
                    clamp(mix(p1b, p0b, f) + gr, 0, 1), cov(dPan));
                over(c, 0, 0, 0, 0.70 * cov(Math.abs(dPan) - 1.2));
            }

            drawRingAndFace(px, py, dials[0][0], dials[0][1], dials[0][2], dials[0][3], n, c);
            drawRingAndFace(px, py, dials[1][0], dials[1][1], dials[1][2], dials[1][3], n, c);
            drawRingAndFace(px, py, dials[2][0], dials[2][1], dials[2][2], dials[2][3], n, c);
            drawRingAndFace(px, py, dials[3][0], dials[3][1], dials[3][2], dials[3][3], n, c);

            const i = (y * width + x) * 4;
            out[i] = Math.round(clamp(c.r, 0, 1) * 255);
            out[i + 1] = Math.round(clamp(c.g, 0, 1) * 255);
            out[i + 2] = Math.round(clamp(c.b, 0, 1) * 255);
            out[i + 3] = 255;
        }
    }
    return out;
}

module.exports = { render };
