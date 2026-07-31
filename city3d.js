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

    var TILT = 0.60;              // low enough to read facades, not a plan
    var yaw = Math.PI / 4;        // start where the flat drawing left off
    var targetYaw = yaw;
    var drag = null;
    var city = null;
    var pins = [];
    var W = 0, H = 0, dpr = 1, scale = 1, cx = 0, cy = 0, originY = 0;
    var zoom = 1, targetZoom = 1, baseScale = 1;

    var LIGHT = (function () {
        var v = [-0.45, -0.72, 0.62], m = Math.hypot(v[0], v[1], v[2]);
        return [v[0] / m, v[1] / m, v[2] / m];
    })();

    /* ---------------------------------------------------------- palette */
    function shade(base, lum) {
        var t = Math.max(0, Math.min(1, lum));
        return 'rgb(' + Math.round(base[0] * t) + ',' +
                        Math.round(base[1] * t) + ',' +
                        Math.round(base[2] * t) + ')';
    }
    var WALL = [214, 196, 170];
    var ROOFC = [206, 188, 160];
    var PITCH = [198, 172, 140];
    var PAD = [229, 220, 204];
    var GRND = [239, 232, 219];
    var LEAF = [168, 179, 148];

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
        out.push({ z: (a[2] + b[2] + c[2] + d[2]) / 4,
                   pts: [a, b, c, d], fill: shade(base, lum) });
    }

    function tri(out, pts, base, lum) {
        var a = project(pts[0]), b = project(pts[1]), c = project(pts[2]);
        out.push({ z: (a[2] + b[2] + c[2]) / 3,
                   pts: [a, b, c], fill: shade(base, lum) });
    }

    /* ------------------------------------------------------------ build */
    function faces() {
        var ground = [], out = [];
        var e = city.extent;
        quad(ground, [[e[0], e[1], 0], [e[2], e[1], 0], [e[2], e[3], 0], [e[0], e[3], 0]],
             GRND, 1);
        city.plots.forEach(function (p) {
            quad(ground, [[p[0], p[1], .01], [p[0] + p[2], p[1], .01],
                          [p[0] + p[2], p[1] + p[3], .01], [p[0], p[1] + p[3], .01]],
                 PAD, 1);
        });

        city.solids.forEach(function (s) {
            var x = s.x, y = s.y, w = s.w, d = s.d, h = s.h / 26;   // world z
            if (s.t === 'tree') {
                var t = project([x, y, 0]);
                out.push({ z: t[2], tree: t, r: 0.16 * scale });
                return;
            }
            var x1 = x + w, y1 = y + d;
            // four walls, wound so the outward face survives the cull
            quad(out, [[x, y, 0], [x1, y, 0], [x1, y, h], [x, y, h]], WALL);
            quad(out, [[x1, y, 0], [x1, y1, 0], [x1, y1, h], [x1, y, h]], WALL);
            quad(out, [[x1, y1, 0], [x, y1, 0], [x, y1, h], [x1, y1, h]], WALL);
            quad(out, [[x, y1, 0], [x, y, 0], [x, y, h], [x, y1, h]], WALL);

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
        ctx.clearRect(0, 0, W, H);
        ctx.save();
        ctx.translate(W / 2, H / 2);

        var built = faces();
        built.solid.sort(function (a, b) { return a.z - b.z; });
        var list = built.ground.concat(built.solid);

        for (var i = 0; i < list.length; i++) {
            var f = list[i];
            if (f.tree) {
                ctx.fillStyle = 'rgb(168,179,148)';
                ctx.beginPath();
                ctx.ellipse(f.tree[0], f.tree[1] - f.r * 1.15, f.r * .85, f.r * 1.25,
                            0, 0, Math.PI * 2);
                ctx.fill();
                continue;
            }
            if (f.dome) {
                ctx.fillStyle = 'rgb(206,188,160)';
                ctx.beginPath();
                ctx.ellipse(f.dome[0], f.dome[1], f.r, f.r * 1.15, 0, Math.PI, Math.PI * 2);
                ctx.fill();
                continue;
            }
            if (f.line) {
                ctx.strokeStyle = 'rgba(109,90,72,.85)';
                ctx.lineWidth = Math.max(1, 1.6 * scale / 26);
                ctx.beginPath();
                ctx.moveTo(f.line[0][0], f.line[0][1]);
                ctx.lineTo(f.line[1][0], f.line[1][1]);
                ctx.stroke();
                continue;
            }
            ctx.fillStyle = f.fill;
            ctx.beginPath();
            ctx.moveTo(f.pts[0][0], f.pts[0][1]);
            for (var k = 1; k < f.pts.length; k++) ctx.lineTo(f.pts[k][0], f.pts[k][1]);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
        placePins();
    }

    function placePins() {
        for (var i = 0; i < pins.length; i++) {
            var a = city.anchors[i];
            var p = project([a.x, a.y, a.z / 26]);
            pins[i].style.left = ((W / 2 + p[0]) / dpr).toFixed(1) + 'px';
            pins[i].style.top = ((H / 2 + p[1]) / dpr).toFixed(1) + 'px';
        }
    }

    /* ------------------------------------------------------------ sizing */
    function resize() {
        var rect = stage.getBoundingClientRect();
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = Math.round(rect.width * dpr);
        H = Math.round(rect.width * 0.62 * dpr);
        canvas.width = W;
        canvas.height = H;
        canvas.style.width = '100%';
        canvas.style.height = (rect.width * 0.62) + 'px';
        var e = city.extent;
        cx = (e[0] + e[2]) / 2;
        cy = (e[1] + e[3]) / 2;
        baseScale = rect.width * dpr / ((e[2] - e[0]) * 1.16);
        scale = baseScale * zoom;
        originY = H * 0.18;
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
            if (e.target.closest('.city-pin')) return;
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
        stage.addEventListener('wheel', function (e) {
            if (!e.deltaY) return;
            e.preventDefault();
            targetZoom = Math.max(0.75, Math.min(3.4,
                targetZoom * (e.deltaY < 0 ? 1.12 : 0.89)));
        }, { passive: false });

        pins.forEach(function (pin, i) {
            pin.addEventListener('click', function () {
                var a = city.anchors[i];
                spinning = false;
                targetZoom = targetZoom > 1.6 ? 1 : 2.4;
                // turn the district towards the viewer
                targetYaw = -Math.atan2(a.y - cy, a.x - cx) + Math.PI / 2;
            });
        });

        stage.addEventListener('mouseenter', function () { spinning = false; });
        stage.addEventListener('mouseleave', function () {
            if (!reduced) spinning = true;
        });
        window.addEventListener('resize', resize);
    }

    fetch('images/city.json')
        .then(function (r) { return r.json(); })
        .then(function (data) {
            city = data;
            pins = Array.prototype.slice.call(stage.querySelectorAll('.city-pin'));
            if (pins.length !== city.anchors.length) return;   // markup drifted
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
