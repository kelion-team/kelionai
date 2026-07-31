#!/usr/bin/env python3
"""PROBA FORMEI — modelul dă o FORMULĂ, noi o DESENĂM și vedem dacă iese.

Adrian, 31 iul: „dă-i să calculeze o formulă matematică care aplicată să
genereze un ou sau valuri" — după ce a respins probele mele anterioare ca
fiind prea ușoare („ridică nivelul de greutate de 1000000 de ori").

De ce e proba cea mai bună de până acum: nu se poate păcăli. Celelalte cer un
număr, iar un model poate nimeri un număr din tipar. Aici cere o FORMULĂ, iar
formula se evaluează și se desenează. Ori iese un ou, ori nu iese. Verdictul
nu e o părere de-a mea — e geometria curbei rezultate.

Verificăm patru lucruri, toate măsurate pe punctele curbei:
  1. ÎNCHISĂ    — capătul se întoarce la început
  2. ARIE       — nu e o linie degenerată sau un punct
  3. ASIMETRIE  — un capăt mai lat decât celălalt. ASTA face un OU un ou;
                  fără ea e o elipsă, adică problema nerezolvată
  4. SIMPLĂ     — nu se autointersectează (nu e o buclă încâlcită)

La valuri se cere altceva: o suprafață z(x,y) cu oscilație reală în ambele
direcții și cu amplitudine care nu explodează.

SIGURANȚĂ: formula venită de la model se evaluează cu `eval`, dar într-un
mediu în care NU există nimic în afară de funcții matematice — fără import,
fără open, fără os. Un model care încearcă altceva primește eroare, nu acces.
"""
import ast
import json
import math
import sys

# Singurele nume vizibile formulei. Nimic altceva nu există în acel spațiu.
SIGUR = {
    k: getattr(math, k)
    for k in ('sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sqrt',
              'exp', 'log', 'pi', 'e', 'sinh', 'cosh', 'tanh', 'fabs', 'pow', 'hypot')
}
SIGUR.update({'abs': abs, 'min': min, 'max': max})

# Noduri permise în expresie. Un `Call` e permis doar către numele de mai sus
# (verificat separat); `Import`, `Attribute`, `Subscript` etc. nu apar aici,
# deci orice încercare de evadare pică la parsare, nu la execuție.
NODURI_OK = (
    ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant, ast.Name, ast.Load,
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.Mod, ast.USub, ast.UAdd,
    ast.Call, ast.Tuple, ast.IfExp, ast.Compare, ast.Lt, ast.Gt, ast.LtE,
    ast.GtE, ast.Eq, ast.NotEq, ast.FloorDiv,
)


def compileaza(expr: str):
    """Compilează o expresie matematică. Ridică ValueError la orice altceva."""
    arbore = ast.parse(expr.strip(), mode='eval')
    for nod in ast.walk(arbore):
        if not isinstance(nod, NODURI_OK):
            raise ValueError(f'constructie interzisa: {type(nod).__name__}')
        if isinstance(nod, ast.Call):
            if not isinstance(nod.func, ast.Name) or nod.func.id not in SIGUR:
                raise ValueError('apel de functie nepermis')
        if isinstance(nod, ast.Name) and nod.id not in SIGUR and nod.id not in ('t', 'x', 'y'):
            raise ValueError(f'nume necunoscut: {nod.id}')
    return compile(arbore, '<formula>', 'eval')


def evalueaza(cod, **vars_):
    return float(eval(cod, {'__builtins__': {}}, {**SIGUR, **vars_}))


def arie(pts):
    """Aria cu semn (formula lui Gauss). |arie| ~ 0 = curbă degenerată."""
    s = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


def se_intersecteaza(pts, pas=7):
    """Autointersecție, verificată pe segmente ne-vecine (eșantionat, ca să nu
    fie O(n²) pe 720 de puncte)."""
    def orient(a, b, c):
        v = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1])
        return 0 if abs(v) < 1e-12 else (1 if v > 0 else 2)

    segs = [(pts[i], pts[(i + 1) % len(pts)]) for i in range(0, len(pts), pas)]
    n = len(segs)
    for i in range(n):
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue
            p1, q1 = segs[i]
            p2, q2 = segs[j]
            o1, o2, o3, o4 = orient(p1, q1, p2), orient(p1, q1, q2), orient(p2, q2, p1), orient(p2, q2, q1)
            if o1 != o2 and o3 != o4:
                return True
    return False


