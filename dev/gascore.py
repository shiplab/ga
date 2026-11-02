"""Score what the app proposes against the answer key of an example GA.
   Run: python3 dev/gascore.py psv out/psv-app.json  ->  prints the score and writes examples/keys/psv-score.png
   A compartment of the key is caught when blocks of the app cover at least 60% of its box at the right place:
   plans: x and y, at the height just above the deck of the plan; profile: x and z; section: y and z, near midship.
   Compartments are the named ones and the unnamed ones of 3 m2 or more; smaller ones are counted apart as details."""
import sys, json
import numpy as np
from PIL import Image, ImageDraw

def covered(r, rows, L):
    n = 8
    if r['role'] == 'plan':
        zc = (r['z'] or 0) + 0.5; a0, a1, b0, b1 = r['x0'], r['x1'], r['y0'], r['y1']
        cand = [q for q in rows if q['z0'] - 0.3 <= zc <= q['z1'] + 0.3]; get = lambda q: (q['x0'], q['x1'], q['y0'], q['y1'])
    elif r['role'] == 'profile':
        a0, a1, b0, b1 = r['x0'], r['x1'], r['z0'], r['z1']; cand = rows; get = lambda q: (q['x0'], q['x1'], q['z0'], q['z1'])
    else:
        a0, a1, b0, b1 = r['y0'], r['y1'], r['z0'], r['z1']; cand = [q for q in rows if q['x0'] <= L / 2 <= q['x1']]; get = lambda q: (q['y0'], q['y1'], q['z0'], q['z1'])
    pts = [(a0 + (a1 - a0) * (i + 0.5) / n, b0 + (b1 - b0) * (j + 0.5) / n) for i in range(n) for j in range(n)]
    boxes = [get(q) for q in cand]
    hit = sum(1 for (a, b) in pts if any(c0 - 0.05 <= a <= c1 + 0.05 and d0 - 0.05 <= b <= d1 + 0.05 for c0, c1, d0, d1 in boxes))
    return hit / len(pts)

def iou(r, rows):
    # the best one-to-one match: intersection over union of the boxes, in the view of the compartment
    if r['role'] == 'plan':
        zc = (r['z'] or 0) + 0.5; A = (r['x0'], r['x1'], r['y0'], r['y1']); cand = [(q['x0'], q['x1'], q['y0'], q['y1']) for q in rows if q['z0'] - 0.3 <= zc <= q['z1'] + 0.3]
    elif r['role'] == 'profile':
        A = (r['x0'], r['x1'], r['z0'], r['z1']); cand = [(q['x0'], q['x1'], q['z0'], q['z1']) for q in rows]
    else:
        return 1.0
    best = 0
    aa = (A[1] - A[0]) * (A[3] - A[2])
    for c in cand:
        ix = max(0, min(A[1], c[1]) - max(A[0], c[0])); iy = max(0, min(A[3], c[3]) - max(A[2], c[2])); i = ix * iy
        if i <= 0: continue
        u = aa + (c[1] - c[0]) * (c[3] - c[2]) - i; best = max(best, i / u)
    return best

def main(key, appf):
    K = json.load(open('examples/keys/%s.json' % key)); A = json.load(open(appf)); rows = A['rows']
    L = K['particulars'].get('loa') or 100
    res = {'comp': [0, 0], 'named': [0, 0], 'detail': [0, 0], 'views': {}, 'exact': [0, 0]}
    miss = []
    for r in K['regions']:
        c = covered(r, rows, L); ok = c >= 0.6; r['_iou'] = iou(r, rows)
        cls = 'named' if r['label'] else ('comp' if r['areaM2'] >= 3 else 'detail')
        r['_ok'] = ok; r['_cls'] = cls
        if cls != 'detail':
            res['comp'][0] += ok; res['comp'][1] += 1; res['exact'][0] += r['_iou'] >= 0.5; res['exact'][1] += 1
            v = res['views'].setdefault(r['view'], [0, 0]); v[0] += ok; v[1] += 1
        if cls == 'named': res['named'][0] += ok; res['named'][1] += 1
        if cls == 'detail': res['detail'][0] += ok; res['detail'][1] += 1
        if not ok and cls == 'named': miss.append(r['view'] + ': ' + r['label'])
    # particulars
    P = K['particulars']; I = A.get('info') or {}; pr = []
    for k, v in P.items():
        a = I.get(k) if not (k == 'draught' and I.get(k) in (None, '')) else I.get('draughtDesign'); good = a is not None and a != '' and abs(float(a) - v) <= 0.02 * abs(v) + 1e-9
        pr.append((k, v, a, good))
    pct = lambda p: 100.0 * p[0] / max(1, p[1])
    print('%s: compartments %d of %d (%.0f%%), named %d of %d (%.0f%%), details %d of %d, particulars %d of %d, blocks %d (%s)' % (key, res['comp'][0], res['comp'][1], pct(res['comp']), res['named'][0], res['named'][1], pct(res['named']), res['detail'][0], res['detail'][1], sum(1 for p in pr if p[3]), len(pr), len(rows), A.get('engine')))
    print('   one block per compartment (box overlap of 50%% or more): %d of %d (%.0f%%)' % (res['exact'][0], res['exact'][1], pct(res['exact'])))
    for v, c in res['views'].items(): print('   %-18s %3d of %3d  %.0f%%' % (v, c[0], c[1], pct(c)))
    print('   particulars:', ', '.join('%s %s%s' % (k, a, '' if g else ' (sheet ' + str(v) + ')') for k, v, a, g in pr))
    if miss: print('   named compartments missed (%d): %s' % (len(miss), '; '.join(miss[:40]) + (' ...' if len(miss) > 40 else '')))
    # overlay: green caught, red missed, grey details
    im = Image.open('examples/keys/%s-key.png' % key).convert('RGB')
    import pymupdf
    page = pymupdf.open('examples/' + K['pdf'])[1]; im = page.get_pixmap(dpi=144).pil_image().convert('RGB'); d = ImageDraw.Draw(im, 'RGBA')
    for r in K['regions']:
        x0, y0, x1, y1 = [t * 2 for t in r['pt']]
        col = (150, 150, 150, 40) if r['_cls'] == 'detail' else ((30, 170, 80, 70) if r['_ok'] else (230, 40, 40, 90))
        d.rectangle([x0, y0, max(x0, x1 - 1), max(y0, y1 - 1)], fill=col)
    im.save('examples/keys/%s-score.png' % key)
    json.dump({'key': key, 'compartments': res['comp'], 'named': res['named'], 'details': res['detail'], 'views': res['views'], 'particulars': pr, 'missedNamed': miss}, open('examples/keys/%s-score.json' % key, 'w'), indent=1)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
