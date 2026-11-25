# Rally Riot — rackets (v2). Exec'd by build_models.py after avatar.py (uses loft_profile / stroke / to_mesh from there).
# Six frame families (one per rarity), exported as public/models/racket_<family>.glb:
#   classic (common)  isometric head, bumper guard          aero (uncommon)   teardrop head, aero bulges
#   blade (rare)      angular hex head, swept fins          storm (epic)      lightning bolts off the frame
#   seraph (legendary) layered feather wings + halo         celestial (mythical) crescent moon, star spires, orbit ring
# Every racket: frame swept along the head outline with a rounded-rect section, glowing accent groove on both faces,
# T-joint, tapered shaft with a glow ring, throat, octagonal grip with spiral overwrap tape, flared butt cap, strings
# clipped to the head shape. Grip butt at the origin, handle up +Z, string bed in the XZ plane, head centre at RK_Z.
# Material names the game recolors: Frame (painted with a per-racket pattern shader), Trim, Accent (glow), Grip, GripTape, Strings.
import bpy, bmesh, math
from mathutils import Vector

RK_Z = 0.56
RACKET_FAMILIES = ["classic", "aero", "blade", "storm", "seraph", "celestial"]


def rk_mats():
    return {
        "Frame": mat("Frame", (0.85, 0.85, 0.9), metal=0.4, rough=0.3), "Trim": mat("Trim", (0.2, 0.2, 0.25), metal=0.5, rough=0.3),
        "Accent": mat("Accent", (0.2, 0.8, 1.0), emit=2.0, rough=0.2), "Grip": mat("Grip", (0.08, 0.08, 0.1), rough=0.9),
        "GripTape": mat("GripTape", (0.9, 0.9, 0.95), rough=0.9), "Strings": mat("Strings", (0.95, 0.95, 0.95), rough=0.6),
    }


def superellipse(rx, rz, n, top_wide=0.0):
    def f(t):
        a = t * math.tau; c, s = math.cos(a), math.sin(a)
        x = rx * math.copysign(abs(c) ** (2 / n), c) * (1 + top_wide * max(0.0, s)); z = rz * math.copysign(abs(s) ** (2 / n), s)
        return x, z
    return f


def polygon_outline(pts, round_k=0.25):
    """closed polygon with softened corners -> f(t)"""
    P = [Vector((x, z)) for x, z in pts]; n = len(P)
    sm = []
    for i in range(n):
        a, b, c = P[i - 1], P[i], P[(i + 1) % n]
        for k in range(5):   # quadratic Bezier around each corner: from the incoming edge, via the corner, to the outgoing edge
            u = k / 4
            sm.append((1 - u) ** 2 * (b + (a - b) * round_k) + 2 * u * (1 - u) * b + u * u * (b + (c - b) * round_k))
    L = len(sm)
    def f(t):
        x = t * L; i = int(x) % L; fr = x - int(x)
        q = sm[i].lerp(sm[(i + 1) % L], fr); return q.x, q.y
    return f


def sweep(name, f, m, w=0.012, d=0.016, n=96, closed=True, t0=0.0, t1=1.0, width=None, off=0.0, yoff=0.0, sub=1):
    """sweep a rounded-rect section (w in-plane, d along y) along outline f(t) (x, z around RK_Z)"""
    sec = [(1, 0.6), (0.6, 1), (-0.6, 1), (-1, 0.6), (-1, -0.6), (-0.6, -1), (0.6, -1), (1, -0.6)]
    bm = bmesh.new(); rings = []
    cnt = n if closed else n + 1
    for i in range(cnt):
        t = t0 + (t1 - t0) * i / n
        x, z = f(t); x2, z2 = f(t + 1e-3)
        tan = Vector((x2 - x, z2 - z)).normalized(); nrm = Vector((tan.y, -tan.x))     # outward for a CCW outline
        k = width(i / n) if width else 1.0
        base = Vector((x, z)) + nrm * off
        ring = []
        for cx, cy in sec:
            p = base + nrm * (cx * w * k)
            ring.append(bm.verts.new((p.x, yoff + cy * d * max(0.35, k), RK_Z + p.y)))
        rings.append(ring)
    segs = len(sec)
    for i in range(len(rings) - (0 if closed else 1)):
        a, b = rings[i], rings[(i + 1) % len(rings)]
        for j in range(segs): bm.faces.new((a[j], a[(j + 1) % segs], b[(j + 1) % segs], b[j]))
    if not closed:
        bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _mesh_obj(name, bm, m)
    if sub:
        s = ob.modifiers.new("sub", "SUBSURF"); s.levels = sub
    return ob


