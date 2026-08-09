/* The entrance sculpture: ~1800 points that gather out of scatter into the
   buildings he loves, hold, then drift into the next — Collemaggio, the
   Porte de Darwin, the Cité du Vin, Galata Bridge (whose gull takes off),
   Lund Cathedral.

   No library. Each particle spring-follows its target; morphs happen by
   retargeting particles one by one over a staggered window, so the swarm
   streams between shapes instead of jumping. A light trigonometric wander
   keeps the cloud breathing while it holds.

   The section only appears once the data has loaded, so with JavaScript
   off (or a failed fetch) the page simply has no sculpture. */
(function () {
    'use strict';

    var host = document.querySelector('.sculpt-stage');
    if (!host || !window.requestAnimationFrame || !window.fetch) return;

    var reduced = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var HOLD = 5200;          // ms a building stands before dissolving
    var SPREAD = 1100;        // ms over which particles peel off, one by one
    var COLORS = ['rgba(139,69,19,', 'rgba(184,145,47,',
                  'rgba(109,90,72,', 'rgba(165,90,31,'];

    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var cap = document.createElement('p');
    cap.className = 'sculpt-cap';
    cap.innerHTML = '<b></b><i></i>';

    var data = null, K = 0;
    var px, py, tx, ty;                 // positions and targets
    var hue, size, alpha, kspr, wobA, wobB, switchAt;
    var shape = 0, phaseStart = 0, morphing = false;
    var W = 0, H = 0, dpr = 1, sx = 1, sy = 1, ox = 0, oy = 0;
    var mouseX = -1e4, mouseY = -1e4;
    var running = true;

    function fit() {
        var w = host.clientWidth;
        var h = Math.round(w * 0.52);
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.height = h + 'px';
        W = canvas.width; H = canvas.height;
        var m = 0.05;
        sx = W * (1 - 2 * m) / data.w;
        sy = H * (1 - 2 * m) / data.h;
        var s = Math.min(sx, sy);
        sx = sy = s;
        ox = (W - data.w * s) / 2;
        oy = (H - data.h * s) / 2;
    }

    function targetOf(i, si) {
        var p = data.shapes[si].p;
        return [p[i * 2] * sx + ox, p[i * 2 + 1] * sy + oy];
    }

    function setCaption(si) {
        cap.firstChild.textContent = data.shapes[si].n;
        cap.lastChild.textContent = data.shapes[si].c;
    }

    function begin() {
        K = data.k;
        px = new Float32Array(K); py = new Float32Array(K);
        tx = new Float32Array(K); ty = new Float32Array(K);
        hue = new Uint8Array(K); size = new Float32Array(K);
        alpha = new Float32Array(K); kspr = new Float32Array(K);
        wobA = new Float32Array(K); wobB = new Float32Array(K);
        switchAt = new Float32Array(K);

        fit();
        for (var i = 0; i < K; i++) {
            // chaos: scattered over the whole stage, biased loosely centre
            px[i] = Math.random() * W;
            py[i] = Math.random() * H;
            var t = targetOf(i, 0);
            tx[i] = t[0]; ty[i] = t[1];
            hue[i] = (i * 7 + ((i * 2654435761) >>> 16)) % 4;
            size[i] = (0.9 + Math.random() * 1.4) * dpr;
            alpha[i] = 0.55 + Math.random() * 0.35;
            kspr[i] = 0.045 + Math.random() * 0.05;
            wobA[i] = Math.random() * 6.28;
            wobB[i] = 0.4 + Math.random() * 0.8;
            switchAt[i] = 0;
        }
        setCaption(0);
        cap.classList.remove('off');
        phaseStart = performance.now();

        if (reduced) {                   // no motion: the first building, still
            for (var j = 0; j < K; j++) {
                px[j] = tx[j]; py[j] = ty[j];
            }
            draw(0);
            return;
        }
        requestAnimationFrame(tick);
    }

    function scheduleMorph(now) {
        var next = (shape + 1) % data.shapes.length;
        for (var i = 0; i < K; i++) {
            switchAt[i] = now + ((i * 2654435761) >>> 8) % SPREAD;
        }
        shape = next;
        morphing = true;
        cap.classList.add('off');
    }

    function tick(now) {
        if (!running) { requestAnimationFrame(tick); return; }
        var t = now / 1000;

        if (!morphing && now - phaseStart > HOLD) scheduleMorph(now);

        var done = true;
        var g = data.shapes[shape].g;    // gull start index, if this is Galata
        for (var i = 0; i < K; i++) {
            if (morphing && switchAt[i] && now >= switchAt[i]) {
                var tt = targetOf(i, shape);
                tx[i] = tt[0]; ty[i] = tt[1];
                switchAt[i] = 0;
            }
            if (switchAt[i]) done = false;

            var gx = tx[i], gy = ty[i];
            if (g !== undefined && i >= g) {
                // the gull leaves the bridge: a slow loop over the water,
                // wings beating around its own centre line
                gx += Math.sin(t * 0.33) * W * 0.11;
                gy += Math.sin(t * 0.66) * H * 0.09 - H * 0.02;
                gy += Math.sin(t * 7 + i) * 0.6 * dpr;
            }
            // the breathing wander
            gx += Math.sin(t * wobB[i] + wobA[i]) * 1.6 * dpr;
            gy += Math.cos(t * wobB[i] * 0.83 + wobA[i] * 1.7) * 1.6 * dpr;

            // pointer pushes the dust aside
            var dx = px[i] - mouseX, dy = py[i] - mouseY;
            var dd = dx * dx + dy * dy;
            var R = 70 * dpr;
            if (dd < R * R && dd > 1) {
                var f = (1 - Math.sqrt(dd) / R) * 6 * dpr;
                var inv = 1 / Math.sqrt(dd);
                gx += dx * inv * f * 12;
                gy += dy * inv * f * 12;
            }

            px[i] += (gx - px[i]) * kspr[i];
            py[i] += (gy - py[i]) * kspr[i];
        }

        if (morphing && done) {
            morphing = false;
            phaseStart = now;
            setCaption(shape);
            cap.classList.remove('off');
        }

        draw(t);
        requestAnimationFrame(tick);
    }

    function draw(t) {
        ctx.clearRect(0, 0, W, H);
        for (var c = 0; c < 4; c++) {
            ctx.fillStyle = COLORS[c] + '0.8)';
            ctx.beginPath();
            for (var i = c; i < K; i += 1) {
                if (hue[i] !== c) continue;
                var s = size[i];
                ctx.moveTo(px[i] + s, py[i]);
                ctx.arc(px[i], py[i], s, 0, 6.2832);
            }
            ctx.fill();
        }
    }

    fetch('images/sculpt.json?v=1')
        .then(function (r) { return r.json(); })
        .then(function (d) {
            data = d;
            host.appendChild(canvas);
            host.appendChild(cap);
            host.closest('.sculpt').classList.add('on');
            begin();

            if (reduced) return;
            window.addEventListener('resize', function () {
                var oldW = W;
                fit();
                var f = W / oldW;
                for (var i = 0; i < K; i++) {
                    px[i] *= f; py[i] *= f;
                    var tt = targetOf(i, shape);
                    tx[i] = tt[0]; ty[i] = tt[1];
                }
            });
            host.addEventListener('pointermove', function (e) {
                var r = canvas.getBoundingClientRect();
                mouseX = (e.clientX - r.left) * (W / r.width);
                mouseY = (e.clientY - r.top) * (H / r.height);
            });
            host.addEventListener('pointerleave', function () {
                mouseX = mouseY = -1e4;
            });
            if ('IntersectionObserver' in window) {
                new IntersectionObserver(function (es) {
                    running = es[0].isIntersecting;
                }).observe(host);
            }
        })
        .catch(function () { /* no sculpture; the page stands on its own */ });
})();
