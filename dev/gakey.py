"""Answer key of an example GA (vector PDF, page 2): what a reader should get out of the drawing.
   Every enclosed compartment of each view (profile, plans, section) is found by drawing the solid lines of the PDF
   and taking the white areas they enclose; the labels inside name them. Positions in ship metres:
   x forward from the aft end of the view's hull, y to port (plans), z up from the baseline (profile).
   Run: python3 dev/gakey.py examples/GA_PSV_Example.pdf psv   -> examples/keys/psv.json and psv-key.png (overlay)
   The view rectangles, the scale and the deck heights of the plans are given per drawing below (checked by eye)."""
import sys, json, math, re
import pymupdf, numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

PART = {
  'psv': {'loa': 92, 'lbp': 85, 'beam': 20, 'depth': 8.2, 'draught': 6.2, 'dwt': 4900, 'speed': 14.5},
  'river': {'loa': 150, 'beam': 21, 'gt': 15000, 'passengers': 640, 'cabins': 230, 'depth': 7.0, 'draught': 3.0},
  'tanker': {'loa': 250, 'lbp': 240, 'beam': 44, 'depth': 21.4, 'draughtDesign': 13.5, 'draught': 15.0, 'dwt': 115000, 'cargoVol': 122000, 'speed': 14.5, 'cargoTanks': 12, 'slopTanks': 2},
}
CFG = {
  # fwd: direction of the bow on the page ('right' or 'up'); side: direction of port (plans) or up (profile) on the page
  'psv': {'scale': ('bar',), 'thinShort': (0.2, 7.0), 'gap': 0.8, 'views': [
      {'name': 'Profile', 'role': 'profile', 'rect': [40, 60, 560, 250], 'fwd': 'right', 'side': 'up', 'base': 238.42, 'ppmA': (238.42 - 201.9) / 8.2},
      {'name': 'Main deck', 'role': 'plan', 'rect': [40, 266, 560, 390], 'fwd': 'right', 'side': 'up', 'z': 8.2},
      {'name': 'Tank deck', 'role': 'plan', 'rect': [40, 405, 560, 528], 'fwd': 'right', 'side': 'up', 'z': 5.0},
      {'name': 'Tank top', 'role': 'plan', 'rect': [40, 541, 560, 646], 'fwd': 'right', 'side': 'up', 'z': 0.55}]},
  'river': {'scale': ('bar',), 'gap': 1.6, 'views': [
      {'name': 'Observation deck', 'role': 'plan', 'rect': [40, 60, 360, 133.5], 'fwd': 'right', 'side': 'up', 'z': 22.0},
      {'name': 'Sun deck', 'role': 'plan', 'rect': [40, 142, 520, 220.5], 'fwd': 'right', 'side': 'up', 'z': 19.0},
      {'name': 'Bridge deck', 'role': 'plan', 'rect': [40, 229.5, 520, 308.5], 'fwd': 'right', 'side': 'up', 'z': 16.0},
      {'name': 'Executive deck', 'role': 'plan', 'rect': [40, 317.5, 520, 395.5], 'fwd': 'right', 'side': 'up', 'z': 13.0},
      {'name': 'Promenade deck', 'role': 'plan', 'rect': [40, 404.5, 540, 483.5], 'fwd': 'right', 'side': 'up', 'z': 10.0},
      {'name': 'Upper deck', 'role': 'plan', 'rect': [40, 492.5, 540, 570.5], 'fwd': 'right', 'side': 'up', 'z': 7.0},
      {'name': 'Main deck', 'role': 'plan', 'rect': [40, 579.5, 540, 656.5], 'fwd': 'right', 'side': 'up', 'z': 4.0},
      {'name': 'Lower deck', 'role': 'plan', 'rect': [40, 665.5, 540, 743], 'fwd': 'right', 'side': 'up', 'z': 1.2}]},
  'tanker': {'scale': ('loa',), 'ignore': r'^(\d+|H|CL|BL|Ts|Td)$', 'ppmAcross': 91.46 / 44, 'views': [
      {'name': 'Profile', 'role': 'profile', 'rect': [150, 215, 285, 752], 'fwd': 'up', 'side': 'left', 'base': 262.04},
      {'name': 'Upper deck', 'role': 'plan', 'rect': [290, 215, 405, 752], 'fwd': 'up', 'side': 'left', 'z': 21.4},
      {'name': 'Tank top', 'role': 'plan', 'rect': [405, 215, 520, 752], 'fwd': 'up', 'side': 'left', 'z': 2.4},
      {'name': 'Midship section', 'role': 'section', 'rect': [212, 50, 290, 185], 'fwd': 'out', 'side': 'up', 'zdir': 'left', 'cl': 119.93, 'base': 262.04, 'ppm': 91.46 / 44, 'ppmA': 91.46 / 44}]},
}
S = 6.0                                   # pixels per point of the drawing for the region search

