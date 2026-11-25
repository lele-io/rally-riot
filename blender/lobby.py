# Rally Riot — title-screen island (v2): a sunny badminton club on a floating island.
# Exec'd by build_models.py after avatar.py (reuses loft_profile / skin_limb / ico_s / stroke / to_mesh from there).
# Layout (Blender coords, camera sits at about (-0.4, -9.4, 2.1) looking +Y):
#   foreground  your character at (1.6, -3.2) on a clay practice court (net across y = 0.1)
#   back        the summon shrine at (0, 7): fluted pillars, ornate portal ring, floating Crystal (names the game uses)
#   around      tiled plaza, shuttlecock lanterns, benches, potted plants, pro-shop kiosk, racket rack, trees, flower beds
# Built big -> small (structures, then props, then Poisson-scattered flowers/grass); static props are joined per material
# so the web build stays at a few dozen draw calls. Flat ground pieces use names the game treats as flat (no outline).
import bpy, bmesh, math, random
from mathutils import Vector

SHRINE_Y = 7.0
COURT_C, COURT_L, COURT_W = Vector((0.6, 0.1, 0)), 6.8, 4.2      # practice court centre / length (along y) / width (ends before the shrine steps)


def lobby_mats():
    M = env_mats()
    M.update(
        stone2=mat("StoneB", (0.83, 0.78, 0.69), rough=0.85), grout=mat("Grout", (0.55, 0.5, 0.46), rough=0.9),
        court=mat("CourtA", (0.86, 0.6, 0.44), rough=0.8), line=mat("Line", (0.99, 0.96, 0.88), emit=0.25), net=mat("Net", (0.97, 0.94, 0.86), rough=0.7),
        pot=mat("Pot", (0.78, 0.45, 0.32), rough=0.8), portal=mat("Portal", (0.55, 0.9, 1.0), emit=4.0), crystal=mat("Crystal", (0.75, 0.95, 1.0), emit=4.0),
        rune=mat("Rune", (1.0, 0.82, 0.45), emit=2.5), white=mat("Cream", (0.97, 0.93, 0.84), rough=0.8),
    )
    return M


def poisson(n, rmin, rmax, min_d, seed, keep=lambda x, y: True, tries=4000):
    """dart-throwing Poisson disk in an annulus: no two points closer than min_d"""
    rnd = random.Random(seed); pts = []
    for _ in range(tries):
        if len(pts) >= n: break
        a = rnd.uniform(0, math.tau); r = math.sqrt(rnd.uniform(rmin ** 2, rmax ** 2))
        x, y = math.cos(a) * r, math.sin(a) * r
        if not keep(x, y) or any((x - px) ** 2 + (y - py) ** 2 < min_d ** 2 for px, py in pts): continue
        pts.append((x, y))
    return pts


def bevel_box(name, size, loc, m, w=0.04, rot=(0, 0, 0)):
    o = box(size, loc, m, name, rot=rot)
    b = o.modifiers.new("bev", "BEVEL"); b.width = w; b.segments = 2; b.limit_method = "ANGLE"
    return o


def blob(name, r, loc, m, seed, sub=2, squash=1.0, amt=0.12):
    """soft canopy/bush clump: subdivided icosphere with a hand-made wobble"""
    o = ico_s(name, r, loc, m, sub, scale=(1, 1, squash))
    rnd = random.Random(seed)
    for v in o.data.vertices: v.co *= 1 + rnd.uniform(-amt, amt)
    s = o.modifiers.new("sub", "SUBSURF"); s.levels = 1
    return o


# ---------------------------------------------------------------- big pieces
def tiled_plaza(M, R=9.6):
    loft_profile("Plaza", [(-0.06, R + 0.15, R + 0.15), (0.0, R + 0.15, R + 0.15)], segs=64, mat=M["grout"], cap_top=True, subsurf=0)
    tiles = []
    r = 0.7
    k = 0
    while r < R:
        n = max(6, int(math.tau * r / 0.95))
        for i in range(n):
            a0, a1 = i / n * math.tau + 0.012 * 3 / r, (i + 1) / n * math.tau - 0.012 * 3 / r
            am = (a0 + a1) / 2
            if math.hypot(math.cos(am) * r - COURT_C.x, math.sin(am) * r - COURT_C.y) < 0 or in_court(math.cos(am) * (r + 0.35), math.sin(am) * (r + 0.35), 0.4): continue
            bm = bmesh.new(); vs = []
            for rr in (r + 0.04, r + 0.66):
                for a in (a0, a1):
                    vs.append(Vector((math.cos(a) * rr, math.sin(a) * rr, 0.0)))
            quad = [vs[0], vs[1], vs[3], vs[2]]
            top = [bm.verts.new(v + Vector((0, 0, 0.05))) for v in quad]
            bot = [bm.verts.new(v) for v in quad]
            bm.faces.new(top)
            for j in range(4): bm.faces.new((bot[j], bot[(j + 1) % 4], top[(j + 1) % 4], top[j]))
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)   # the quad order above winds clockwise: tops would face down
            t = _mesh_obj("tile", bm, M["stone"] if (i + k) % 3 else M["stone2"])
            tiles.append(t)
        r += 0.66; k += 1
    t = join(tiles, "Tiles")
    for p in t.data.polygons: p.use_smooth = False     # flat tops: smooth normals made diagonal toon bands across each tile


