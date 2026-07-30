/* Cinematic touches: staggered scroll reveal + pointer-driven 3-D tilt.
   Everything degrades gracefully — no JS means content is simply visible. */
(function () {
    'use strict';

    var reduced = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---------------------------------------------------- scroll reveal */
    function initReveal() {
        var targets = document.querySelectorAll(
            'section > h2, h3.subsection, .publication, .conference-item, ' +
            '.timeline-item, .contact-item, .essay-card, .about-text, ' +
            '.research-interests, .intro-text'
        );
        if (!targets.length) return;

        if (reduced || !('IntersectionObserver' in window)) return;

        Array.prototype.forEach.call(targets, function (el) {
            el.classList.add('reveal');
        });

        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                var el = entry.target;
                // stagger siblings so groups cascade rather than pop at once
                var delay = Math.min(parseInt(el.dataset.rIndex || 0, 10) * 70, 350);
                setTimeout(function () { el.classList.add('in'); }, delay);
                io.unobserve(el);
            });
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

        // index elements within their own parent for the cascade
        var counters = {};
        Array.prototype.forEach.call(targets, function (el) {
            var key = el.parentNode ? (el.parentNode.className || 'root') : 'root';
            counters[key] = (counters[key] || 0);
            if (el.className.indexOf('publication') > -1 ||
                el.className.indexOf('conference-item') > -1 ||
                el.className.indexOf('timeline-item') > -1 ||
                el.className.indexOf('contact-item') > -1 ||
                el.className.indexOf('essay-card') > -1) {
                el.dataset.rIndex = counters[key]++;
            }
            io.observe(el);
        });
    }

    /* ------------------------------------------------------------ tilt */
    function initTilt() {
        if (reduced) return;
        // pointer tilt is meaningless on touch — and costs jank
        if (!window.matchMedia || !window.matchMedia('(hover: hover)').matches) return;

        var els = document.querySelectorAll(
            '.profile-photo, .essay-card'
        );
        if (!els.length) return;

        var MAX = 3.2; // degrees — a hint of depth, not a gimmick

        Array.prototype.forEach.call(els, function (el) {
            var frame = null;

            function move(e) {
                if (frame) return;
                frame = requestAnimationFrame(function () {
                    frame = null;
                    var r = el.getBoundingClientRect();
                    var px = (e.clientX - r.left) / r.width - 0.5;
                    var py = (e.clientY - r.top) / r.height - 0.5;
                    el.style.setProperty('--ry', (px * MAX * 2).toFixed(2) + 'deg');
                    el.style.setProperty('--rx', (-py * MAX * 2).toFixed(2) + 'deg');
                });
            }

            function reset() {
                if (frame) { cancelAnimationFrame(frame); frame = null; }
                el.style.setProperty('--rx', '0deg');
                el.style.setProperty('--ry', '0deg');
            }

            el.addEventListener('mousemove', move);
            el.addEventListener('mouseleave', reset);
        });
    }

    /* ------------------------------------------------ header parallax */
    function initParallax() {
        if (reduced) return;
        var header = document.querySelector('header');
        if (!header) return;
        var content = header.querySelector('.header-content');
        if (!content) return;

        var frame = null;
        window.addEventListener('scroll', function () {
            if (frame) return;
            frame = requestAnimationFrame(function () {
                frame = null;
                var y = window.pageYOffset;
                if (y > header.offsetHeight) return;   // stop work once past
                // gentle drift only — no fade; on a light header fading reads as a glitch
                content.style.transform = 'translateY(' + (y * 0.07).toFixed(1) + 'px)';
            });
        }, { passive: true });
    }

    function boot() {
        initReveal();
        initTilt();
        initParallax();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
