# Rally Riot — designer-toy characters (v5). Exec'd by build_models.py after avatar_rig.py and overrides its proportions:
# a collectible vinyl-figure look — big round head (~2.5 heads tall, 1.62 m), smooth chunky body, glossy painted features,
# sculpted "chunk" hair, rounded clothes. Same skeleton/bone names, same slots and option ids as before, so the game's
# animation (anim.js), racket mount and customizer keep working. build_avatar_rig() / preview_rig() now build this style.
import bpy, bmesh, math, random
from mathutils import Vector

TOY_K = 1.25                                   # sample was built 1.3 m tall; game scale is ~1.62 m
RIG_H = 1.28                                   # head centre
HEAD_F, HEAD_XY = 1.26, (1.0, 1.0)             # v3 head (r 0.27 @ z 1.38) -> toy head (r 0.34 @ z 1.28), round, not narrowed
ZMAP = [(-1.0, -1.0), (0.0, 0.0), (0.13, 0.1), (0.29, 0.25), (0.5, 0.44), (0.62, 0.6), (0.84, 0.78), (0.99, 0.93), (1.075, 1.0), (1.25, 1.12)]
SX_TORSO, SX_LEGS = 0.9, 0.92
HIP_X = 0.096
WRIST_BAND = (0.615, 0.24, 0.058)


def _body_points():
    P = {"pelvis": ((0, 0, 0.47), (0.17, 0.13)), "belly": ((0, -0.004, 0.62), (0.19, 0.15)), "chest": ((0, 0, 0.79), (0.19, 0.145)),
         "shtop": ((0, 0.004, 0.92), (0.15, 0.115)), "neck0": ((0, 0.006, 0.98), (0.075, 0.07)), "neck1": ((0, 0.008, 1.04), (0.07, 0.066))}
    for s, n in ((1, "L"), (-1, "R")):
        P.update({
            "sh" + n: ((s * 0.19, 0.004, 0.91), (0.072, 0.072)), "elb" + n: ((s * 0.215, 0.006, 0.76), (0.06, 0.06)),
            "wri" + n: ((s * 0.24, 0.0, 0.61), (0.052, 0.052)), "palm" + n: ((s * 0.248, -0.006, 0.55), (0.058, 0.066)),
            "fing" + n: ((s * 0.25, -0.012, 0.49), (0.052, 0.058)), "thb" + n: ((s * 0.225, -0.05, 0.575), (0.026, 0.026)),
            "tht" + n: ((s * 0.215, -0.07, 0.55), (0.022, 0.022)),
            "hip" + n: ((s * HIP_X, 0.0, 0.43), (0.085, 0.085)), "knee" + n: ((s * HIP_X, -0.008, 0.26), (0.072, 0.072)),
            "ank" + n: ((s * HIP_X, 0.0, 0.11), (0.064, 0.064)),
        })
    E = [("pelvis", "belly"), ("belly", "chest"), ("chest", "shtop"), ("shtop", "neck0"), ("neck0", "neck1")]
    for n in "LR":
        E += [("shtop", "sh" + n), ("sh" + n, "elb" + n), ("elb" + n, "wri" + n), ("wri" + n, "palm" + n), ("palm" + n, "fing" + n),
              ("palm" + n, "thb" + n), ("thb" + n, "tht" + n), ("pelvis", "hip" + n), ("hip" + n, "knee" + n), ("knee" + n, "ank" + n)]
    return P, E


def _bones():
    B = {"Hips": ((0, 0, 0.42), (0, 0, 0.6), None), "Spine": ((0, 0, 0.6), (0, 0, 0.78), "Hips"), "Chest": ((0, 0, 0.78), (0, 0, 0.95), "Spine"),
         "Neck": ((0, 0.006, 0.96), (0, 0.008, 1.04), "Chest"), "Head": ((0, 0.008, 1.04), (0, 0.008, 1.5), "Neck")}
    for s, n in ((1, "L"), (-1, "R")):
        B["Arm" + n] = ((s * 0.19, 0.004, 0.91), (s * 0.215, 0.006, 0.76), "Chest")
        B["Forearm" + n] = ((s * 0.215, 0.006, 0.76), (s * 0.24, 0.0, 0.61), "Arm" + n)
        B["Hand" + n] = ((s * 0.24, 0.0, 0.61), (s * 0.25, -0.012, 0.47), "Forearm" + n)
        B["Leg" + n] = ((s * HIP_X, 0.0, 0.43), (s * HIP_X, -0.008, 0.26), "Hips")
        B["Shin" + n] = ((s * HIP_X, -0.008, 0.26), (s * HIP_X, 0.0, 0.11), "Leg" + n)
        B["Foot" + n] = ((s * HIP_X, 0.0, 0.11), (s * HIP_X, -0.15, 0.03), "Shin" + n)
    return B