def in_court(x, y, pad=0.0):
    return abs(x - COURT_C.x) < COURT_W / 2 + pad and abs(y - COURT_C.y) < COURT_L / 2 + pad


def practice_court(M):
    cx, cy, L, W = COURT_C.x, COURT_C.y, COURT_L, COURT_W
    bevel_box("CourtSurface", (W + 0.4, L + 0.4, 0.06), (cx, cy, 0.035), M["court"], w=0.03)
    lw, z = 0.06, 0.07
    lines = [box((lw, L, 0.01), (cx + sx * W / 2, cy, z)) for sx in (-1, 1)]
    lines += [box((lw, L, 0.01), (cx + sx * W * 0.42, cy, z)) for sx in (-1, 1)]            # singles sidelines
    lines += [box((W, lw, 0.01), (cx, cy + sy * L / 2, z)) for sy in (-1, 1)]
    lines += [box((W, lw, 0.01), (cx, cy + sy * L * 0.15, z)) for sy in (-1, 1)]            # short service lines
    lines += [box((W, lw, 0.01), (cx, cy + sy * L * 0.44, z)) for sy in (-1, 1)]            # long service lines
    lines += [box((lw, L * 0.35, 0.01), (cx, cy + sy * L * 0.325, z)) for sy in (-1, 1)]    # centre lines
    for o in lines: assign(o, M["line"])
    join(lines, "Lines")
    nh = 1.55
    for sx in (-1, 1):   # net posts: lofted, weighted base, gold cap
        x = cx + sx * (W / 2 + 0.25)
        loft_profile("NetPost", [(0.0, 0.16, 0.16, x, cy), (0.06, 0.15, 0.15, x, cy), (0.1, 0.05, 0.05, x, cy), (nh + 0.05, 0.04, 0.04, x, cy)],
                     segs=12, mat=M["wood"], cap_top=True, subsurf=1)
        ico_s("NetCap", 0.075, (x, cy, nh + 0.1), M["gold"], 2)
    strands, top, bot, span = [], nh - 0.03, nh - 0.72, W + 0.5
    for i in range(int(span / 0.12) + 1):
        strands.append(box((0.012, 0.012, top - bot), (cx - span / 2 + i * 0.12, cy, (top + bot) / 2), M["net"], "n"))
    for j in range(7):
        strands.append(box((span, 0.012, 0.012), (cx, cy, bot + j * (top - bot) / 6), M["net"], "n"))
    join(strands, "Net")
    bevel_box("NetTape", (span, 0.05, 0.07), (cx, cy, top + 0.02), M["white"], w=0.015)
    # a few stray shuttles on the court
    for i, (x, y, a) in enumerate(((cx - 1.0, cy - 2.6, 0.4), (cx + 1.3, cy + 2.2, 2.1), (cx - 0.3, cy + 3.1, 4.0))):
        shuttle_prop(M, Vector((x, y, 0.07)), a, lying=True, scale=1.6)


