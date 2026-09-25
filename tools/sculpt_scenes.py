#!/usr/bin/env python3
"""Scene builder for the entrance sculpture (images/sculpt.json).

The six original scenes came from a generator that was never committed;
only its output survived. This is the generator for scenes added since,
and the one place the data format is written down, so the next scene
does not start from reverse engineering.

Format
------
sculpt.json = {
  "w": 1500, "h": 620,        design frame; sculpt.js scales it into the hero
  "k": 5200,                  particles, shared by every scene
  "shapes": [scene, ...],
  "seq": [[shape_index, hold_ms], ...]   loop order and dwell
}
scene = {
  "n": "CN Tower",            caption, first line
  "c": "Toronto, Canada",     caption, second line
  "t": [r, g, b],             tint of the air behind the scene (optional;
                              sculpt.js falls back to its TINTS table)
  "a": [[start, end, kind, speed, phase, range], ...]
                              actors: particle ranges [start, end) that move,
                              always at the tail of the array. kinds —
                              0 gull loop · 1 sway · 2 stroll · 3 ride · 4 arc.
                              2 and 3 travel a triangle wave `range`*W wide.
  "p": [x0, y0, x1, y1, ...]  k integer targets inside the frame
}

What the existing scenes hold to: the landmark is centred and reaches
y ~ 20-40; the ground or shore sits between y ~ 505 and 567; points fall
at an even density over filled shapes, with windows and doors cut out as
negative space; static particles are shuffled so a morph streams rather
than sweeps; the loop runs in the order the places were lived in.

Usage:  python3 tools/sculpt_scenes.py
Rebuilds every scene defined here in place, leaving the others untouched.
Requires Pillow. Output is deterministic.
"""
import json
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'images' / 'sculpt.json'
W, H, K = 1500, 620, 5200


# ------------------------------------------------------------- sampling

class Sheet:
    """A weight map drawn painter-style: later shapes cover earlier ones,
    holes are drawn as 0. Pixel value = density weight x 100."""

    def __init__(self, w=W, h=H):
        self.w, self.h = w, h
        self.im = Image.new('L', (w, h), 0)
        self.d = ImageDraw.Draw(self.im)

    @staticmethod
    def v(weight):
        return max(1, min(255, int(round(weight * 100))))