def make_body(M):
    P, E = _body_points()
    names = list(P.keys()); idx = {n: i for i, n in enumerate(names)}
    me = bpy.data.meshes.new("Body"); me.from_pydata([P[n][0] for n in names], [(idx[a], idx[b]) for a, b in E], [])
    ob = _link(bpy.data.objects.new("Body", me))
    sk = ob.modifiers.new("skin", "SKIN"); sk.use_smooth_shade = True; sk.branch_smoothing = 1.0
    for n, i in idx.items(): me.skin_vertices[0].data[i].radius = P[n][1]
    me.skin_vertices[0].data[idx["pelvis"]].use_root = True
    s = ob.modifiers.new("sub", "SUBSURF"); s.levels = 2
    apply_mods(ob); smooth(ob)
    under = mat("Undershirt", (0.94, 0.9, 0.8), rough=0.8)
    for m in (M["skin"], M["sleeve"], M["sleeve2"], M["legs"], M["legs2"], under): ob.data.materials.append(m)
    for p in ob.data.polygons:
        c = p.center
        if abs(c.x) > 0.17 and 0.5 < c.z < 0.95: p.material_index = 1 if c.z > 0.77 else (2 if c.z > 0.63 else 0)     # upper arm / forearm / hand
        elif c.z < 0.45 and abs(c.x) < 0.2: p.material_index = 3 if c.z > 0.27 else (4 if c.z > 0.15 else 0)         # thigh / shin / ankle
        elif 0.5 < c.z < 0.96: p.material_index = 5
    return ob


def make_head_kit(M):
    """v3 head (round, cheeks), ears, nose -> scaled onto the big toy head"""
    objs = _gather(lambda: (lambda h: make_face(M, h))(make_head(M)))
    return [warp(o, "head") for o in objs]


def make_shoes(M, rig):
    """chunky rounded toy sneakers with a thick sole, socks, sleeve cuffs"""
    out = []
    for s, n in ((1, "L"), (-1, "R")):
        x = s * HIP_X
        parts = [loft_profile("Sole", [(-0.004, 0.084, 0.148, x, -0.04), (0.035, 0.088, 0.152, x, -0.041)], segs=22, mat=M["sole"], cap_top=True, cap_bottom=True, subsurf=1),
                 loft_profile("Shoe", [(0.03, 0.084, 0.144, x, -0.04), (0.08, 0.088, 0.146, x, -0.042), (0.13, 0.076, 0.11, x, -0.022),
                                       (0.16, 0.066, 0.075, x, -0.004)], segs=20, mat=M["boot"], cap_top=True, subsurf=2,
                              shape=lambda t, a: (1.0 + 0.05 * (1 - t) * max(0, math.cos(a)), 0.0)),
                 loft_profile("ShoeTongue", [(0.1, 0.03, 0.03, x, -0.1), (0.15, 0.028, 0.026, x, -0.07)], segs=10, mat=M["sole"], cap_top=True, subsurf=1)]
        laces = to_mesh([stroke("Lace", [Vector((x - 0.035, -0.13 + i * 0.026, 0.115 + i * 0.012)), Vector((x, -0.14 + i * 0.026, 0.122 + i * 0.012)),
                                          Vector((x + 0.035, -0.13 + i * 0.026, 0.115 + i * 0.012))], 0.007, M["sole"]) for i in range(2)], "Laces")
        parts.append(laces)
        for p in parts:
            apply_mods(p); p.name = f"base__{p.name.split('.')[0]}{n}"
            out.append(rig_bind(p, rig, group="Foot" + n))
        sock = loft_profile("Sock", [(0.15, 0.067, 0.067, x, 0.0), (0.21, 0.068, 0.068, x, 0.0)], segs=16, mat=M["sock"], solidify=0.008, subsurf=1)
        apply_mods(sock); sock.name = "base__Sock" + n; out.append(rig_bind(sock, rig, group="Shin" + n))
        for nm, z0, r, bone, xx in (("CuffShort", 0.8, 0.074, "Arm", s * 0.207), ("Cuff", 0.645, 0.058, "Forearm", s * 0.236)):
            c = loft_profile(nm, [(z0, r, r, xx, 0.004), (z0 - 0.03, r * 1.03, r * 1.03, xx, 0.004)], segs=18, mat=M["cuff"], solidify=0.01, subsurf=1)
            apply_mods(c); c.name = f"base__{nm}{n}"; out.append(rig_bind(c, rig, group=bone + n))
    return out