def inside(f, x, z, n=160):
    pts = [f(i / n) for i in range(n)]; c = False
    for i in range(n):
        (x1, z1), (x2, z2) = pts[i], pts[i - 1]
        if (z1 > z) != (z2 > z) and x < (x2 - x1) * (z - z1) / (z2 - z1 + 1e-12) + x1: c = not c
    return c


def string_bed(f, m, inset=0.9, nv=11, nh=13):
    g = lambda t: tuple(v * inset for v in f(t))
    xs = [g(i / 200)[0] for i in range(200)]; zs = [g(i / 200)[1] for i in range(200)]
    xmin, xmax, zmin, zmax = min(xs), max(xs), min(zs), max(zs)
    parts = []
    for i in range(nv):
        x = xmin + (i + 1) * (xmax - xmin) / (nv + 1)
        zin = [z for z in [zmin + k * (zmax - zmin) / 120 for k in range(121)] if inside(g, x, z)]
        if zin: parts.append(box((0.0026, 0.0026, max(zin) - min(zin)), (x, 0, RK_Z + (max(zin) + min(zin)) / 2), m, "s"))
    for i in range(nh):
        z = zmin + (i + 1) * (zmax - zmin) / (nh + 1)
        xin = [x for x in [xmin + k * (xmax - xmin) / 120 for k in range(121)] if inside(g, x, z)]
        if xin: parts.append(box((max(xin) - min(xin), 0.0026, 0.0026), ((max(xin) + min(xin)) / 2, 0, RK_Z + z), m, "s"))
    return join(parts, "Strings")


def racket_common(M, f, head_bottom, glow=True):
    """grip, tape, butt cap, throat, shaft, T-joint, frame, glow grooves, strings"""
    o = []
    oct_ = lambda t, a: (1 + 0.06 * math.cos(a * 8), 0)                              # octagonal grip
    o.append(loft_profile("Grip", [(0.02, 0.0175, 0.0175), (0.235, 0.0172, 0.0172)], segs=16, mat=M["Grip"], subsurf=0, shape=oct_))
    tape = [Vector((math.cos(k / 10 * math.tau) * 0.0192, math.sin(k / 10 * math.tau) * 0.0192, 0.03 + k * 0.0026)) for k in range(76)]
    o.append(stroke("GripTape", tape, 0.0032, M["GripTape"], res=2))
    o.append(loft_profile("ButtCap", [(0.0, 0.019, 0.019), (0.012, 0.024, 0.024), (0.024, 0.021, 0.021), (0.03, 0.0185, 0.0185)], segs=16,
                          mat=M["Trim"], cap_bottom=True, subsurf=1))
    o.append(loft_profile("ButtGlow", [(0.008, 0.0245, 0.0245), (0.016, 0.0248, 0.0248)], segs=16, mat=M["Accent"], solidify=0.002, subsurf=0))
    o.append(loft_profile("Throat", [(0.232, 0.0185, 0.0185), (0.25, 0.016, 0.016), (0.275, 0.0085, 0.0085)], segs=12, mat=M["Trim"], subsurf=1))
    top = RK_Z + head_bottom
    o.append(loft_profile("Shaft", [(0.27, 0.0078, 0.0078), (top - 0.03, 0.0068, 0.0068)], segs=10, mat=M["Frame"], subsurf=0))
    o.append(loft_profile("ShaftGlow", [(0.3, 0.0085, 0.0085), (0.316, 0.0085, 0.0085)], segs=10, mat=M["Accent"], subsurf=0))
    o.append(loft_profile("TJoint", [(top - 0.035, 0.008, 0.008), (top - 0.005, 0.022, 0.012), (top + 0.012, 0.03, 0.013)], segs=12, mat=M["Frame"], subsurf=1))
    o.append(sweep("FrameHead", f, M["Frame"], w=0.011, d=0.015))
    if glow:
        for sg in (-1, 1): o.append(sweep("Groove", f, M["Accent"], w=0.0035, d=0.0022, yoff=sg * 0.0158, sub=0))
    o.append(string_bed(f, M["Strings"]))
    return o