def bez(p0, p1, p2, p3, n=10):
    return [((1-t)**3*p0.x + 3*(1-t)**2*t*p1.x + 3*(1-t)*t*t*p2.x + t**3*p3.x, (1-t)**3*p0.y + 3*(1-t)**2*t*p1.y + 3*(1-t)*t*t*p2.y + t**3*p3.y) for t in [i/n for i in range(n+1)]]

def solid_paths(page, thin=None):
    out = []
    for d in page.get_drawings():
        dash = d.get('dashes') or ''
        if dash and dash.strip() not in ('[] 0', '[]0', ''): continue        # dashed: centrelines, draught marks, hidden lines
        if d.get('type') == 'f': continue                                    # fills only (no stroke)
        for it in d['items']:
            if it[0] == 'l': out.append([(it[1].x, it[1].y), (it[2].x, it[2].y)])
            elif it[0] == 'c': out.append(bez(it[1], it[2], it[3], it[4]))
            elif it[0] == 're': r = it[1]; out.append([(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1), (r.x0, r.y0)])
            elif it[0] == 'qu': q = it[1]; out.append([(q.ul.x, q.ul.y), (q.ur.x, q.ur.y), (q.lr.x, q.lr.y), (q.ll.x, q.ll.y), (q.ul.x, q.ul.y)])
    if thin: out = drop_marks(out, page, thin)
    return out