# ---------------------------------------------------------------- sculpted toy hair (built around the v3 head, then head-warped)
def chunk(pts, r=0.07, mat=None, width=2.2, flat=0.75, tip=0.55, center=None):
    """one fat sculpted hair chunk with a rounded end (toy style), smoothed"""
    ob = make_hair_lock("Chunk", pts, r, mat, res=5, profile=lambda t: (0.8 + t * 1.2 if t < 0.17 else 1.0) * (1 - tip * t ** 2.2), width=width, flat=flat,
                        curl=0.25, center=center, segs=10)
    s = ob.modifiers.new("sub", "SUBSURF"); s.levels = 1
    return ob


def toy_cap(M, front=60, side=100, back=140):
    cap = hair_cap(M, front=front, side=side, back=back)
    for v in cap.data.vertices:   # a fuller, rounder helmet of hair; the lower back flares out so the skull never pokes through
        d = v.co - HC; low = max(0.0, -d.z / HR)
        v.co = HC + d * (1.05 + 0.09 * low) + Vector((0, 0.03 * low, 0))
    return cap


def build_hair_toy(M, style):
    random.seed(7)
    H_ = M["hair"]; parts = []
    front = {"crew": 52, "bob": 58, "long": 60, "middle": 58}.get(style, 60)
    back = {"crew": 128, "bob": 150, "long": 150}.get(style, 140)
    parts.append(toy_cap(M, front=front, back=back))
    fr, locks, tufts = [], [], []
    swoop = lambda ph, ln, sweep=0.0, r=0.075: chunk([sph(22, ph * 0.5, 0.1), sph(48, ph, 0.14), sph(68, ph + sweep, 0.09), sph(68 + ln * 60, ph + sweep * 1.5, 0.02)], r, H_)
    if style == "spiky":
        fr = [swoop(ph, 0.2, sw) for ph, sw in ((-34, -10), (-8, 6), (20, 14))]
        for th, ph, ln in ((20, 175, 0.1), (26, -145, 0.09), (30, 140, 0.09), (12, 30, 0.08), (16, -50, 0.08), (36, 100, 0.07), (36, -100, 0.07)):
            a, b = sph(max(4, th - 14), ph * 0.6, 0.05), sph(th, ph, 0.11)
            n = (b - HC).normalized(); d = (n * 0.6 + Vector((0, 1.0, 0.25))).normalized()     # short, swept back, hugging the head
            tufts.append(chunk([a, b, b + d * ln * 0.6, b + d * ln + Vector((0, 0.02, -0.01))], 0.07, H_, tip=0.75))
    elif style == "messy":
        fr = [swoop(ph, 0.22, sw) for ph, sw in ((-40, -16), (-16, 10), (10, -8), (34, 18))]
        rnd = random.Random(5)
        for i in range(6):
            th, ph = rnd.uniform(20, 70), rnd.uniform(-170, 170)
            if abs(ph) < 50 and th > 40: continue
            b = sph(th, ph, 0.14); n = (b - HC).normalized()
            tufts.append(chunk([sph(max(4, th - 14), ph, 0.06), b, b + n * 0.08 + Vector((rnd.uniform(-0.05, 0.05), 0.03, 0.04))], 0.07, H_, tip=0.6))
    elif style == "middle":
        for sg in (-1, 1):
            fr.append(chunk([sph(8, sg * 4, 0.1), sph(30, sg * 22, 0.15), sph(56, sg * 44, 0.13), sph(80, sg * 60, 0.06), sph(96, sg * 62, 0.0)], 0.085, H_))
            fr.append(chunk([sph(20, sg * 40, 0.1), sph(50, sg * 70, 0.12), sph(85, sg * 80, 0.05)], 0.07, H_))
    elif style == "crew":
        for ph in (-24, 0, 24):
            fr.append(chunk([sph(34, ph, 0.05), sph(46, ph, 0.08), sph(46, ph + 4, 0.14)], 0.055, H_, tip=0.6))
    elif style == "long":
        fr = [swoop(ph, 0.2, sw) for ph, sw in ((-30, -12), (-6, -6), (18, -16))]
        for i in range(7):
            ph = 95 + i * 170 / 6; ph = ph if ph <= 180 else ph - 360
            d = side_dir(ph)
            p0 = sph(60, ph, 0.14); p1 = sph(110, ph, 0.12)
            locks.append(chunk([sph(25, ph * 0.5, 0.08), p0, p1, p1 + Vector((d.x * 0.03, d.y * 0.03 + 0.02, -0.22)), p1 + Vector((d.x * 0.02, d.y * 0.02 + 0.02, -0.42))], 0.08, H_, tip=0.45))
    elif style == "bob":
        # a sculpted bowl bob: one smooth shell that curls in at the jaw, plus a heavy blunt fringe
        shell = loft_profile("BobShell", [(-0.2, 0.3, 0.29, 0, 0.03), (-0.1, 0.31, 0.31, 0, 0.02), (0.05, 0.305, 0.31, 0, 0.012), (0.17, 0.27, 0.28, 0, 0.01),
                                          (0.26, 0.17, 0.18, 0, 0.01), (0.3, 0.05, 0.06, 0, 0.01)], segs=32, mat=H_, cap_top=True, gap=0.95, gap_rows={0, 1, 2}, solidify=0.03, subsurf=2,
                             shape=lambda t, a: (1 - (0.1 if t < 0.1 else 0.0), 0.0))
        shell.location = (0, 0, H + 0.03); parts.append(shell)
        fr = [chunk([sph(20, ph * 0.5, 0.1), sph(50, ph, 0.14), sph(70, ph, 0.08)], 0.085, H_, tip=0.3) for ph in (-36, -12, 12, 36)]
    elif style == "ponytail":
        fr = [swoop(ph, 0.18, sw) for ph, sw in ((-26, -8), (8, 10))]
        tie = HC + Vector((0, HR * 1.02, 0.04))
        bpy.ops.mesh.primitive_torus_add(major_radius=0.05, minor_radius=0.024, major_segments=20, minor_segments=10, location=tie + Vector((0, 0.03, 0)), rotation=(math.pi / 2 - 0.3, 0, 0))
        t = bpy.context.object; t.name = "Tie"; assign(t, M["hatb"]); smooth(t); parts.append(t)
        p0 = tie + Vector((0, 0.06, 0))
        locks.append(chunk([p0, p0 + Vector((0, 0.12, -0.04)), p0 + Vector((0, 0.13, -0.25)), p0 + Vector((0.02, 0.07, -0.45)), p0 + Vector((0.04, 0.02, -0.55))],
                           0.1, H_, width=1.4, flat=0.9, tip=0.75, center=p0 + Vector((0, -0.1, -0.2))))
    elif style == "buns":
        fr = [swoop(ph, 0.17, 0) for ph in (-24, 0, 24)]
        for sx in (-1, 1):
            c = HC + Vector((sx * 0.19, 0.04, 0.21))
            tufts.append(ico_s("Tuft", 1, c, H_, 3, scale=(0.105, 0.105, 0.095)))
            pts = [c + Vector((math.cos(a) * 0.1, math.sin(a) * 0.1, -0.01 + k * 0.012)) for k, a in enumerate([i / 10 * math.tau * 1.1 for i in range(11)])]
            tufts.append(chunk(pts, 0.03, H_, width=1.2, flat=0.9, tip=0.3, center=c))
    if fr: parts.append(to_mesh(fr, "Fringe"))
    if locks: parts.append(to_mesh(locks, "Locks"))
    if tufts: parts.append(to_mesh(tufts, "Tuft"))
    return parts


