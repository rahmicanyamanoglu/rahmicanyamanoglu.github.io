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

    var SPREAD = 1100;        // ms over which particles peel off, one by one
    /* ink and cobalt: charcoal majority, blue accents, pale slate depth */
    var COLORS = ['rgba(40,42,52,', 'rgba(58,84,164,',
                  'rgba(120,138,170,', 'rgba(24,26,34,'];
    /* a whisper of tinted air behind each scene, all in one cool family */
    var TINTS = [[140,160,186], [148,168,190], [136,164,182],
                 [150,160,176], [156,166,184], [148,156,178],
                 [186,174,166], [180,170,152], [168,158,172]];

    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var cap = document.createElement('p');
    cap.className = 'sculpt-cap';
    cap.innerHTML = '<b></b><i></i>';

    var data = null, K = 0;
    var px, py, tx, ty;                 // positions and targets
    var hue, size, alpha, kspr, wobA, wobB, switchAt;
    var seqPos = 0, shape = 0, phaseStart = 0, stepStart = 0, morphing = false;
    var tintFrom = null, tintTo = null, tintT0 = 0;
    var W = 0, H = 0, dpr = 1, sx = 1, sy = 1, ox = 0, oy = 0;
    var mouseX = -1e4, mouseY = -1e4;
    var running = true;

    var sizeScale = 1;

    function fit() {
        var w = host.clientWidth;
        var h = host.clientHeight || Math.round(w * 0.52);
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        W = canvas.width; H = canvas.height;
        // the sculpture lives strictly below the name and nav: measure where
        // the header text ends and fit the scene into what remains
        var topSafe = H * 0.18;
        var hc = document.querySelector('.header-content');
        if (hc) {
            var hr = hc.getBoundingClientRect(), sr = host.getBoundingClientRect();
            topSafe = Math.max(topSafe,
                Math.min(H * 0.55, (hr.bottom - sr.top + 18) * dpr));
        }
        var avail = H - topSafe - H * 0.04;
        var s = Math.min(W * 0.97 / data.w, avail / data.h);
        sx = sy = s;
        ox = (W - data.w * s) / 2;
        oy = H - data.h * s - H * 0.03;
        sizeScale = Math.max(0.7, Math.min(2.2, s * 1.15));
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
            var hr = ((i * 2654435761) >>> 16) % 100;
            hue[i] = hr < 56 ? 0 : (hr < 78 ? 1 : (hr < 90 ? 2 : 3));
            size[i] = (0.9 + Math.random() * 1.4) * dpr;
            alpha[i] = 0.55 + Math.random() * 0.35;
            kspr[i] = 0.045 + Math.random() * 0.05;
            wobA[i] = Math.random() * 6.28;
            wobB[i] = 0.4 + Math.random() * 0.8;
            switchAt[i] = 0;
        }
        shape = data.seq[0][0];
        for (var i2 = 0; i2 < K; i2++) {
            var t2 = targetOf(i2, shape);
            tx[i2] = t2[0]; ty[i2] = t2[1];
        }
        setCaption(shape);
        cap.classList.remove('off');
        phaseStart = stepStart = performance.now();
        tintFrom = tintTo = TINTS[shape];
        tintT0 = phaseStart;

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
        seqPos = (seqPos + 1) % data.seq.length;
        shape = data.seq[seqPos][0];
        for (var i = 0; i < K; i++) {
            switchAt[i] = now + ((i * 2654435761) >>> 8) % SPREAD;
        }
        morphing = true;
        stepStart = now;
        cap.classList.add('off');
        tintFrom = tintTo || tintFrom;
        tintTo = TINTS[shape];
        tintT0 = now;
    }

    function tick(now) {
        if (!running) { requestAnimationFrame(tick); return; }
        var t = now / 1000;

        if (!morphing && now - phaseStart > data.seq[seqPos][1]) scheduleMorph(now);

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
        var mixT = Math.min(1, (performance.now() - tintT0) / (SPREAD + 900));
        var a = tintFrom, b = tintTo;
        if (a || b) {
            var af = a ? 1 - mixT : 0, bf = b ? mixT : 0;
            var tot = af + bf;
            if (tot > 0.01) {
                var cr = ((a ? a[0] * af : 0) + (b ? b[0] * bf : 0)) / tot;
                var cg = ((a ? a[1] * af : 0) + (b ? b[1] * bf : 0)) / tot;
                var cb = ((a ? a[2] * af : 0) + (b ? b[2] * bf : 0)) / tot;
                var grad = ctx.createRadialGradient(W / 2, H * 0.78, H * 0.1,
                                                    W / 2, H * 0.78, H * 0.95);
                grad.addColorStop(0, 'rgba(' + (cr | 0) + ',' + (cg | 0) + ',' +
                                  (cb | 0) + ',' + (0.13 * tot).toFixed(3) + ')');
                grad.addColorStop(1, 'rgba(' + (cr | 0) + ',' + (cg | 0) + ',' +
                                  (cb | 0) + ',0)');
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, W, H);
            }
        }
        for (var c = 0; c < 4; c++) {
            ctx.fillStyle = COLORS[c] + '0.8)';
            ctx.beginPath();
            for (var i = c; i < K; i += 1) {
                if (hue[i] !== c) continue;
                var s = size[i] * sizeScale;
                ctx.moveTo(px[i] + s, py[i]);
                ctx.arc(px[i], py[i], s, 0, 6.2832);
            }
            ctx.fill();
        }
    }

    fetch('images/sculpt.json?v=4')
        .then(function (r) { return r.json(); })
        .then(function (d) {
            data = d;
            host.appendChild(canvas);
            host.appendChild(cap);
            var header = host.closest('header');
            if (header) header.classList.add('sculpt-on');
            // measure only after the header has taken its hero height
            requestAnimationFrame(begin);

            if (reduced) return;
            window.addEventListener('resize', function () {
                var oldW = W, oldH = H;
                fit();
                var fx = W / oldW, fy = H / oldH;
                for (var i = 0; i < K; i++) {
                    px[i] *= fx; py[i] *= fy;
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