def shuttle_prop(M, at, yaw, lying=False, scale=1.0, glow=False):
    """a shuttlecock: rounded cork + a flared feather skirt with scalloped rim (used for court props and the lanterns)"""
    s = scale * 0.1
    cork = ico_s("ShuttleCork", s * 0.45, Vector((0, 0, 0)), M["lantern"] if glow else M["white"], 2, scale=(1, 1, 0.9))
    skirt = loft_profile("ShuttleSkirt", [(s * 0.3, s * 0.42, s * 0.42), (s * 1.0, s * 0.62, s * 0.62), (s * 1.7, s * 0.95, s * 0.95)], segs=16,
                         mat=M["white"], solidify=s * 0.08, subsurf=1, shape=lambda t, a: (1 + t * 0.06 * math.cos(a * 16), t * t * s * 0.12 * math.cos(a * 16)))
    band = loft_profile("ShuttleBand", [(s * 0.42, s * 0.47, s * 0.47), (s * 0.58, s * 0.5, s * 0.5)], segs=16, mat=M["cloth1"], solidify=s * 0.05, subsurf=1)
    parts = [cork, skirt, band]
    for o in parts:
        apply_mods(o)
        if lying: o.rotation_euler = (math.pi / 2 - 0.25, 0, yaw)
        o.location = at + (Vector((0, 0, s * 0.45)) if lying else Vector((0, 0, 0)))
    return parts


def shrine(M):
    y0 = SHRINE_Y
    for i, (r, z0, z1) in enumerate(((3.4, 0.0, 0.3), (2.8, 0.3, 0.6), (2.2, 0.6, 0.9))):   # round steps with softened edges
        loft_profile("AltarStep", [(z0, r, r, 0, y0), (z1 - 0.05, r, r, 0, y0), (z1, r - 0.05, r - 0.05, 0, y0)], segs=40, mat=M["stone"], cap_top=True, subsurf=1)
        loft_profile("StepTrim", [(z1 - 0.1, r + 0.015, r + 0.015, 0, y0), (z1 - 0.06, r + 0.015, r + 0.015, 0, y0)], segs=40, mat=M["gold"], solidify=0.012, subsurf=0)
    for i in range(8):   # rune tiles inset in the top step
        a = i / 8 * math.tau
        bevel_box("Rune", (0.36, 0.12, 0.03), (math.cos(a) * 1.75, y0 + math.sin(a) * 1.75, 0.905), M["rune"], w=0.01, rot=(0, 0, a))
    for sx in (-1, 1):   # fluted columns with base, capital and a gold spire
        x = sx * 2.75
        loft_profile("PillarBase", [(0.9, 0.6, 0.6, x, y0), (1.0, 0.58, 0.58, x, y0), (1.1, 0.5, 0.5, x, y0), (1.2, 0.44, 0.44, x, y0)], segs=24, mat=M["stone"], subsurf=1)
        loft_profile("Pillar", [(1.15, 0.42, 0.42, x, y0), (3.0, 0.4, 0.4, x, y0), (4.7, 0.37, 0.37, x, y0)], segs=36, mat=M["stone"], subsurf=1,
                     shape=lambda t, a: (1 + 0.06 * abs(math.sin(a * 6)), 0))
        loft_profile("Capital", [(4.65, 0.4, 0.4, x, y0), (4.85, 0.55, 0.55, x, y0), (5.0, 0.6, 0.6, x, y0), (5.15, 0.6, 0.6, x, y0)], segs=24, mat=M["stone"], cap_top=True, subsurf=1)
        loft_profile("CapitalTrim", [(4.96, 0.615, 0.615, x, y0), (5.02, 0.615, 0.615, x, y0)], segs=24, mat=M["gold"], solidify=0.015, subsurf=0)
        loft_profile("Spire", [(5.15, 0.32, 0.32, x, y0), (5.5, 0.22, 0.22, x, y0), (6.1, 0.03, 0.03, x, y0)], segs=8, mat=M["gold"], cap_bottom=True, subsurf=1)
        ico_s("SpireOrb", 0.12, (x, y0, 6.18), M["rune"], 2)
    # portal ring: a flattened, subdivided torus (stone) with gold inner trim, gems and a crest
    bpy.ops.mesh.primitive_torus_add(major_radius=1.78, minor_radius=0.22, major_segments=48, minor_segments=10, location=(0, y0, 3.2), rotation=(math.pi / 2, 0, 0))
    ring = bpy.context.object; ring.name = "PortalRing"; ring.scale = (1, 1, 0.55); assign(ring, M["stone"]); smooth(ring)
    s = ring.modifiers.new("sub", "SUBSURF"); s.levels = 1
    bpy.ops.mesh.primitive_torus_add(major_radius=1.55, minor_radius=0.05, major_segments=64, minor_segments=6, location=(0, y0, 3.2), rotation=(math.pi / 2, 0, 0))
    pg = bpy.context.object; pg.name = "PortalGlow"; assign(pg, M["portal"]); smooth(pg)
    bpy.ops.mesh.primitive_torus_add(major_radius=2.0, minor_radius=0.04, major_segments=64, minor_segments=6, location=(0, y0, 3.2), rotation=(math.pi / 2, 0, 0))
    gt = bpy.context.object; gt.name = "PortalTrim"; assign(gt, M["gold"]); smooth(gt)
    for i in range(8):
        a = i / 8 * math.tau + math.pi / 8
        ico_s("PortalGem", 0.1, (math.cos(a) * 1.78, y0 - 0.12, 3.2 + math.sin(a) * 1.78), M["rune"], 2, scale=(1, 0.6, 1))
    crest = loft_profile("Crest", [(0, 0.3, 0.12), (0.25, 0.22, 0.1), (0.6, 0.02, 0.02)], segs=12, mat=M["gold"], cap_bottom=True, subsurf=1)
    crest.location = (0, y0, 3.2 + 1.92)
    for sx in (-1, 1):   # the ring rests on curved gold brackets from the pillars
        stroke("Bracket", [Vector((sx * 2.4, y0, 4.2)), Vector((sx * 2.2, y0, 3.9)), Vector((sx * 1.95, y0, 3.5))], 0.09, M["gold"], lambda t: 1 - 0.3 * t)
    ico_s("Crystal", 0.45, (0, y0, 3.2), M["crystal"], 0, scale=(1, 1, 1.7))