def star(name, c, r, m, rot=0.0, thick=0.008):
    """4-point star: a lofted diamond in the string plane"""
    bm = bmesh.new(); pts = []
    for i in range(8):   # c is relative to the head centre (x, _, z)
        a = i / 8 * math.tau + rot; rr = r if i % 2 == 0 else r * 0.32
        pts.append((c.x + math.cos(a) * rr, RK_Z + c.z + math.sin(a) * rr))
    top = [bm.verts.new((x, thick, z)) for x, z in pts]; bot = [bm.verts.new((x, -thick, z)) for x, z in pts]
    ft = bm.verts.new((c.x, thick * 1.8, RK_Z + c.z)); fb = bm.verts.new((c.x, -thick * 1.8, RK_Z + c.z))
    for i in range(8):
        bm.faces.new((top[i], top[(i + 1) % 8], ft)); bm.faces.new((bot[(i + 1) % 8], bot[i], fb))
        bm.faces.new((top[(i + 1) % 8], top[i], bot[i], bot[(i + 1) % 8]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _mesh_obj(name, bm, m)


def feather(name, root, ang, ln, wd, m):
    """flat curved feather blade in the string plane, root at `root` (x, z), pointing at angle `ang`"""
    bm = bmesh.new(); n = 7; L, R = [], []
    d = Vector((math.cos(ang), math.sin(ang))); nrm = Vector((-d.y, d.x))
    for i in range(n):
        t = i / (n - 1); w = wd * math.sin(min(1, t * 1.25) * math.pi * 0.5) * (1 - t ** 3)
        bend = nrm * (0.25 * ln * t * t)
        p = Vector(root) + d * (ln * t) + bend
        L.append(p + nrm * w); R.append(p - nrm * w * 0.6)
    vt = [bm.verts.new((p.x, 0.004, RK_Z + p.y)) for p in L + list(reversed(R))]
    vb = [bm.verts.new((p.x, -0.004, RK_Z + p.y)) for p in L + list(reversed(R))]
    bm.faces.new(vt); bm.faces.new(list(reversed(vb)))
    k = len(vt)
    for i in range(k): bm.faces.new((vt[i], vb[i], vb[(i + 1) % k], vt[(i + 1) % k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _mesh_obj(name, bm, m)


def build_racket_family(fam):
    s = new_scene("racket_" + fam); M = rk_mats(); o = []
    if fam == "classic":
        f = superellipse(0.118, 0.15, 2.5)
        o += racket_common(M, f, -0.15, glow=False)
        o.append(sweep("Bumper", f, M["Trim"], w=0.006, d=0.017, closed=False, t0=0.16, t1=0.34, off=0.012, n=24))
    elif fam == "aero":
        f = superellipse(0.12, 0.158, 2.2, top_wide=0.1)
        o += racket_common(M, f, -0.158)
        o.append(sweep("Bumper", f, M["Trim"], w=0.006, d=0.017, closed=False, t0=0.18, t1=0.32, off=0.012, n=24))
        for sg in (-1, 1):   # aero bulges at 3 and 9 o'clock
            o.append(ico_s("AeroBulge", 1, (sg * 0.131, 0, RK_Z + 0.01), M["Trim"], 2, scale=(0.012, 0.017, 0.04)))
    elif fam == "blade":
        f = polygon_outline([(0.0, -0.172), (0.128, -0.085), (0.135, 0.09), (0.0, 0.182), (-0.135, 0.09), (-0.128, -0.085)], round_k=0.22)
        o += racket_common(M, f, -0.17)
        for sg in (-1, 1):   # swept fins on the upper shoulders
            fin = feather("Fin", (sg * 0.13, 0.08), math.pi / 2 - sg * 0.55, 0.11, 0.022, M["Accent"]); o.append(fin)
            o.append(feather("FinBack", (sg * 0.13, 0.02), math.pi / 2 - sg * 1.0, 0.08, 0.016, M["Trim"]))
        o.append(feather("Spike", (0.0, 0.19), math.pi / 2, 0.07, 0.016, M["Accent"]))
    elif fam == "storm":
        f = superellipse(0.12, 0.155, 2.3)
        o += racket_common(M, f, -0.155)
        for sg in (-1, 1):   # lightning bolts crackling off the sides
            for k, (z0, ln) in enumerate(((0.05, 0.11), (-0.06, 0.08))):
                x0 = sg * 0.125
                pts = [Vector((x0, 0, RK_Z + z0)), Vector((x0 + sg * ln * 0.35, 0, RK_Z + z0 + 0.03)), Vector((x0 + sg * ln * 0.45, 0, RK_Z + z0 - 0.005)),
                       Vector((x0 + sg * ln, 0, RK_Z + z0 + 0.04))]
                bolt = bpy.data.curves.new("Bolt", "CURVE"); bolt.dimensions = "3D"
                sp = bolt.splines.new("POLY"); sp.points.add(len(pts) - 1)
                for p, q in zip(sp.points, pts): p.co = (*q, 1)
                bolt.bevel_depth = 0.006 - k * 0.0015; bolt.bevel_resolution = 1; bolt.use_fill_caps = True
                ob = _link(bpy.data.objects.new("Bolt", bolt)); bolt.materials.append(M["Accent"]); o.append(ob)
        o.append(star("Spark", Vector((0, 0, 0.19)), 0.032, M["Accent"]))
    elif fam == "seraph":
        f = superellipse(0.125, 0.16, 2.0)
        o += racket_common(M, f, -0.16)
        for sg in (-1, 1):   # layered feather wings sweeping up and out
            for i in range(5):
                ang = math.pi / 2 - sg * (0.35 + i * 0.28)
                o.append(feather("Feather", (sg * (0.11 + i * 0.006), 0.04 - i * 0.03), ang, 0.17 - i * 0.022, 0.03 - i * 0.002, M["Trim"] if i % 2 else M["Frame"]))
                o.append(feather("FeatherGlow", (sg * (0.112 + i * 0.006), 0.04 - i * 0.03), ang, 0.12 - i * 0.02, 0.012, M["Accent"]))
        o.append(sweep("Halo", superellipse(0.2, 0.2, 2.0), M["Accent"], w=0.004, d=0.004, sub=0))
    elif fam == "celestial":
        f = superellipse(0.135, 0.152, 2.0)
        o += racket_common(M, f, -0.152)
        moon = superellipse(0.19, 0.19, 2.0)
        o.append(sweep("Crescent", moon, M["Trim"], w=0.02, d=0.01, closed=False, t0=0.3, t1=0.7, n=40,
                       width=lambda u: math.sin(u * math.pi) + 0.05))
        o.append(sweep("CrescentGlow", moon, M["Accent"], w=0.004, d=0.012, closed=False, t0=0.32, t1=0.68, n=40, off=-0.022,
                       width=lambda u: math.sin(u * math.pi) + 0.05, sub=0))
        for c, r in ((Vector((0, 0, 0.2)), 0.045), (Vector((0.12, 0, 0.14)), 0.026), (Vector((-0.12, 0, 0.14)), 0.026)):
            o.append(star("Star", c, r, M["Accent"]))
        ring = sweep("Orbit", superellipse(0.22, 0.065, 2.0), M["Accent"], w=0.0035, d=0.0035, sub=0)
        for v in ring.data.vertices:   # tilt the orbit ring diagonally across the head (rotate in the string plane, lean out of it)
            p = v.co - Vector((0, 0, RK_Z)); a = 0.45
            v.co = Vector((p.x * math.cos(a) - p.z * math.sin(a), p.y + p.z * 0.6, p.x * math.sin(a) + p.z * math.cos(a))) + Vector((0, 0, RK_Z))
        o.append(ring)
    for x in list(o):
        if x.type == "CURVE": to_mesh([x], x.name)
    finish("racket_" + fam, s)


def build_rackets():
    for fam in RACKET_FAMILIES: build_racket_family(fam)