build_hair = build_hair_toy


# ---------------------------------------------------------------- garments: fit to the toy body profile (radially, per height)
def _prof(pts, z):
    """(rx, ry) at height z from [(z, rx, ry)] (clamped)"""
    if z <= pts[0][0]: return pts[0][1:]
    for (z0, a0, b0), (z1, a1, b1) in zip(pts, pts[1:]):
        if z <= z1:
            t = (z - z0) / (z1 - z0); return a0 + (a1 - a0) * t, b0 + (b1 - b0) * t
    return pts[-1][1:]


V3_TORSO = [(z, rx, ry) for z, rx, ry in TORSO]
TOY_TORSO = [(0.44, 0.165, 0.128), (0.47, 0.17, 0.13), (0.62, 0.19, 0.15), (0.79, 0.19, 0.145), (0.92, 0.15, 0.115), (0.98, 0.075, 0.07), (1.04, 0.07, 0.066)]


def warp(ob, kind):
    if ob.type == "CURVE": ob = to_mesh([ob], ob.name)
    if ob.type != "MESH": return ob
    bpy.context.view_layer.update()
    apply_mods(ob)
    me = ob.data; me.transform(ob.matrix_world); ob.matrix_world = ob.matrix_world.__class__.Identity(4)
    if ob.parent: ob.parent = None
    for v in me.vertices:
        p = v.co
        if kind == "head":
            d = (p - OLD_HEAD) * HEAD_F
            v.co = Vector((d.x * HEAD_XY[0], d.y * HEAD_XY[1], d.z)) + Vector((0, 0, RIG_H))
            continue
        z2 = _zmap(p.z)
        t = max(0.0, min(1.0, (p.z - 0.42) / 0.12))           # 0 = legs, 1 = torso
        a3, b3 = _prof(V3_TORSO, p.z); at, bt = _prof(TOY_TORSO, z2)
        kx, ky = at / a3 * 1.04, bt / b3 * 1.04               # +4% so cloth sits just outside the body
        sx = SX_LEGS + (kx - SX_LEGS) * t; sy = SX_LEGS + (ky - SX_LEGS) * t
        v.co = Vector((p.x * sx, p.y * sy, z2))
    me.update()
    return ob     # avatar_rig's builder table picks this up at call time