def drop_marks(paths, page, thin):
    # hatching marks and arrow heads: short thin strokes with a free end (not ending on another line)
    segs = [((a, b), (c, d)) for p in paths for (a, b), (c, d) in zip(p, p[1:])]
    from collections import defaultdict
    grid = defaultdict(list)
    def key(x, y): return (int(x // 1.0), int(y // 1.0))
    for i, (p0, p1) in enumerate(segs):
        for q in (p0, p1): grid[key(*q)].append(i)
    def touches(q, i):
        kx, ky = key(*q)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in grid[(kx + dx, ky + dy)]:
                    if j == i: continue
                    a, b = segs[j]
                    # q on segment j (end or body)
                    vx, vy = b[0] - a[0], b[1] - a[1]; L2 = vx * vx + vy * vy
                    t = 0 if L2 == 0 else max(0, min(1, ((q[0] - a[0]) * vx + (q[1] - a[1]) * vy) / L2))
                    if math.hypot(a[0] + t * vx - q[0], a[1] + t * vy - q[1]) < 0.35: return True
        return False
    # index segment bodies too (coarse): add every segment to the cells it passes
    for i, (p0, p1) in enumerate(segs):
        n = int(max(abs(p1[0] - p0[0]), abs(p1[1] - p0[1]))) + 1
        for k in range(n + 1):
            c = key(p0[0] + (p1[0] - p0[0]) * k / n, p0[1] + (p1[1] - p0[1]) * k / n)
            if i not in grid[c]: grid[c].append(i)
    keep = []
    for i, (p0, p1) in enumerate(segs):
        L = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        if L < thin[1] and not (touches(p0, i) and touches(p1, i)): continue
        keep.append([p0, p1])
    return keep

def scale_bar(words):
    # the numbers 0 .. 50 of a scale bar on one row: points per metre
    nums = [(w, re.sub(r'[^0-9]', '', w[4])) for w in words if re.fullmatch(r'\d+( ?m)?', w[4]) or w[4] == 'm']
    rows = {}
    for w, n in nums:
        if n: rows.setdefault(round(w[1]), []).append(((w[0] + w[2]) / 2, int(n)))
    best = None
    for y, r in rows.items():
        r.sort()
        if len(r) >= 4 and r[0][1] == 0 and all(r[i+1][1] > r[i][1] for i in range(len(r)-1)):
            k = (r[-1][0] - r[0][0]) / (r[-1][1] - r[0][1])
            if best is None or len(r) > best[1]: best = (k, len(r), y)
    return best

def main(pdf, key, pdf1info=None):
    cfg = CFG[key]; doc = pymupdf.open(pdf); page = doc[1]; words = page.get_text('words')
    paths = solid_paths(page, cfg.get('thinShort'))
    # words with their line grouping (labels)
    lines = {}
    for w in words: lines.setdefault((w[5], w[6]), []).append(w)
    labels = [{'s': ' '.join(a[4] for a in ws), 'x': (min(a[0] for a in ws) + max(a[2] for a in ws)) / 2, 'y': (min(a[1] for a in ws) + max(a[3] for a in ws)) / 2} for ws in lines.values()]
    ppm = None
    if cfg['scale'][0] == 'bar':
        sb = scale_bar(words); ppm = sb[0]; scale_from = 'scale bar on the sheet (%d numbers)' % sb[1]
    out = {'pdf': pdf.split('/')[-1], 'particulars': PART.get(key, {}), 'page': 2, 'axes': 'x forward from the aft end of the hull in each view, y to port, z up from the baseline; metres', 'views': [], 'regions': []}
    full = Image.new('RGB', (int(page.rect.width * 2), int(page.rect.height * 2)), 'white')
    full = page.get_pixmap(dpi=144).pil_image().convert('RGB'); dfull = ImageDraw.Draw(full, 'RGBA')
    drawings = page.get_drawings()
    def frame(v):
        x0, y0, x1, y1 = v['rect']; up = v['fwd'] == 'up'; al = []; acr = []
        for p in paths:
            if not all(x0 <= a <= x1 and y0 <= b <= y1 for a, b in p): continue
            for (a, b), (c, d) in zip(p, p[1:]):
                acr += [a, c] if up else [b, d]
                hor = abs(b - d) < 0.05 if not up else abs(a - c) < 0.05
                if hor and (abs(a - c) if not up else abs(b - d)) > 3: continue      # long lines along the ship: centreline, ruler, decks
                al += [b, d] if up else [a, c]
        aft = max(al) if up else min(al); fore = min(al) if up else max(al)
        mid = (min(acr) + max(acr)) / 2; ref = mid
        if v['role'] == 'plan':
            best = None
            for d in drawings:
                if not d.get('dashes') or d['dashes'].strip() == '[] 0': continue
                r = d['rect']
                if r.x0 >= x0 - 1 and r.x1 <= x1 + 1 and r.y0 >= y0 - 1 and r.y1 <= y1 + 1 and (r.height if up else r.width) > 0.4 * ((y1 - y0) if up else (x1 - x0)):
                    c = (r.x0 + r.x1) / 2 if up else (r.y0 + r.y1) / 2
                    if abs(c - mid) < 0.02 * (max(acr) - min(acr)) and (best is None or abs(c - mid) < abs(best - mid)): best = c
            if best is not None: ref = best
        elif v['role'] == 'profile': ref = (max(acr) if v['side'] == 'left' else min(acr)) if up else max(acr)   # baseline: the side away from the deckhouse
        ref = v.get('base', ref); aft = v.get('aft', aft)
        return aft, fore, ref, min(acr), max(acr)
    pend = []
    for v in cfg['views']:
        x0, y0, x1, y1 = v['rect']; W, H = int((x1 - x0) * S), int((y1 - y0) * S)
        img = Image.new('L', (W, H), 255); dr = ImageDraw.Draw(img)
        for p in paths:
            if all(not (x0 - 2 <= a <= x1 + 2 and y0 - 2 <= b <= y1 + 2) for a, b in p): continue
            dr.line([((a - x0) * S, (b - y0) * S) for a, b in p], fill=0, width=2)
        ink = np.array(img) <= 128
        pend.append((v, ink)); continue
    # scale from LOA (tanker): the profile hull length, from the extent of the ink of the profile
    if cfg['scale'][0] == 'loa':
        v = [p for p in pend if p[0]['role'] == 'plan'][0][0]; fr = frame(v)
        ppm = float(abs(fr[1] - fr[0]) / cfg.get('loa', 250.0)); scale_from = 'deck plan length = LOA %g m' % cfg.get('loa', 250.0)
    out['scale'] = {'ptPerMetre': round(ppm, 4), 'from': scale_from, 'doorGapClosedM': cfg.get('gap', 0.4)}
    pend2 = []
    for v, ink in pend:
        r = max(1, int(round(cfg.get('gap', 0.4) / 2 * ppm * S)))         # close door openings up to 'gap' metres wide
        yy, xx = np.mgrid[-r:r + 1, -r:r + 1]; disk = (xx * xx + yy * yy) <= r * r
        thick = ndimage.binary_dilation(ink, structure=disk)
        a = ~thick
        lab, n = ndimage.label(a)
        border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
        sl = ndimage.find_objects(lab)
        regs = []
        for i, s in enumerate(sl, 1):
            if i in border or s is None: continue
            area = int((lab[s] == i).sum())
            regs.append({'id': i, 'px': (max(0, s[1].start - r), max(0, s[0].start - r), s[1].stop + r, s[0].stop + r), 'area_px': area})
        # grow every region back by the closing radius, inside the white of the drawing
        grown = np.zeros_like(lab)
        for q in regs:
            x0p, y0p, x1p, y1p = q['px']; sub = lab[y0p:y1p, x0p:x1p] == q['id']
            g = ndimage.binary_dilation(sub, structure=disk) & ~ink[y0p:y1p, x0p:x1p]
            grown[y0p:y1p, x0p:x1p][g & (grown[y0p:y1p, x0p:x1p] == 0)] = q['id']; q['area_px'] = int(g.sum())
        pend2.append((v, regs, grown))
    pend = pend2
    minA = (1.0 * ppm * S) ** 2                                         # regions under 1 m2 are details
    ppm0 = ppm
    for v, regs, lab in pend:
        x0, y0 = v['rect'][0], v['rect'][1]; ppm = v.get('ppm', ppm0)
        regs = [r for r in regs if r['area_px'] >= minA]
        if not regs: continue
        # the hull of the view: extents of all regions; origin at the aft end, centreline in the middle (plans), baseline at the bottom (profile)
        X0 = min(r['px'][0] for r in regs); X1 = max(r['px'][2] for r in regs); Y0 = min(r['px'][1] for r in regs); Y1 = max(r['px'][3] for r in regs)
        if v.get('ext'):                                                # the hull ends and sides given by hand (pt), where the regions leak
            e = v['ext']; X0, Y0, X1, Y1 = [(e[0] - x0) * S, (e[1] - y0) * S, (e[2] - x0) * S, (e[3] - y0) * S]
        aft, fore, ref, amin, amax = frame(v); v['_frame'] = (aft, fore, ref)
        def tom(px, py):                                                # pixel of the view -> metres (along, across)
            X, Y = x0 + px / S, y0 + py / S                              # page points
            pa = v.get('ppmA', cfg.get('ppmAcross', ppm))               # across and up (the drawing can be stretched along the length)
            if v['fwd'] == 'right':
                along = (X - aft) / ppm; across = (ref - Y) / pa
            elif v['fwd'] == 'up':
                along = (aft - Y) / ppm; across = (ref - X) / pa
                if v['role'] == 'profile': across = (ref - X) / pa if v['side'] == 'left' else (X - ref) / pa
            elif v.get('zdir') == 'left':                               # section on a turned sheet: z to the left, port down
                along = (Y - v['cl']) / pa; across = (v['base'] - X) / pa
            else:                                                       # section: y to port (left on the page), z up from the bottom of the outline
                along = (ref - X) / ppm; across = (amax_y - Y) / ppm
            return along, across
        if v['role'] == 'section':
            ys_ = [b for p in paths if all(x0 <= a <= v['rect'][2] and y0 <= b <= v['rect'][3] for a, b in p) for a, b in p]; amax_y = v.get('base', max(ys_)) if v.get('zdir') != 'left' else None
        L = abs(fore - aft) / ppm; B = (amax - amin) / v.get('ppmA', cfg.get('ppmAcross', ppm))
        vrec = {'name': v['name'], 'role': v['role'], 'rectPt': v['rect'], 'z': v.get('z'), 'lengthM': round(L, 2), 'acrossM': round(B, 2), 'aftPt': round(aft, 2), 'refPt': round(ref, 2), 'regions': 0}
        out['views'].append(vrec)
        for r in regs:
            px0, py0, px1, py1 = r['px']
            c1 = tom(px0, py0); c2 = tom(px1, py1)
            al = sorted([c1[0], c2[0]]); ac = sorted([c1[1], c2[1]])
            m = lab == r['id']
            names = [l['s'] for l in labels if not re.fullmatch(cfg.get('ignore', '^$'), l['s']) and x0 <= l['x'] <= v['rect'][2] and y0 <= l['y'] <= v['rect'][3] and 0 <= int((l['y'] - y0) * S) < m.shape[0] and 0 <= int((l['x'] - x0) * S) < m.shape[1] and m[int((l['y'] - y0) * S), int((l['x'] - x0) * S)]]
            rec = {'view': v['name'], 'pt': [round(x0 + px0 / S, 2), round(y0 + py0 / S, 2), round(x0 + px1 / S, 2), round(y0 + py1 / S, 2)], 'role': v['role'], 'z': v.get('z'), 'label': ' / '.join(names), 'areaM2': round(r['area_px'] / (S * S * ppm * v.get('ppmA', cfg.get('ppmAcross', ppm))), 1)}
            if v['role'] == 'plan': rec.update({'x0': round(al[0], 2), 'x1': round(al[1], 2), 'y0': round(ac[0], 2), 'y1': round(ac[1], 2)})
            elif v['role'] == 'profile': rec.update({'x0': round(al[0], 2), 'x1': round(al[1], 2), 'z0': round(ac[0], 2), 'z1': round(ac[1], 2)})
            else: rec.update({'y0': round(al[0], 2), 'y1': round(al[1], 2), 'z0': round(ac[0], 2), 'z1': round(ac[1], 2)})
            out['regions'].append(rec); vrec['regions'] += 1
            # overlay: the region in a colour, labelled ones darker
            k = 144 / 72 / S
            nreg = len(out['regions'])
            pal = [(66, 133, 244), (52, 168, 83), (251, 188, 5), (171, 71, 188), (0, 172, 193), (255, 112, 67), (124, 179, 66), (92, 107, 192)]
            col = pal[nreg % len(pal)] + ((110,) if rec['label'] else (70,))
            sub = Image.fromarray((m[py0:py1, px0:px1] * 255).astype('uint8')).resize((max(1, int((px1 - px0) * k)), max(1, int((py1 - py0) * k))))
            tint = Image.new('RGBA', sub.size, col); full.paste(tint, (int((x0 + px0 / S) * 2), int((y0 + py0 / S) * 2)), sub.point(lambda q: col[3] if q > 128 else 0))
    labs_in = [l for l in labels if not re.fullmatch(cfg.get('ignore', '^$'), l['s']) and any(v['rect'][0] <= l['x'] <= v['rect'][2] and v['rect'][1] <= l['y'] <= v['rect'][3] for v in cfg['views'])]
    out['labels'] = len(labs_in); out['labelsInRegions'] = sum(1 for l in labs_in if any(l['s'] in r['label'] for r in out['regions']))
    json.dump(out, open('examples/keys/%s.json' % key, 'w'), indent=1)
    full.save('examples/keys/%s-key.png' % key)
    print(key, 'scale', out['scale'], 'regions', len(out['regions']), 'labels', out['labels'], 'in regions', out['labelsInRegions'])
    for v in out['views']: print('  ', v)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