def tree2(M, x, y, h, kind, seed):
    """skin-modifier trunk with two branches + clustered soft canopy blobs"""
    rnd = random.Random(seed)
    lean = Vector((rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), 0))
    pts = [((0, 0, 0), 0.32), ((lean.x * 0.3, lean.y * 0.3, h * 0.35), 0.22), ((lean.x, lean.y, h * 0.75), 0.17),
           ((lean.x + 0.8, lean.y + 0.2, h * 0.95), 0.1), ((lean.x - 0.7, lean.y - 0.1, h * 0.9), 0.1), ((lean.x * 1.2, lean.y * 1.2, h), 0.12)]
    skin_limb("Trunk", pts, [(0, 1), (1, 2), (2, 3), (2, 4), (2, 5)], M["wood"], loc=(x, y, 0), subsurf=1)
    for i in range(5):
        c = Vector((x + lean.x + rnd.uniform(-0.9, 0.9), y + lean.y + rnd.uniform(-0.9, 0.9), h + 0.3 + rnd.uniform(-0.3, 0.6) + (0.6 if i == 0 else 0)))
        blob("Canopy", rnd.uniform(0.9, 1.35), c, M[kind], seed * 10 + i, squash=0.85)


def lantern(M, x, y):
    loft_profile("LanternPost", [(0.0, 0.14, 0.14, x, y), (0.12, 0.1, 0.1, x, y), (0.18, 0.05, 0.05, x, y), (2.0, 0.045, 0.045, x, y)], segs=10, mat=M["wood"], subsurf=1)
    stroke("LanternArm", [Vector((x, y, 1.95)), Vector((x, y, 2.12)), Vector((x + 0.12, y, 2.2))], 0.03, M["gold"])
    for o in shuttle_prop(M, Vector((x + 0.18, y, 1.95)), 0, scale=3.2, glow=True):
        o.rotation_euler = (math.pi, 0, 0); o.location = Vector((x + 0.2, y, 2.32))


def bench(M, x, y, yaw):
    rot = (0, 0, yaw); c, s_ = math.cos(yaw), math.sin(yaw)
    off = lambda dx, dy: (x + dx * c - dy * s_, y + dx * s_ + dy * c)
    for i in range(3):
        px, py = off(0, -0.15 + i * 0.15)
        bevel_box("BenchSlat", (1.8, 0.12, 0.06), (px, py, 0.48), M["wood"], w=0.02, rot=rot)
    for dx in (-0.75, 0.75):
        px, py = off(dx, 0)
        bevel_box("BenchLeg", (0.08, 0.45, 0.46), (px, py, 0.23), M["rockdark"], w=0.02, rot=rot)
    px, py = off(0, 0.25)
    bevel_box("BenchBack", (1.8, 0.06, 0.32), (px, py, 0.78), M["wood"], w=0.02, rot=(0.15, 0, yaw))