def scatter(sheet, n, rng, min_d=2.1):
    """n points over the sheet, density proportional to weight, with a
    light minimum spacing so dots do not pile onto each other."""
    w = sheet.w
    cand, wts = [], []
    flat = getattr(sheet.im, 'get_flattened_data', sheet.im.getdata)
    for i, val in enumerate(flat()):
        if val:
            cand.append(i)
            wts.append(val)
    cell = min_d
    grid = {}
    out = []
    attempts, limit = 0, 60 * n
    while len(out) < n:
        for i in rng.choices(cand, weights=wts, k=2048):
            x = i % w + rng.random()
            y = i // w + rng.random()
            attempts += 1
            gx, gy = int(x // cell), int(y // cell)
            if attempts < limit:
                crowded = False
                for ix in (gx - 1, gx, gx + 1):
                    for iy in (gy - 1, gy, gy + 1):
                        for (qx, qy) in grid.get((ix, iy), ()):
                            if (qx - x) ** 2 + (qy - y) ** 2 < min_d * min_d:
                                crowded = True
                                break
                        if crowded:
                            break
                    if crowded:
                        break
                if crowded:
                    continue
            grid.setdefault((gx, gy), []).append((x, y))
            out.append((x, y))
            if len(out) == n:
                break
    return out


def along(path, n, rng, jitter=1.1):
    """n points spread along a polyline, lightly jittered."""
    segs, total = [], 0.0
    for (x0, y0), (x1, y1) in zip(path, path[1:]):
        L = math.hypot(x1 - x0, y1 - y0)
        segs.append((x0, y0, x1, y1, L))
        total += L
    pts = []
    for k in range(n):
        s = (k + 0.5) / n * total
        for x0, y0, x1, y1, L in segs:
            if s <= L:
                f = s / L if L else 0
                pts.append((x0 + (x1 - x0) * f + rng.uniform(-jitter, jitter),
                            y0 + (y1 - y0) * f + rng.uniform(-jitter, jitter)))
                break
            s -= L
    return pts


# ------------------------------------------------------------- actors

def gull(cx, cy, n, rng, span=64, lift=7):
    """Two shallow arches meeting at the body: the bird every child draws,
    sized like the gulls already circling Lund and Collemaggio."""
    path = []
    for k in range(41):
        u = -1 + 2 * k / 40
        path.append((cx + u * span / 2, cy - lift * math.sin(math.pi * abs(u))))
    return along(path, n, rng, jitter=0.9)


def sailboat(x, water, n, rng, scale=1.0):
    """A long hull, a clear gap, one tall mainsail off the mast. The jib is
    left out on purpose: two sails either side of a mast make a symmetric
    triangle on a stem, which at dot resolution is a tree. Asymmetry and
    a hull wider than the sail are what read as a boat."""
    s = scale
    sh = Sheet()
    d = sh.d
    v = Sheet.v(1)
    d.polygon([(x - 30 * s, water - 8 * s), (x + 30 * s, water - 8 * s),
               (x + 21 * s, water), (x - 19 * s, water)], fill=v)         # hull
    d.line([(x - 4 * s, water - 8 * s), (x - 4 * s, water - 66 * s)],
           fill=v, width=2)                                                # mast
    d.polygon([(x - 1 * s, water - 61 * s), (x - 1 * s, water - 14 * s),
               (x + 27 * s, water - 14 * s)], fill=v)                      # main
    return scatter(sh, n, rng, min_d=2.3)


# ------------------------------------------------------------- scenes

def building(d, x0, x1, top, ground, weight, style, rng):
    v = Sheet.v(weight)
    d.rectangle([x0, top, x1, ground], fill=v)
    if style == 'slits':                       # glass curtain wall
        for x in range(int(x0) + 6, int(x1) - 4, 9):
            d.rectangle([x, top + 8, x + 1.6, ground - 12], fill=0)
    elif style == 'grid':                      # punched windows
        for y in range(int(top) + 9, int(ground) - 14, 14):
            for x in range(int(x0) + 6, int(x1) - 6, 11):
                d.rectangle([x, y, x + 4, y + 6], fill=0)
    elif style == 'bands':                     # floor plates
        for y in range(int(top) + 10, int(ground) - 10, 12):
            d.rectangle([x0 + 4, y, x1 - 4, y + 2], fill=0)


def tree(d, x, ground, h, weight):
    v = Sheet.v(weight)
    d.rectangle([x - 1.5, ground - h * 0.28, x + 1.5, ground], fill=v)
    d.polygon([(x - h * 0.24, ground - h * 0.26), (x, ground - h),
               (x + h * 0.24, ground - h * 0.26)], fill=v)


def toronto(rng):
    """The postcard view from the islands: the CN Tower rising alone, the
    Rogers Centre dome at its foot, the towers of the financial district
    kept low and light so the needle stays the subject, Lake Ontario in
    front with two boats working it and gulls over the water."""
    sh = Sheet()
    d = sh.d
    c, ground = 750, 505
    TOWER, DOME, RIB, CITY, SHORE, WATER = 1.5, 0.45, 1.5, 0.72, 1.4, 1.2

    # -- the lake, drawn first so everything stands on it
    for y in (527, 547, 566):
        x = 40 + rng.uniform(0, 30)
        while x < 1460:
            L = rng.uniform(18, 70)
            d.rectangle([x, y, min(x + L, 1460), y + 2.6], fill=Sheet.v(WATER))
            x += L + rng.uniform(14, 46)
    d.rectangle([40, ground - 1, 1460, ground + 2], fill=Sheet.v(SHORE))

    # -- waterfront condos, west
    for x0, x1, top, style in ((70, 110, 432, 'grid'), (126, 166, 388, 'slits'),
                               (182, 226, 362, 'slits'), (242, 282, 402, 'grid'),
                               (298, 336, 440, 'bands')):
        building(d, x0, x1, top, ground, CITY, style, rng)
    for x, h in ((372, 40), (410, 32), (446, 44)):
        tree(d, x, ground, h, 1.0)

    # -- Rogers Centre: segmented dome over an arcaded drum
    dome = [468, 404, 676, 520]
    cx = (dome[0] + dome[2]) / 2
    d.pieslice(dome, 180, 360, fill=Sheet.v(DOME))
    for k in (1.0, 0.68, 0.36):                            # rim and panel seams
        rx = (dome[2] - dome[0]) / 2 * k
        d.arc([cx - rx, dome[1], cx + rx, dome[3]], 180, 360,
              fill=Sheet.v(RIB), width=5)
    d.rectangle([cx - 2.5, dome[1], cx + 2.5, 462], fill=Sheet.v(RIB))  # crown seam
    d.rectangle([468, 462, 676, ground], fill=Sheet.v(1.0))            # drum
    for x in range(476, 668, 21):
        d.rectangle([x, 471, x + 11, 494], fill=0)

    # -- financial district, east: held under the pod's height
    for x0, x1, top, style in ((836, 896, 456, 'grid'), (914, 958, 372, 'slits'),
                               (976, 1032, 330, 'slits'), (1050, 1100, 352, 'bands'),
                               (1118, 1170, 386, 'grid'), (1188, 1228, 414, 'slits'),
                               (1246, 1296, 440, 'grid'), (1314, 1354, 464, 'bands')):
        building(d, x0, x1, top, ground, CITY, style, rng)
    # Scotia Plaza's chamfered crown, cut back in two steps
    for step, inset in ((0, 14), (10, 7)):
        d.rectangle([1050, 352 + step, 1050 + inset, 362 + step], fill=0)
        d.rectangle([1100 - inset, 352 + step, 1100, 362 + step], fill=0)
    for x, h in ((1392, 38), (1432, 46)):
        tree(d, x, ground, h, 1.0)

    # -- the CN Tower, drawn last so nothing crosses it
    v = Sheet.v(TOWER)
    d.rectangle([c - 64, 494, c + 64, ground], fill=Sheet.v(CITY))        # podium
    d.polygon([(c - 50, ground), (c - 30, 493), (c - 22, 478), (c - 12, 222),
               (c + 12, 222), (c + 22, 478), (c + 30, 493), (c + 50, ground)],
              fill=v)                                                      # shaft
    d.polygon([(c - 13, 225), (c - 42, 208), (c + 42, 208), (c + 13, 225)],
              fill=v)                                                      # pod skirt
    d.rounded_rectangle([c - 61, 199, c + 61, 209], radius=5, fill=v)      # halo ring
    d.rectangle([c - 47, 187, c + 47, 199], fill=v)                        # glass band
    d.rectangle([c - 45, 192, c + 45, 194], fill=0)
    d.polygon([(c - 44, 188), (c - 22, 178), (c + 22, 178), (c + 44, 188)],
              fill=v)                                                      # pod cap
    d.polygon([(c - 9, 179), (c - 7, 121), (c + 7, 121), (c + 9, 179)],
              fill=v)                                                      # upper shaft
    d.rounded_rectangle([c - 20, 103, c + 20, 123], radius=7, fill=v)      # SkyPod
    d.rectangle([c - 17, 112, c + 17, 114], fill=0)
    d.polygon([(c - 5, 105), (c - 1.4, 27), (c + 1.4, 27), (c + 5, 105)],
              fill=v)                                                      # antenna
    for y, hw in ((90, 6.5), (66, 4.6), (45, 3.2)):
        d.rectangle([c - hw, y, c + hw, y + 3], fill=v)
    d.line([(c, 27), (c, 20)], fill=v, width=2)

    # actors, in the order they will sit at the tail of the array
    actors = [
        (gull(400, 150, 28, rng), (0, 1.0, 0.9, 0)),
        (gull(1130, 118, 26, rng, span=58, lift=6), (0, 1.0, 3.8, 0)),
        (sailboat(330, 570, 84, rng, scale=1.35), (2, 0.03, 1.3, 0.22)),
        (sailboat(1150, 549, 52, rng, scale=0.95), (2, -0.022, 4.0, 0.16)),
    ]
    n_static = K - sum(len(pts) for pts, _ in actors)
    static = scatter(sh, n_static, rng)
    rng.shuffle(static)

    pts, a, i = list(static), [], n_static
    for p, (kind, sp, ph, rg) in actors:
        a.append([i, i + len(p), kind, sp, ph, rg])
        pts.extend(p)
        i += len(p)
    flat = []
    for x, y in pts:
        flat += [min(W - 1, max(0, int(round(x)))), min(H - 1, max(0, int(round(y))))]
    return {'n': 'CN Tower', 'c': 'Toronto, Canada', 't': [186, 176, 164],
            'a': a, 'p': flat}


# scene builder, hold in ms, and the scene it follows in the loop
SCENES = [
    (toronto, 6000, 'Galata Bridge'),     # Istanbul 2014-20, Toronto 2020, then Lund
]


def main():
    data = json.loads(DATA.read_text(encoding='utf-8'))
    for build, hold, after in SCENES:
        scene = build(random.Random(build.__name__))
        assert len(scene['p']) == 2 * data['k']
        names = [s['n'] for s in data['shapes']]
        if scene['n'] in names:                       # rebuild in place
            idx = names.index(scene['n'])
            data['shapes'][idx] = scene
            data['seq'] = [st for st in data['seq'] if st[0] != idx]
        else:
            idx = len(data['shapes'])
            data['shapes'].append(scene)
        prev = names.index(after)
        at = next(j for j, st in enumerate(data['seq']) if st[0] == prev) + 1
        data['seq'].insert(at, [idx, hold])
    DATA.write_text(json.dumps(data, separators=(',', ':')), encoding='utf-8')
    print('scenes:', ' -> '.join(data['shapes'][s]['n'] for s, _ in data['seq']))


if __name__ == '__main__':
    main()