def probeaza_ou(fx: str, fy: str) -> dict:
    """Desenează curba și spune dacă e ou. Fiecare verdict, cu cifra lui."""
    try:
        cx, cy = compileaza(fx), compileaza(fy)
    except Exception as e:
        return {'ok': False, 'motiv': f'formula respinsa: {e}'}

    pts = []
    try:
        for i in range(720):
            t = 2 * math.pi * i / 720
            pts.append((evalueaza(cx, t=t), evalueaza(cy, t=t)))
    except Exception as e:
        return {'ok': False, 'motiv': f'formula nu se poate evalua: {str(e)[:60]}'}

    if any(not math.isfinite(v) for p in pts for v in p):
        return {'ok': False, 'motiv': 'formula produce infinit sau NaN'}

    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    lat, inalt = max(xs) - min(xs), max(ys) - min(ys)
    if lat < 1e-9 or inalt < 1e-9:
        return {'ok': False, 'motiv': 'curba e degenerata (linie sau punct)'}

    # Normalizăm ca pragurile să nu depindă de scara aleasă de model.
    cx0 = (max(xs) + min(xs)) / 2
    npts = [((x - cx0) / lat, y / inalt) for x, y in pts]

    inchisa = math.dist(pts[0], pts[-1]) / max(lat, inalt) < 0.02
    a = arie(npts)
    incalcita = se_intersecteaza(npts)

    # ASIMETRIA — miezul probei. Un ou e mai lat la un capăt. Comparăm
    # grosimea pe jumătatea stângă cu cea pe jumătatea dreaptă.
    st = [abs(y) for x, y in npts if x < -0.15]
    dr = [abs(y) for x, y in npts if x > 0.15]
    if not st or not dr:
        return {'ok': False, 'motiv': 'curba nu se intinde pe ambele capete'}
    gs, gd = max(st), max(dr)
    asim = abs(gs - gd) / max(gs, gd)

    e_ou = inchisa and a > 0.15 and not incalcita and asim >= 0.08
    return {
        'ok': e_ou,
        'inchisa': inchisa,
        'arie': round(a, 4),
        'asimetrie_pct': round(asim * 100, 1),
        'incalcita': incalcita,
        'motiv': '' if e_ou else (
            'nu e inchisa' if not inchisa else
            'arie prea mica' if a <= 0.15 else
            'se autointersecteaza' if incalcita else
            f'SIMETRICA ({asim*100:.1f}% < 8%) — e o elipsa, nu un ou'
        ),
        'puncte': pts,
    }


def probeaza_valuri(fz: str) -> dict:
    """z(x,y) — trebuie să oscileze REAL în ambele direcții, fără să explodeze."""
    try:
        cz = compileaza(fz)
    except Exception as e:
        return {'ok': False, 'motiv': f'formula respinsa: {e}'}
    # DOMENIUL CONTEAZĂ, și prima variantă l-a luat greșit: eșantiona pe
    # [-3, 3], adică sub o perioadă de sinus (2π ≈ 6.28). Pe atât, `sin(x)`
    # traversează media O SINGURĂ dată — iar verificatorul respingea
    # `sin(x)*cos(y)`, care e val adevărat. Testul era stricat, nu formula.
    # Acum [-2π, 2π]: două perioade întregi pe fiecare axă, deci un val real
    # produce cel puțin patru traversări și nu mai poate fi confundat cu o pantă.
    L = 2 * math.pi
    try:
        g = [[evalueaza(cz, x=-L + 2 * L * i / 47, y=-L + 2 * L * j / 47) for i in range(48)] for j in range(48)]
    except Exception as e:
        return {'ok': False, 'motiv': f'formula nu se poate evalua: {str(e)[:60]}'}

    plate = [v for r in g for v in r]
    if any(not math.isfinite(v) for v in plate):
        return {'ok': False, 'motiv': 'formula produce infinit sau NaN'}
    amp = max(plate) - min(plate)
    if amp < 1e-6:
        return {'ok': False, 'motiv': 'suprafata e plata — niciun val'}
    if amp > 1e6:
        return {'ok': False, 'motiv': 'amplitudine explodeaza'}

    # Un val urcă ȘI coboară: numărăm schimbările de sens pe linii și coloane.
    def treceri(sir):
        m = sum(sir) / len(sir)
        s = [v - m for v in sir]
        return sum(1 for i in range(1, len(s)) if s[i - 1] * s[i] < 0)

    pe_linii = sum(treceri(r) for r in g) / len(g)
    pe_coloane = sum(treceri([g[j][i] for j in range(len(g))]) for i in range(len(g[0]))) / len(g[0])
    # Prag 2: pe două perioade, un val real dă ~4 traversări; o pantă dă 0-1.
    e_val = pe_linii >= 2 and pe_coloane >= 2
    return {
        'ok': e_val,
        'amplitudine': round(amp, 3),
        'oscilatii_x': round(pe_linii, 1),
        'oscilatii_y': round(pe_coloane, 1),
        'motiv': '' if e_val else 'nu oscileaza in ambele directii (val intr-o singura directie sau deloc)',
    }


def svg(pts, cale):
    """Desenul, ca să se poată UITA la el — nu doar să citească un verdict."""
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    lat, inalt = max(xs) - min(xs) or 1, max(ys) - min(ys) or 1
    sc = 300 / max(lat, inalt)
    d = ' '.join(f'{"M" if i == 0 else "L"}{(x - min(xs)) * sc + 20:.1f},{320 - (y - min(ys)) * sc:.1f}'
                 for i, (x, y) in enumerate(pts))
    with open(cale, 'w', encoding='utf-8') as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" width="{lat * sc + 40:.0f}" height="360">'
                f'<path d="{d} Z" fill="#f5e6c8" stroke="#333" stroke-width="2"/></svg>')


if __name__ == '__main__':
    # proba-forma.py ou "<x(t)>" "<y(t)>" [fisier.svg]
    # proba-forma.py valuri "<z(x,y)>"
    mod = sys.argv[1]
    if mod == 'ou':
        r = probeaza_ou(sys.argv[2], sys.argv[3])
        pts = r.pop('puncte', None)
        if pts and len(sys.argv) > 4:
            svg(pts, sys.argv[4])
        print(json.dumps(r, ensure_ascii=False))
    else:
        print(json.dumps(probeaza_valuri(sys.argv[2]), ensure_ascii=False))