def potted_plant(M, x, y, seed, kind="leaf"):
    loft_profile("Pot", [(0.0, 0.22, 0.22, x, y), (0.42, 0.3, 0.3, x, y), (0.47, 0.33, 0.33, x, y), (0.52, 0.31, 0.31, x, y)], segs=20, mat=M["pot"], cap_bottom=True, subsurf=1)
    rnd = random.Random(seed)
    for i in range(3):
        blob("Bush", rnd.uniform(0.25, 0.34), (x + rnd.uniform(-0.12, 0.12), y + rnd.uniform(-0.12, 0.12), 0.62 + i * 0.12), M[kind], seed + i, squash=0.9)


def kiosk(M, x, y):
    """pro shop: counter, posts, scalloped striped awning, a giant shuttle sign"""
    bevel_box("Counter", (2.8, 1.2, 1.0), (x, y, 0.5), M["wood"], w=0.05)
    bevel_box("CounterTop", (3.0, 1.4, 0.1), (x, y, 1.05), M["white"], w=0.03)
    for sx in (-1, 1):
        for sy in (-1, 1):
            loft_profile("StallPost", [(0, 0.07, 0.07, x + sx * 1.35, y + sy * 0.6), (2.6, 0.06, 0.06, x + sx * 1.35, y + sy * 0.6)], segs=8, mat=M["wood"], subsurf=0)
    for i in range(6):   # striped awning panels, curved, with a scalloped front edge
        x0 = x - 1.6 + i * 3.2 / 6
        bm = bmesh.new(); grid = []
        for u in range(5):
            row = []
            for v in range(4):
                xx = x0 + u / 4 * 3.2 / 6; yy = y - 1.0 + v / 3 * 2.0
                zz = 2.85 - 0.25 * (1 - v / 3) - 0.06 * math.sin(v / 3 * math.pi) - (0.08 * math.sin(u / 4 * math.pi) if v == 0 else 0)
                row.append(bm.verts.new((xx, yy, zz)))
            grid.append(row)
        for u in range(4):
            for v in range(3): bm.faces.new((grid[u][v], grid[u + 1][v], grid[u + 1][v + 1], grid[u][v + 1]))
        a = _mesh_obj("Awning", bm, M["cloth1"] if i % 2 == 0 else M["white"])
        m = a.modifiers.new("t", "SOLIDIFY"); m.thickness = 0.04
    for o in shuttle_prop(M, Vector((x, y + 0.2, 3.0)), 0, scale=5.0):
        pass
    for i, c in enumerate((M["cloth2"], M["gold"], M["cloth1"])):   # goods: shuttle tubes on the counter
        loft_profile("Tube", [(1.1, 0.09, 0.09, x - 0.8 + i * 0.8, y - 0.2), (1.6, 0.09, 0.09, x - 0.8 + i * 0.8, y - 0.2)], segs=12, mat=c, cap_top=True, subsurf=1)


def racket_rack(M, x, y):
    for sy in (-1, 1):
        loft_profile("RackPost", [(0, 0.12, 0.12, x, y + sy * 1.4), (0.1, 0.09, 0.09, x, y + sy * 1.4), (2.6, 0.08, 0.08, x, y + sy * 1.4)], segs=8, mat=M["wood"], subsurf=1)
        ico_s("RackCap", 0.12, (x, y + sy * 1.4, 2.66), M["gold"], 2)
    bevel_box("RackBar", (0.14, 3.0, 0.12), (x, y, 2.45), M["wood"], w=0.03)
    bevel_box("RackBar", (0.14, 3.0, 0.12), (x, y, 1.2), M["wood"], w=0.03)
    for i in range(4):   # hanging rackets: oval frame + strings + handle
        yy = y - 1.05 + i * 0.7
        bpy.ops.mesh.primitive_torus_add(major_radius=0.22, minor_radius=0.028, major_segments=24, minor_segments=6, location=(x + 0.12, yy, 1.95), rotation=(0, math.pi / 2, 0))
        o = bpy.context.object; o.name = "RackRacket"; o.scale = (1, 1, 1.3); assign(o, [M["cloth1"], M["gold"], M["cloth2"], M["white"]][i]); smooth(o)
        loft_profile("RackHandle", [(1.2, 0.03, 0.03, x + 0.12, yy), (1.65, 0.022, 0.022, x + 0.12, yy)], segs=8, mat=M["wood"], cap_bottom=True, subsurf=0)


