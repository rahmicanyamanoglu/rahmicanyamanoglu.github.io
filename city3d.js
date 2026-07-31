/* The city, in three dimensions.

   No library. Solids come from city.json in world units; every frame they
   are rotated about the vertical axis, tilted, projected, sorted back to
   front and painted. Faces are lit from a direction fixed in world space,
   so turning the city moves the light across it the way it should.

   With JavaScript off the page keeps the flat axonometric SVG, which is
   why the canvas only replaces it once the data has actually loaded. */
(function () {
    'use strict';

    var stage = document.querySelector('.city-stage');
    if (!stage || !window.requestAnimationFrame) return;

    var canvas = document.createElement('canvas');
    if (!canvas.getContext) return;
    var ctx = canvas.getContext('2d');

    var reduced = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var TILT = 0.47;              // an establishing shot, not a plan
    var yaw = Math.PI / 4;        // start where the flat drawing left off
    var targetYaw = yaw;
    var drag = null;
    var city = null;
    var W = 0, H = 0, dpr = 1, scale = 1, cx = 0, cy = 0, originY = 0;
    var zoom = 1, targetZoom = 1, baseScale = 1;

    var LIGHT = (function () {
        var v = [-0.45, -0.72, 0.62], m = Math.hypot(v[0], v[1], v[2]);
        return [v[0] / m, v[1] / m, v[2] / m];
    })();

    /* ---------------------------------------------------------- palette */
    var BGF = [23, 28, 41];         // the night the distance dissolves into

    /* depth of field on the cheap: aerial perspective. The further a face
       sits, the more its colour is pulled toward the background, so the
       skyline melts away instead of stopping at a hard edge. */
    function fogOf(z) {
        var t = (6 - z) / 24;
        return t < 0 ? 0 : (t > 0.8 ? 0.8 : t);
    }

    function shade(base, lum, fog) {
        var t = Math.max(0, Math.min(1, lum));
        var f = fog || 0;
        return 'rgb(' + Math.round(base[0] * t * (1 - f) + BGF[0] * f) + ',' +
                        Math.round(base[1] * t * (1 - f) + BGF[1] * f) + ',' +
                        Math.round(base[2] * t * (1 - f) + BGF[2] * f) + ')';
    }
    var WALL = [88, 98, 122];
    var ROOFC = [126, 137, 160];
    var PITCH = [104, 115, 140];
    var PAD = [40, 47, 63];
    var GRND = [32, 38, 52];
    var ROADC = [52, 60, 79];
    var GLASS = [30, 35, 48];
    var LIT = [222, 178, 108];

    /* ------------------------------------------------------- projection */
    function project(p) {
        var sx = p[0] - cx, sy = p[1] - cy;
        var c = Math.cos(yaw), s = Math.sin(yaw);
        var rx = sx * c - sy * s;
        var ry = sx * s + sy * c;
        return [rx * scale,
                (ry * Math.cos(TILT) - p[2] * Math.sin(TILT)) * scale + originY,
                ry];                                     // ry = depth order
    }

    function faceLum(n) {
        var d = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2];
        return 0.62 + 0.38 * Math.max(0, d);
    }

    /* Quad given as four world points. Culled when it faces away. */
    function quad(out, pts, base, forceLum) {
        var a = project(pts[0]), b = project(pts[1]), c = project(pts[2]),
            d = project(pts[3]);
        var lum = forceLum;
        if (lum === undefined) {
            var u = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]];
            var v = [pts[3][0] - pts[0][0], pts[3][1] - pts[0][1], pts[3][2] - pts[0][2]];
            var n = [u[1] * v[2] - u[2] * v[1],
                     u[2] * v[0] - u[0] * v[2],
                     u[0] * v[1] - u[1] * v[0]];
            var m = Math.hypot(n[0], n[1], n[2]) || 1;
            lum = faceLum([n[0] / m, n[1] / m, n[2] / m]);
        }
        var zc = (a[2] + b[2] + c[2] + d[2]) / 4;
        var f = { z: zc, pts: [a, b, c, d],
                  fill: shade(base, lum, fogOf(zc)), lum: lum };
        out.push(f);
        return f;
    }

    /* A grid of windows on a wall. The projection is affine, so bilinear
       interpolation of the four projected corners lands every window exactly
       on the wall plane — no extra faces, no sorting cost. Painted with the
       face itself, nearer walls simply cover them. */
    function glaze(f, lenW, hW, seed) {
        if (lenW < 0.45 || hW < 0.55) return;
        var fog = fogOf(f.z);
        if (fog > 0.5) return;          // too deep in the dark to resolve glass
        f.win = { rows: Math.min(12, Math.max(1, Math.round(hW / 0.45))),
                  cols: Math.min(9, Math.max(1, Math.round(lenW / 0.36))),
                  seed: seed };
        f.winFill = shade(GLASS, 1, fog);
        f.litFill = shade(LIT, 1, fog * 1.1);
    }

    function tri(out, pts, base, lum) {
        var a = project(pts[0]), b = project(pts[1]), c = project(pts[2]);
        var zc = (a[2] + b[2] + c[2]) / 3;
        out.push({ z: zc, pts: [a, b, c], fill: shade(base, lum, fogOf(zc)) });
    }

    /* ------------------------------------------------------------ build */
    function faces() {
        var ground = [], out = [];
        var e = city.extent;
        quad(ground, [[e[0], e[1], 0], [e[2], e[1], 0], [e[2], e[3], 0], [e[0], e[3], 0]],
             GRND, 1);
        (city.roads || []).forEach(function (r) {
            quad(ground, [[r[0], r[1], .015], [r[0] + r[2], r[1], .015],
                          [r[0] + r[2], r[1] + r[3], .015], [r[0], r[1] + r[3], .015]],
                 ROADC, 1);
            var vert = r[3] > r[2];
            var m1 = vert ? [r[0] + r[2] / 2, r[1], .02] : [r[0], r[1] + r[3] / 2, .02];
            var m2 = vert ? [r[0] + r[2] / 2, r[1] + r[3], .02]
                          : [r[0] + r[2], r[1] + r[3] / 2, .02];
            ground.push({ line: [project(m1), project(m2)], dash: true });
        });

        city.plots.forEach(function (p) {
            quad(ground, [[p[0], p[1], .03], [p[0] + p[2], p[1], .03],
                          [p[0] + p[2], p[1] + p[3], .03], [p[0], p[1] + p[3], .03]],
                 PAD, 1);
        });

        city.solids.forEach(function (s, si) {
            var x = s.x, y = s.y, w = s.w, d = s.d, h = s.h / 26;   // world z
            if (s.t === 'tree') {
                var t = project([x, y, 0]);
                out.push({ z: t[2], tree: t, r: 0.16 * scale });
                return;
            }
            if (s.t === 'lamp') {
                var lb = project([x, y, 0]), lt = project([x, y, h]);
                out.push({ z: lb[2], lamp: [lb, lt], r: 0.05 * scale });
                return;
            }
            if (s.t === 'car') {
                var x1c = x + w, y1c = y + d;
                quad(out, [[x, y, 0], [x1c, y, 0], [x1c, y, h], [x, y, h]], [66, 76, 98]);
                quad(out, [[x1c, y, 0], [x1c, y1c, 0], [x1c, y1c, h], [x1c, y, h]], [66, 76, 98]);
                quad(out, [[x1c, y1c, 0], [x, y1c, 0], [x, y1c, h], [x1c, y1c, h]], [66, 76, 98]);
                quad(out, [[x, y1c, 0], [x, y, 0], [x, y, h], [x, y1c, h]], [66, 76, 98]);
                quad(out, [[x, y, h], [x1c, y, h], [x1c, y1c, h], [x, y1c, h]], [104, 114, 138], 1);
                return;
            }
            var x1 = x + w, y1 = y + d;
            var f1 = quad(out, [[x, y, 0], [x1, y, 0], [x1, y, h], [x, y, h]], WALL);
            var f2 = quad(out, [[x1, y, 0], [x1, y1, 0], [x1, y1, h], [x1, y, h]], WALL);
            var f3 = quad(out, [[x1, y1, 0], [x, y1, 0], [x, y1, h], [x1, y1, h]], WALL);
            var f4 = quad(out, [[x, y1, 0], [x, y, 0], [x, y, h], [x, y1, h]], WALL);
            glaze(f1, w, h, si * 4);
            glaze(f2, d, h, si * 4 + 1);
            glaze(f3, w, h, si * 4 + 2);
            glaze(f4, d, h, si * 4 + 3);

            if (s.t === 'pitch') {
                var r = s.r / 26, mx = x + w / 2;
                quad(out, [[x, y, h], [mx, y, h + r], [mx, y1, h + r], [x, y1, h]], PITCH);
                quad(out, [[mx, y, h + r], [x1, y, h], [x1, y1, h], [mx, y1, h + r]], PITCH);
                tri(out, [[x, y, h], [x1, y, h], [mx, y, h + r]], PITCH, .95);
                tri(out, [[x1, y1, h], [x, y1, h], [mx, y1, h + r]], PITCH, .72);
            } else if (s.c === 'spire') {
                var ax = x + w / 2, ay = y + d / 2, ah = h + w * 0.85;
                tri(out, [[x, y, h], [x1, y, h], [ax, ay, ah]], ROOFC, .96);
                tri(out, [[x1, y, h], [x1, y1, h], [ax, ay, ah]], ROOFC, .80);
                tri(out, [[x1, y1, h], [x, y1, h], [ax, ay, ah]], ROOFC, .66);
                tri(out, [[x, y1, h], [x, y, h], [ax, ay, ah]], ROOFC, .86);
            } else if (s.c === 'dome') {
                var p = project([x + w / 2, y + d / 2, h]);
                out.push({ z: p[2], dome: p, r: w * 0.5 * scale });
            } else {
                quad(out, [[x, y, h], [x1, y, h], [x1, y1, h], [x, y1, h]], ROOFC, 1);
            }
            if (s.c === 'needle') {
                out.push({ z: project([x + w / 2, y + d / 2, h])[2],
                           line: [project([x + w / 2, y + d / 2, h]),
                                  project([x + w / 2, y + d / 2, h + w * 1.4])] });
            }
        });
        return { ground: ground, solid: out };
    }

    /* ------------------------------------------------------------- draw */
    function frame() {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        var Wd = W / dpr, Hd = H / dpr;
        var sky = ctx.createLinearGradient(0, 0, 0, Hd);
        sky.addColorStop(0, '#232b3d');
        sky.addColorStop(1, '#12161f');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, Wd, Hd);
        ctx.save();
        ctx.translate(W / 2, H / 2);

        var built = faces();
        built.solid.sort(function (a, b) { return a.z - b.z; });
        var list = built.ground.concat(built.solid);

        var bx = W / dpr / 2 + 30, by = H / dpr / 2 + 30;
        for (var i = 0; i < list.length; i++) {
            var f = list[i];
            if (f.pts) {
                var vis = false;
                for (var vk = 0; vk < f.pts.length; vk++) {
                    var vp = f.pts[vk];
                    if (vp[0] > -bx && vp[0] < bx && vp[1] > -by && vp[1] < by) {
                        vis = true; break;
                    }
                }
                if (!vis) continue;
            }
            if (f.tree) {
                ctx.fillStyle = shade([52, 66, 58], 1, fogOf(f.z));
                ctx.beginPath();
                ctx.ellipse(f.tree[0] - f.r * .5, f.tree[1] - f.r * .9,
                            f.r * .62, f.r * .82, 0, 0, Math.PI * 2);
                ctx.ellipse(f.tree[0] + f.r * .45, f.tree[1] - f.r * 1.05,
                            f.r * .58, f.r * .78, 0, 0, Math.PI * 2);
                ctx.ellipse(f.tree[0], f.tree[1] - f.r * 1.45,
                            f.r * .66, f.r * .85, 0, 0, Math.PI * 2);
                ctx.fill();
                continue;
            }
            if (f.lamp) {
                var fg = fogOf(f.z);
                ctx.strokeStyle = 'rgba(120,130,155,' + (0.8 * (1 - fg)).toFixed(2) + ')';
                ctx.lineWidth = Math.max(1, 0.03 * scale);
                ctx.beginPath();
                ctx.moveTo(f.lamp[0][0], f.lamp[0][1]);
                ctx.lineTo(f.lamp[1][0], f.lamp[1][1]);
                ctx.stroke();
                ctx.fillStyle = 'rgba(236,196,124,' + (0.16 * (1 - fg)).toFixed(2) + ')';
                ctx.beginPath();
                ctx.arc(f.lamp[1][0], f.lamp[1][1], f.r * 2.6, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = shade(LIT, 1, fg * 0.6);
                ctx.beginPath();
                ctx.arc(f.lamp[1][0], f.lamp[1][1], f.r * 0.85, 0, Math.PI * 2);
                ctx.fill();
                continue;
            }
            if (f.dome) {
                ctx.fillStyle = shade([126, 137, 160], 1, fogOf(f.z));
                ctx.beginPath();
                ctx.ellipse(f.dome[0], f.dome[1], f.r, f.r * 1.15, 0, Math.PI, Math.PI * 2);
                ctx.fill();
                continue;
            }
            if (f.line) {
                if (f.dash) {
                    ctx.strokeStyle = 'rgba(196,206,228,.4)';
                    ctx.lineWidth = Math.max(1, 0.055 * scale);
                    ctx.setLineDash([0.34 * scale, 0.42 * scale]);
                } else {
                    ctx.strokeStyle = 'rgba(150,160,185,' + (0.85 * (1 - fogOf(f.z))).toFixed(2) + ')';
                    ctx.lineWidth = Math.max(1, 1.6 * scale / 26);
                }
                ctx.beginPath();
                ctx.moveTo(f.line[0][0], f.line[0][1]);
                ctx.lineTo(f.line[1][0], f.line[1][1]);
                ctx.stroke();
                ctx.setLineDash([]);
                continue;
            }
            ctx.fillStyle = f.fill;
            ctx.beginPath();
            ctx.moveTo(f.pts[0][0], f.pts[0][1]);
            for (var k = 1; k < f.pts.length; k++) ctx.lineTo(f.pts[k][0], f.pts[k][1]);
            ctx.closePath();
            ctx.fill();

            if (f.win) {
                var A = f.pts[0], B = f.pts[1], C = f.pts[2], D = f.pts[3];
                // skip when the wall is too small on screen to resolve glass
                var hv = Math.hypot(D[0] - A[0], D[1] - A[1]);
                var wv = Math.hypot(B[0] - A[0], B[1] - A[1]);
                if (hv > 13 && wv > 9) {
                    var rows = f.win.rows, cols = f.win.cols, seed = f.win.seed;
                    var u0 = .1, v0 = .12, du = .8 / cols, dv = .76 / rows;
                    var fw = du * .58, fh = dv * .55;
                    for (var pass = 0; pass < 2; pass++) {
                        ctx.fillStyle = pass ? f.litFill : f.winFill;
                        ctx.beginPath();
                        var any = false;
                        for (var ri = 0; ri < rows; ri++) {
                            for (var ci = 0; ci < cols; ci++) {
                                var lit = ((ri * 7 + ci * 13 + seed * 29) % 10) < 2;
                                if ((pass === 1) !== lit) continue;
                                any = true;
                                var u = u0 + ci * du + (du - fw) / 2;
                                var v = v0 + ri * dv + (dv - fh) / 2;
                                for (var e = 0; e < 4; e++) {
                                    var uu = u + (e === 1 || e === 2 ? fw : 0);
                                    var vv = v + (e >= 2 ? fh : 0);
                                    var bx = A[0] + (B[0] - A[0]) * uu,
                                        by = A[1] + (B[1] - A[1]) * uu,
                                        tx = D[0] + (C[0] - D[0]) * uu,
                                        ty = D[1] + (C[1] - D[1]) * uu;
                                    var px = bx + (tx - bx) * vv,
                                        py = by + (ty - by) * vv;
                                    if (e === 0) ctx.moveTo(px, py);
                                    else ctx.lineTo(px, py);
                                }
                                ctx.closePath();
                            }
                        }
                        if (any) ctx.fill();
                    }
                }
            }
        }
        ctx.restore();
        var vig = ctx.createRadialGradient(Wd / 2, Hd * 0.42, Hd * 0.3,
                                           Wd / 2, Hd * 0.42, Math.max(Wd, Hd) * 0.78);
        vig.addColorStop(0, 'rgba(8,10,16,0)');
        vig.addColorStop(1, 'rgba(8,10,16,0.5)');
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, Wd, Hd);
    }

    /* ------------------------------------------------------------ sizing */
    function resize() {
        var rect = stage.getBoundingClientRect();
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = Math.round(rect.width * dpr);
        H = Math.round(rect.width * 0.7 * dpr);
        canvas.width = W;
        canvas.height = H;
        canvas.style.width = '100%';
        canvas.style.height = (rect.width * 0.7) + 'px';
        var e = city.extent;
        cx = (e[0] + e[2]) / 2;
        cy = (e[1] + e[3]) / 2;
        baseScale = rect.width * dpr / ((e[2] - e[0]) * 0.78);
        scale = baseScale * zoom;
        originY = H * 0.20;
        frame();
    }

    /* ------------------------------------------------------------- loop */
    var spinning = !reduced;
    function tick() {
        if (spinning) targetYaw += 0.0016;
        var dy = targetYaw - yaw, dz = targetZoom - zoom;
        if (Math.abs(dy) > 0.0002 || Math.abs(dz) > 0.0004) {
            yaw += dy * (drag ? 1 : 0.09);
            zoom += dz * 0.12;
            scale = baseScale * zoom;
            frame();
        }
        requestAnimationFrame(tick);
    }

    /* --------------------------------------------------------- controls */
    function bind() {
        stage.addEventListener('pointerdown', function (e) {
            drag = { x: e.clientX, yaw: targetYaw };
            spinning = false;
            stage.setPointerCapture(e.pointerId);
            stage.classList.add('is-turning');
        });
        stage.addEventListener('pointermove', function (e) {
            if (!drag) return;
            targetYaw = drag.yaw + (e.clientX - drag.x) * 0.008;
        });
        function release() {
            drag = null;
            stage.classList.remove('is-turning');
        }
        stage.addEventListener('pointerup', release);
        stage.addEventListener('pointercancel', release);
        stage.addEventListener('mouseenter', function () { spinning = false; });
        stage.addEventListener('mouseleave', function () {
            if (!reduced) spinning = true;
        });
        window.addEventListener('resize', resize);
    }

    fetch('images/city.json?v=6')
        .then(function (r) { return r.json(); })
        .then(function (data) {
            city = data;
            var img = stage.querySelector('img');
            if (img) img.remove();
            stage.insertBefore(canvas, stage.firstChild);
            stage.classList.add('is-3d');
            resize();
            bind();
            tick();
        })
        .catch(function () { /* the flat SVG stays; nothing to undo */ });
})();