def banner(M, x, y, cloth, h=5.2):
    loft_profile("FlagPole", [(0, 0.1, 0.1, x, y), (h, 0.06, 0.06, x, y)], segs=8, mat=M["wood"], subsurf=0)
    ico_s("Finial", 0.14, (x, y, h + 0.1), M["gold"], 2)
    bm = bmesh.new(); grid = []
    for u in range(7):
        row = []
        for v in range(4):
            yy = u / 6 * 1.2; zz = h - 0.2 - v / 3 * 2.0
            row.append(bm.verts.new((x + 0.1 * math.sin(yy * 3 + v * 0.4), y + yy + 0.05, zz - (0.25 * math.sin(u / 6 * math.pi) if v == 3 else 0))))
        grid.append(row)
    for u in range(6):
        for v in range(3): bm.faces.new((grid[u][v], grid[u + 1][v], grid[u + 1][v + 1], grid[u][v + 1]))
    b = _mesh_obj("Banner", bm, cloth); m = b.modifiers.new("t", "SOLIDIFY"); m.thickness = 0.03
    # emblem: crossed rackets in gold
    for sgn in (-1, 1):
        stroke("Emblem", [Vector((x + 0.08, y + 0.6 - sgn * 0.3, h - 1.7)), Vector((x + 0.08, y + 0.6 + sgn * 0.3, h - 0.9))], 0.03, M["gold"])


def flowers(M, pts, seed):
    rnd = random.Random(seed); out = []
    for i, (x, y) in enumerate(pts):
        col = [M["blossom"], M["autumn"], M["white"], M["cloth1"]][i % 4]
        for k in range(rnd.randint(3, 5)):
            px, py = x + rnd.uniform(-0.25, 0.25), y + rnd.uniform(-0.25, 0.25)
            out.append(ico_s("flower", rnd.uniform(0.06, 0.09), (px, py, 0.32 + rnd.uniform(0, 0.12)), col, 1, scale=(1, 1, 0.6)))
            out.append(ico_s("flowerstem", 0.05, (px, py, 0.15), M["grass2"], 1, scale=(0.4, 0.4, 3)))
    return out


def join_by_material(keep_names=("Crystal", "PortalGlow", "Tiles", "Lines", "Net", "Plaza", "IslandTop", "IslandRim", "Underside", "Tufts", "CourtSurface")):
    """merge static props per material (fewer draw calls + outline hulls). Keeps the objects the game looks up by name."""
    by = {}
    for o in list(bpy.context.scene.objects):
        if o.type == "CURVE":
            o = to_mesh([o], o.name)
        if o.type != "MESH" or any(o.name.startswith(k) for k in keep_names): continue
        if o.modifiers: apply_mods(o)
        key = o.data.materials[0].name if o.data.materials else "none"
        by.setdefault(key, []).append(o)
    for key, objs in by.items():
        if len(objs) > 1: join(objs, "Props_" + key)
        else: objs[0].name = "Props_" + key


def build_lobby():
    s = new_scene("lobby"); M = lobby_mats()
    island(M, 16, 16, depth=12, seed=9)
    tiled_plaza(M)
    loft_profile("PlazaRim", [(0.0, 9.85, 9.85), (0.1, 9.85, 9.85), (0.14, 9.75, 9.75)], segs=72, mat=M["gold"], subsurf=0)
    practice_court(M)
    shrine(M)
    kiosk(M, 7.4, -1.5)
    racket_rack(M, -7.6, -1.5)
    bench(M, -4.8, 3.6, 0.35); bench(M, 4.6, 4.2, -0.4)
    for i, (x, y) in enumerate(((-3.6, 5.4), (3.6, 5.4), (-6.2, 1.6), (6.0, 2.4), (-5.4, -4.8), (5.2, -5.2))):
        potted_plant(M, x, y, 40 + i, ["leaf", "blossom", "autumn"][i % 3])
    for a in range(10):
        ang = a / 10 * math.tau + math.pi / 10
        lantern(M, math.cos(ang) * 9.3, math.sin(ang) * 9.3)
    for i, (x, y, k) in enumerate(((-11, 6, "blossom"), (11, 6, "autumn"), (-12.5, -5, "leaf"), (12.5, -5, "blossom"), (-6.5, 12, "leaf"), (6.5, 12, "autumn"), (0, 13.5, "blossom"))):
        tree2(M, x, y, 3.8 + (i % 2) * 0.9, k, i + 20)
    banner(M, -4.6, 10.2, M["cloth2"]); banner(M, 4.6, 10.2, M["cloth1"])
    fl = flowers(M, poisson(40, 10.4, 14.8, 1.1, 5), 6)
    join(fl, "Flowers")
    grass_tufts(M, 200, 15, 15, lambda x, y: math.hypot(x, y) < 10.2, seed=3)
    join_by_material()
    finish("lobby", s)
