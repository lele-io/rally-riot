# Rally Riot — character builder (v3). Exec'd by build_models.py; can also be run on its own in Blender:
#   exec(open(r"C:/games/racket-game/blender/build_models.py").read()); build_avatar(); build_avatar_parts()
#   preview_avatar("gown", "long", "none", "blush")   # assembles one look in a scene called "avatar_preview" (not exported)
#
# Techniques (no raw primitives for anything visible):
#   skin_limb     vertex chain + Skin modifier (per-vertex radii) + Subdivision: arms with elbows and mitten hands, legs with knees
#   loft_profile  rings of a profile (z, rx, ry, cx, cy) lofted into a surface + optional hem waves / gaps / Solidify / Subsurf
#   make_hair_lock  tapered Bezier lock (bevel + fill caps, radius 0.8 -> 1 -> 0 along the lock), rooted on the scalp
#   face strokes  short beveled curves projected onto the head and snapped with Shrinkwrap
# Cel shading + ink outlines are applied by the game at load time (assets.js), so materials here are plain colors
# whose *names* the game recolors: Skin Hair Eye Outfit1 Outfit2 HatMain HatBand Legs Sleeve Cuff Team.
# Object names the game animates: ArmL/ArmR (pivot = shoulder), HandL/HandR (empties, racket mount), LegL/LegR (pivot = hip).
# Blender: Z up, the character faces -Y.
import bpy, bmesh, math, random
from mathutils import Vector

# ---------------------------------------------------------------- tweakables
H = 1.38                          # head centre height
HEAD_R, HEAD_SCALE = 0.27, (1.0, 0.95, 0.92)
SHOULDER = (0.215, 0.0, 1.0)      # arm pivot (x mirrored)
HIP = (0.1, 0.0, 0.5)             # leg pivot (x mirrored)
HAND_Z = -0.44                    # HandR empty below the shoulder (racket grip)
HC, HR = Vector((0, 0.012, H + 0.03)), 0.288   # hair shell: centre / radius (sits just off the scalp)
LIMB_SUB, CLOTH_SUB = 2, 1        # subdivision levels
HAIR_RES, HAIR_BEV = 4, 3         # lock smoothness: samples per control-point span / (unused) bevel steps
TORSO = [  # (z, rx, ry) chibi torso: hips, waist, chest, shoulders, neck
    (0.44, 0.165, 0.125), (0.52, 0.172, 0.13), (0.62, 0.148, 0.112), (0.72, 0.15, 0.114),
    (0.84, 0.168, 0.122), (0.93, 0.182, 0.124), (0.99, 0.17, 0.114), (1.035, 0.125, 0.092), (1.075, 0.072, 0.068)]


# ---------------------------------------------------------------- helpers
def _link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def _mesh_obj(name, bm, mat=None):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = _link(bpy.data.objects.new(name, me))
    if mat: me.materials.append(mat)
    for p in me.polygons: p.use_smooth = True
    return ob


def apply_mods(ob):
    bpy.context.view_layer.objects.active = ob
    for md in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=md.name)
    return ob


def smooth(ob):
    for p in ob.data.polygons: p.use_smooth = True
    return ob


def parent_keep(child, parent):
    bpy.context.view_layer.update()
    mw = child.matrix_world.copy()
    child.parent = parent; child.matrix_parent_inverse = parent.matrix_world.inverted()
    child.matrix_world = mw


def loft_profile(name, rings, segs=24, mat=None, cap_top=False, cap_bottom=False, shape=None, gap=0.0, gap_rows=None,
                 solidify=0.0, sol_offset=-1.0, subsurf=CLOTH_SUB, displace=0.0, seed=0):
    """rings: [(z, rx, ry[, cx, cy])]. shape(t, a) -> (radius factor, dz) with t = 0..1 along the rings, a = angle (0 = front).
    gap: half-angle (rad) of an opening at the front, on rows in gap_rows (default all). Returns the object (modifiers live)."""
    bm = bmesh.new(); grid = []
    n = len(rings)
    for i, r in enumerate(rings):
        z, rx, ry = r[:3]; cx = r[3] if len(r) > 3 else 0.0; cy = r[4] if len(r) > 4 else 0.0
        row = []
        for j in range(segs):
            a = j / segs * math.tau
            k, dz = shape(i / max(1, n - 1), a) if shape else (1.0, 0.0)
            row.append(bm.verts.new((cx + rx * k * math.sin(a), cy - ry * k * math.cos(a), z + dz)))
        grid.append(row)
    for i in range(n - 1):
        for j in range(segs):
            a = (j + 0.5) / segs * math.tau
            if gap and (gap_rows is None or i in gap_rows) and (a < gap or a > math.tau - gap): continue
            bm.faces.new((grid[i][j], grid[i][(j + 1) % segs], grid[i + 1][(j + 1) % segs], grid[i + 1][j]))
    for flag, i in ((cap_bottom, 0), (cap_top, n - 1)):
        if not flag: continue
        r = rings[i]; c = bm.verts.new((r[3] if len(r) > 3 else 0, r[4] if len(r) > 4 else 0, sum(v.co.z for v in grid[i]) / segs))
        for j in range(segs): bm.faces.new((grid[i][j], grid[i][(j + 1) % segs], c))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _mesh_obj(name, bm, mat)
    if displace:
        tex = bpy.data.textures.new(name + "_folds", "CLOUDS"); tex.noise_scale = 0.12; tex.noise_depth = 1
        d = ob.modifiers.new("folds", "DISPLACE"); d.texture = tex; d.strength = displace; d.mid_level = 0.5
        d.texture_coords = "GLOBAL"
        if seed: tex.noise_basis = "ORIGINAL_PERLIN"
    if solidify:
        s = ob.modifiers.new("thick", "SOLIDIFY"); s.thickness = solidify; s.offset = sol_offset; s.use_even_offset = True
    if subsurf:
        s = ob.modifiers.new("sub", "SUBSURF"); s.levels = s.render_levels = subsurf
    return ob


def skin_limb(name, pts, edges, mat, loc=(0, 0, 0), subsurf=LIMB_SUB):
    """pts: [((x, y, z) local, r or (rx, ry))]; vertex 0 is the skin root. Origin = loc (the joint the game rotates)."""
    me = bpy.data.meshes.new(name); me.from_pydata([p[0] for p in pts], edges, [])
    ob = _link(bpy.data.objects.new(name, me)); ob.location = loc
    sk = ob.modifiers.new("skin", "SKIN"); sk.use_smooth_shade = True; sk.branch_smoothing = 0.6
    for i, (_, r) in enumerate(pts):
        me.skin_vertices[0].data[i].radius = r if isinstance(r, tuple) else (r, r)
    me.skin_vertices[0].data[0].use_root = True
    s = ob.modifiers.new("sub", "SUBSURF"); s.levels = s.render_levels = subsurf
    if mat: me.materials.append(mat)
    return ob


def lock_profile(t):
    # clump thickness along a lock: a bit thinner at the root, fullest a quarter of the way, sharp tip
    return 0.75 + t * 1.6 if t < 0.16 else max(0.0, 1.0 - ((t - 0.16) / 0.84) ** 1.35)


def make_hair_lock(name, pts, r=0.045, mat=None, res=HAIR_RES, profile=lock_profile, width=1.9, flat=0.5, curl=0.35, center=None, segs=8):
    """one hair clump: a smooth spline through `pts` (Catmull-Rom, same curve a Bezier with auto handles gives), swept with a
    flat crescent cross-section that lies along the skull (wide sideways, thin outward, edges curling in) and tapers to a point.
    A plain bevel can't do this: its round section has no notion of 'which side faces the head'."""
    P = [Vector(p) for p in pts]
    ext = [P[0] + (P[0] - P[1])] + P + [P[-1] + (P[-1] - P[-2])]
    S = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1:i + 3]
        for k in range(res):
            t = k / res
            S.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    S.append(P[-1])
    c = Vector(center) if center is not None else HC
    bm = bmesh.new(); rings = []; n = len(S)
    for i, p in enumerate(S):
        tan = (S[min(i + 1, n - 1)] - S[max(i - 1, 0)]).normalized()
        rad = p - c; rad -= tan * rad.dot(tan)
        rad = rad.normalized() if rad.length > 1e-6 else Vector((0, 0, 1))
        u = tan.cross(rad).normalized(); v = u.cross(tan).normalized()
        k = profile(i / (n - 1)); w, th = r * width * k, r * flat * k
        if k < 1e-3:
            rings.append([bm.verts.new(p)]); continue
        ring = []
        for j in range(segs):
            a = j / segs * math.tau
            ring.append(bm.verts.new(p + u * (w * math.cos(a)) + v * (th * math.sin(a) - curl * w * 0.35 * math.cos(a) ** 2)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1 and len(b) == 1: continue
        if len(b) == 1:
            for j in range(segs): bm.faces.new((a[j], a[(j + 1) % segs], b[0]))
        elif len(a) == 1:
            for j in range(segs): bm.faces.new((b[(j + 1) % segs], b[j], a[0]))
        else:
            for j in range(segs): bm.faces.new((a[j], a[(j + 1) % segs], b[(j + 1) % segs], b[j]))
    if len(rings[0]) > 1: bm.faces.new(list(reversed(rings[0])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _mesh_obj(name, bm, mat)


def bevel_curve(name, pts, r=0.045, mat=None, res=HAIR_RES, profile=lock_profile):
    """tapered round Bezier tube (bevel + fill caps, per-point radius) — used for thin strokes: brows, lashes, seams, laces"""
    cu = bpy.data.curves.new(name, "CURVE"); cu.dimensions = "3D"
    sp = cu.splines.new("BEZIER"); sp.bezier_points.add(len(pts) - 1)
    for i, (bp, p) in enumerate(zip(sp.bezier_points, pts)):
        bp.co = Vector(p); bp.handle_left_type = bp.handle_right_type = "AUTO"
        bp.radius = profile(i / (len(pts) - 1))
    cu.bevel_depth = r; cu.bevel_resolution = 1; cu.resolution_u = res; cu.use_fill_caps = True
    ob = _link(bpy.data.objects.new(name, cu))
    if mat: cu.materials.append(mat)
    return ob


def stroke(name, pts, r, mat, profile=None, res=6):
    """short beveled curve (brows, lashes, mouth, seams)"""
    return bevel_curve(name, pts, r, mat, res, profile or (lambda t: 1.0))


def to_mesh(objs, name):
    """convert curves -> mesh, join, smooth"""
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if any(o.type == "CURVE" for o in objs): bpy.ops.object.convert(target="MESH")
    if len(objs) > 1: bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active; ob.name = name; ob.data.name = name
    smooth(ob)
    bpy.ops.object.select_all(action="DESELECT")
    return ob


def sph(th, ph, off=0.0):
    """point on the hair shell. th = degrees down from the crown, ph = degrees around (0 front, 90 = +x side, 180 back)"""
    t, p = math.radians(th), math.radians(ph)
    d = Vector((math.sin(t) * math.sin(p), -math.sin(t) * math.cos(p), math.cos(t)))
    return HC + Vector((d.x, d.y * 0.97, d.z * 0.93)) * HR * (1 + off)


def head_y(x, z):
    """front surface of the (unshaped) head ellipsoid at x, z (z relative to H): returns y (negative = front)"""
    ax, ay, az = HEAD_R * HEAD_SCALE[0], HEAD_R * HEAD_SCALE[1], HEAD_R * HEAD_SCALE[2]
    return -ay * math.sqrt(max(0.0, 1 - (x / ax) ** 2 - (z / az) ** 2))


def on_head(x, z, off=0.004):
    y = head_y(x, z)
    n = Vector((x / (HEAD_R * HEAD_SCALE[0]) ** 2, y / (HEAD_R * HEAD_SCALE[1]) ** 2, z / (HEAD_R * HEAD_SCALE[2]) ** 2)).normalized()
    return Vector((x, y, H + z)) + n * off


def shrink_onto(ob, head, off=0.004):
    m = ob.modifiers.new("snap", "SHRINKWRAP"); m.target = head; m.wrap_mode = "OUTSIDE_SURFACE"; m.offset = off
    return ob


def ico_s(name, r, loc, mat, sub=2, scale=(1, 1, 1), rot=(0, 0, 0)):
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
    for v in bm.verts: v.co = Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2]))
    ob = _mesh_obj(name, bm, mat); ob.location = loc; ob.rotation_euler = rot
    return ob


# ---------------------------------------------------------------- materials
def avatar_mats():
    return dict(
        team=mat("Team", (0.2, 0.5, 1.0), rough=0.7), skin=mat("Skin", (1.0, 0.86, 0.74), rough=0.7),
        hair=mat("Hair", (0.2, 0.15, 0.24), rough=0.6), eye=mat("Eye", (0.1, 0.09, 0.13), rough=0.4),
        shine=mat("EyeShine", (1, 1, 1), emit=1.0), legs=mat("Legs", (0.1, 0.09, 0.13), rough=0.6),
        boot=mat("Boot", (0.36, 0.25, 0.2), rough=0.7), sole=mat("Sole", (0.93, 0.89, 0.8), rough=0.8),
        sleeve=mat("Sleeve", (0.94, 0.9, 0.8), rough=0.8), cuff=mat("Cuff", (0.2, 0.5, 1.0), rough=0.7),
        o1=mat("Outfit1", (0.94, 0.9, 0.8), rough=0.8), o2=mat("Outfit2", (0.2, 0.5, 1.0), rough=0.7),
        gold=mat("Gold", (0.95, 0.74, 0.36), metal=0.6, rough=0.3), hatm=mat("HatMain", (0.95, 0.8, 0.45), rough=0.8),
        hatb=mat("HatBand", (0.85, 0.2, 0.22), rough=0.7), halo=mat("Halo", (1.0, 0.9, 0.55), emit=3.0),
        scar=mat("Scar", (0.62, 0.3, 0.3), rough=0.6), blush=mat("Blush", (1.0, 0.55, 0.6), rough=0.8),
        ink=mat("Ink", (0.12, 0.1, 0.15), rough=0.5), mouth=mat("Mouth", (0.55, 0.2, 0.25), rough=0.6),
        inner=mat("EarInner", (1.0, 0.68, 0.72), rough=0.8),
    )


def group(name, objs):
    root = _link(bpy.data.objects.new(name, None)); root.empty_display_type = "PLAIN_AXES"
    bpy.context.view_layer.update()
    for o in objs: parent_keep(o, root)
    return root


# ---------------------------------------------------------------- head
def make_head(M, name="Head"):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=16, radius=HEAD_R)
    for v in bm.verts:
        x, y, z = v.co.x * HEAD_SCALE[0], v.co.y * HEAD_SCALE[1], v.co.z * HEAD_SCALE[2]
        if z < 0.02 and y < 0.05:        # chubby cheeks
            f = math.sin(min(1.0, (0.02 - z) / 0.2) * math.pi) * min(1.0, (0.05 - y) / 0.2)
            x *= 1 + 0.07 * f
        if z < -0.12 and y < 0:          # soft little chin
            y -= 0.012 * min(1.0, (-0.12 - z) / 0.1)
        if y > 0.05: y *= 1.03           # rounder back of the skull
        v.co = Vector((x, y, z))
    ob = _mesh_obj(name, bm, M["skin"]); ob.location = (0, 0, H)
    s = ob.modifiers.new("sub", "SUBSURF"); s.levels = s.render_levels = 1
    return ob


def make_face(M, head):
    """ears, nose, eyes (lids + lashes + shines), brows, mouth -> list of objects"""
    out = []
    for sx in (-1, 1):
        # ear: flattened shell with an inner dish
        ear = loft_profile("Ear", [(-0.05, 0.004, 0.01), (-0.035, 0.022, 0.03), (0.0, 0.03, 0.045), (0.035, 0.026, 0.038), (0.055, 0.008, 0.012)],
                           segs=12, mat=M["skin"], cap_top=True, cap_bottom=True, subsurf=1)
        for v in ear.data.vertices: v.co.x *= 0.55
        ear.location = (sx * 0.262, 0.02, H - 0.025); ear.rotation_euler = (0.1, 0, sx * -0.35)
        out.append(ear)
        inner = ico_s("EarInner", 1, (sx * 0.27, 0.012, H - 0.025), M["inner"], 2, scale=(0.006, 0.018, 0.03), rot=(0.1, 0, sx * -0.35))
        out.append(inner)
    out.append(ico_s("Nose", 0.016, on_head(0, -0.075, -0.006), M["skin"], 2, scale=(1.0, 0.75, 0.8)))
    for sx in (-1, 1):
        ex, ez = sx * 0.096, -0.012
        c = on_head(ex, ez, -0.012)
        yaw = sx * math.atan2(abs(ex), -head_y(ex, ez)) * 0.9
        out.append(ico_s("Eye", 1, c, M["eye"], 3, scale=(0.043, 0.02, 0.06), rot=(0.08, 0, yaw)))
        out.append(ico_s("EyeShine", 1, on_head(ex - sx * 0.014 + 0.0, ez + 0.022, 0.004), M["shine"], 2, scale=(0.012, 0.006, 0.015), rot=(0, 0, yaw)))
        out.append(ico_s("EyeShine", 1, on_head(ex + sx * 0.014, ez - 0.026, 0.003), M["shine"], 1, scale=(0.006, 0.004, 0.006), rot=(0, 0, yaw)))
        # upper lid + lash line: an arc over the eye that thickens to a little flick at the outer corner
        lid = []
        for k in range(6):
            a = math.radians(150 - k * 25)                    # upper lid only (150 deg .. 25 deg)
            lid.append(on_head(ex + sx * 0.05 * math.cos(a), ez + 0.06 * math.sin(a) + 0.006, 0.016))  # inner corner -> outer
        lid.append(on_head(ex + sx * 0.068, ez + 0.042, 0.014))   # outer flick
        out.append(stroke("Lash", lid, 0.0095, M["ink"], lambda t: 0.45 + 0.75 * t))
        # eyebrow: soft arch, thicker at the inner end
        brow = [on_head(ex + sx * d, ez + 0.1 + 0.014 * math.sin((d + 0.04) / 0.09 * math.pi), 0.006) for d in (-0.035, -0.01, 0.015, 0.04)]
        out.append(shrink_onto(stroke("Brow", brow, 0.011, M["hair"], lambda t: 1.0 - 0.55 * t), head, 0.003))
    mouth = [on_head(x, -0.118 - 0.012 * (1 - (x / 0.032) ** 2), 0.004) for x in (-0.032, -0.016, 0.0, 0.016, 0.032)]
    out.append(shrink_onto(stroke("Mouth", mouth, 0.0055, M["mouth"], lambda t: 0.6 + 0.4 * math.sin(t * math.pi)), head, 0.002))
    for nm in ("Lash", "Brow", "Mouth"):
        cs = [o for o in out if o.type == "CURVE" and o.name.startswith(nm)]
        rest = [o for o in out if o not in cs]
        out = rest + [to_mesh(cs, nm)]
    return out


# ---------------------------------------------------------------- base body
def make_arm(M, sx, nm):
    pts = [((0, 0, 0), 0.066), ((0, -0.004, -0.1), 0.056), ((0, -0.008, -0.2), 0.047), ((0, -0.004, -0.29), 0.042),
           ((0, 0, -0.36), 0.036), ((0, 0, -0.41), (0.034, 0.05)), ((0, 0, -0.475), (0.03, 0.042)),
           ((-sx * 0.008, -0.034, -0.385), 0.021), ((-sx * 0.012, -0.056, -0.425), 0.017)]
    edges = [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (5, 6), (4, 7), (7, 8)]
    arm = apply_mods(skin_limb("Arm" + nm, pts, edges, None, loc=(sx * SHOULDER[0], SHOULDER[1], SHOULDER[2])))
    me = arm.data; me.materials.append(M["sleeve"]); me.materials.append(M["skin"])
    for p in me.polygons: p.material_index = 0 if p.center.z > -0.305 else 1
    smooth(arm)
    cuff = loft_profile("Cuff", [(-0.275, 0.05, 0.05), (-0.295, 0.058, 0.058), (-0.315, 0.06, 0.06)], segs=16, mat=M["cuff"],
                        solidify=0.012, subsurf=1)
    cuff.location = arm.location; apply_mods(cuff); parent_keep(cuff, arm)
    hand = _link(bpy.data.objects.new("Hand" + nm, None)); hand.location = (arm.location.x, 0, SHOULDER[2] + HAND_Z)
    parent_keep(hand, arm)
    return arm


def make_leg(M, sx, nm):
    pts = [((0, 0, 0), 0.078), ((0, 0, -0.1), 0.068), ((0, -0.01, -0.2), 0.052), ((0, 0.004, -0.28), 0.056), ((0, 0, -0.38), 0.042)]
    leg = apply_mods(skin_limb("Leg" + nm, pts, [(0, 1), (1, 2), (2, 3), (3, 4)], M["legs"], loc=(sx * HIP[0], 0, HIP[2])))
    smooth(leg)
    x = sx * HIP[0]
    sole = loft_profile("Sole", [(0.0, 0.058, 0.13, x, -0.035), (0.028, 0.062, 0.135, x, -0.037)], segs=20, mat=M["sole"],
                        cap_top=True, cap_bottom=True, subsurf=1)
    shoe = loft_profile("Shoe", [(0.022, 0.058, 0.128, x, -0.036), (0.06, 0.062, 0.13, x, -0.04), (0.095, 0.055, 0.105, x, -0.025),
                                 (0.125, 0.046, 0.06, x, -0.002), (0.15, 0.044, 0.048, x, 0.004)],
                        segs=16, mat=M["boot"], subsurf=1, shape=lambda t, a: (1.0 + 0.06 * (1 - t) * max(0, math.cos(a)), 0.0))
    tongue = loft_profile("ShoeTongue", [(0.08, 0.022, 0.03, x, -0.08), (0.12, 0.02, 0.025, x, -0.052), (0.15, 0.016, 0.02, x, -0.045)],
                          segs=10, mat=M["sole"], cap_top=True, subsurf=1)
    laces = [stroke("Lace", [Vector((x - 0.026, -0.098 + i * 0.022, 0.093 + i * 0.012)), Vector((x, -0.106 + i * 0.022, 0.1 + i * 0.012)),
                             Vector((x + 0.026, -0.098 + i * 0.022, 0.093 + i * 0.012))], 0.005, M["sole"]) for i in range(2)]
    parts = [sole, shoe, tongue] + laces
    for p in parts:
        if p.type == "MESH": apply_mods(p)
    laces = to_mesh(laces, "Laces"); parts = [sole, shoe, tongue, laces]
    for p in parts: parent_keep(p, leg)
    return leg


def make_scarf(M):
    sc = loft_profile("Scarf", [(1.03, 0.118, 0.11, 0, 0.01), (1.06, 0.13, 0.122, 0, 0.012), (1.1, 0.128, 0.12, 0, 0.01), (1.125, 0.105, 0.1, 0, 0.008)],
                      segs=24, mat=M["team"], solidify=0.025, subsurf=1,
                      shape=lambda t, a: (1 + 0.035 * math.sin(a * 5 + t * 2), 0.006 * math.sin(a * 3)))
    tails = []
    for i, (dx, ln, tw) in enumerate(((0.05, 0.3, -0.25), (0.1, 0.24, 0.3))):
        cu = bpy.data.curves.new("ScarfTail", "CURVE"); cu.dimensions = "3D"
        sp = cu.splines.new("BEZIER"); sp.bezier_points.add(3)
        p0 = Vector((dx, -0.11, 1.06))
        for k, bp in enumerate(sp.bezier_points):
            t = k / 3
            bp.co = p0 + Vector((0.03 * t + 0.02 * math.sin(t * 3 + i), -0.05 * t - 0.012 * k, -ln * t))
            bp.handle_left_type = bp.handle_right_type = "AUTO"; bp.tilt = tw * t + 1.3
        cu.extrude = 0.042; cu.resolution_u = 6
        ob = _link(bpy.data.objects.new("ScarfTail", cu)); cu.materials.append(M["team"])
        tails.append(ob)
    tails = to_mesh(tails, "ScarfTails")
    s = tails.modifiers.new("thick", "SOLIDIFY"); s.thickness = 0.014
    s = tails.modifiers.new("sub", "SUBSURF"); s.levels = 1
    return [sc, tails]


def build_avatar():
    s = new_scene("avatar"); M = avatar_mats()
    head = make_head(M)
    make_face(M, head)
    loft_profile("Neck", [(0.98, 0.06, 0.058), (1.08, 0.058, 0.056), (1.2, 0.07, 0.068)], segs=14, mat=M["skin"], subsurf=1)
    make_scarf(M)
    for sx, nm in ((-1, "R"), (1, "L")):
        make_arm(M, sx, nm); make_leg(M, sx, nm)
    finish("avatar", s)


# ---------------------------------------------------------------- hair
def hair_cap(M, front=58, side=96, back=134, name="Cap"):
    """scalp layer just off the head, cut along a hairline (degrees from the crown at front / side / back)"""
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=22, v_segments=12, radius=1)
    kill = []
    for v in bm.verts:
        d = v.co.normalized(); th = math.degrees(math.acos(max(-1, min(1, d.z))))
        ph = abs(math.degrees(math.atan2(d.x, -d.y)))       # 0 front .. 180 back
        lim = front + (side - front) * min(1, ph / 90) if ph < 90 else side + (back - side) * (ph - 90) / 90
        if th > lim: kill.append(v)
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    for v in bm.verts: v.co = HC + Vector((v.co.x, v.co.y * 0.97, v.co.z * 0.93)) * (HR * 0.97)
    ob = _mesh_obj(name, bm, M["hair"])
    s = ob.modifiers.new("thick", "SOLIDIFY"); s.thickness = 0.014; s.offset = -1
    s = ob.modifiers.new("sub", "SUBSURF"); s.levels = 1
    return ob


def lock(M, name, keys, r=0.045, hang=(), curl=None):
    """keys: [(th, ph, off)] on the hair shell; hang: extra offsets (dx, dy, dz) from the last point; curl: final offset"""
    pts = [sph(*k) for k in keys]
    for h in hang: pts.append(pts[-1] + Vector(h))
    if curl: pts.append(pts[-1] + Vector(curl))
    return make_hair_lock(name, pts, r, M["hair"])


def side_dir(ph):
    p = math.radians(ph); return Vector((math.sin(p), -math.cos(p), 0))


def fringe(M, xs, length=0.16, r=0.045, part=0.0, name="Fringe", sweep=0.0):
    """bangs: locks from the top-front, over the forehead, ending above the eyes with the tips curving in"""
    out = []
    for i, ph in enumerate(xs):
        k = [(18, ph * 0.4 + part, 0.06), (40, ph * 0.75, 0.09), (62, ph, 0.07), (76, ph + sweep, 0.02)]
        tip = sph(76 + length * 60, ph + sweep * 1.6, -0.05)
        pts = [sph(*kk) for kk in k] + [tip]
        out.append(make_hair_lock(name, pts, r, M["hair"]))
    return out


def side_locks(M, ln=0.18, r=0.05, curl_in=0.03, ph=82):
    out = []
    for sx in (-1, 1):
        p = sx * ph
        pts = [sph(30, p * 0.8, 0.06), sph(60, p, 0.08), sph(88, p - sx * 6, 0.05)]
        pts.append(pts[-1] + Vector((0, -0.01, -ln * 0.5)))
        pts.append(pts[-1] + Vector((-sx * curl_in, -0.02, -ln * 0.5)))
        out.append(make_hair_lock("SideLock", pts, r, M["hair"]))
    return out


def back_layer(M, n=7, end_th=120, hang=0.0, r=0.06, curl=0.03, flare=0.0, name="BackLock"):
    out = []
    rnd = random.Random(n * 7 + int(end_th))
    for i in range(n):
        ph = 100 + i * (160 / (n - 1)) + rnd.uniform(-6, 6)          # 100 .. 260 around the back
        ph = ph if ph <= 180 else ph - 360
        e = end_th + rnd.uniform(-9, 7)                                # uneven lengths: no straight helmet edge
        pts = [sph(25, ph * 0.5, 0.05), sph(70, ph, 0.1 + flare * 0.5), sph(e, ph, 0.08 + flare)]
        if hang:
            d = side_dir(ph)
            pts.append(pts[-1] + Vector((d.x * 0.02, d.y * 0.02 + 0.01, -hang * 0.55)))
            pts.append(pts[-1] + Vector((d.x * 0.01, d.y * 0.01, -hang * 0.45)))
        d = side_dir(ph)
        pts.append(pts[-1] + Vector((-d.x * curl + d.x * 0.012, -d.y * curl + d.y * 0.012, -0.035)))   # tip flicks slightly out
        out.append(make_hair_lock(name, pts, r * rnd.uniform(0.85, 1.1), M["hair"]))
    # a shorter second layer between the long locks breaks up the silhouette
    for i in range(n - 1 if hang < 0.1 else 0):     # (long hair hangs straight: no short ledge layer)
        ph = 100 + (i + 0.5) * (160 / (n - 1)); ph = ph if ph <= 180 else ph - 360
        e = end_th - 18 + rnd.uniform(-5, 5)
        d = side_dir(ph)
        pts = [sph(40, ph * 0.7, 0.08), sph(80, ph, 0.13 + flare * 0.6), sph(e, ph, 0.12 + flare)]
        pts.append(pts[-1] + Vector((d.x * 0.02, d.y * 0.02, -0.03)))
        out.append(make_hair_lock(name, pts, r * 0.8, M["hair"]))
    return out


def spikes(M, dirs, name="Tuft", r=0.05):
    """locks that sweep up and back from the crown and flick at the ends"""
    out = []
    for th, ph, ln in dirs:
        a, b = sph(max(4, th - 18), ph * 0.7, 0.03), sph(th, ph, 0.1)
        n = (b - HC).normalized()
        d = (n + Vector((0, 1.1, 0.35))).normalized()          # sweep back and a little up
        c = b + d * ln * 0.5
        tip = c + (d + Vector((0, 0.2, -0.45))).normalized() * ln * 0.55   # ends droop: a curve, not a cone
        out.append(make_hair_lock(name, [a, b, c, tip], r, M["hair"], width=1.6, flat=0.7))
    return out


def build_hair(M, style):
    random.seed(7)
    parts = [hair_cap(M, **{"bob": dict(front=56, side=100, back=125), "long": dict(front=58, side=96, back=125),
                           "ponytail": dict(front=56, side=94, back=125), "buns": dict(front=56, side=94, back=125)}.get(style, {}))]
    locks, tufts, fr = [], [], []
    if style == "spiky":
        fr = fringe(M, (-38, -14, 12, 36), length=0.18, r=0.05, sweep=10)
        locks = side_locks(M, ln=0.1, r=0.045) + back_layer(M, n=7, end_th=130, r=0.055, curl=-0.02)
        tufts = spikes(M, [(18, 170, 0.16), (26, -150, 0.15), (30, 130, 0.13), (32, -115, 0.12), (12, -60, 0.12), (14, 50, 0.13), (8, 0, 0.1)], r=0.055)
    elif style == "messy":
        fr = fringe(M, (-44, -24, -4, 16, 36), length=0.2, r=0.045, sweep=-14)
        locks = side_locks(M, ln=0.13, r=0.048, curl_in=-0.03) + back_layer(M, n=8, end_th=130, r=0.055, curl=-0.04, flare=0.04)
        rnd = random.Random(5)
        tufts = spikes(M, [(rnd.uniform(15, 40), rnd.uniform(-180, 180), rnd.uniform(0.07, 0.12)) for _ in range(7)], r=0.05)
    elif style == "long":
        fr = fringe(M, (-30, -6, 18), length=0.2, r=0.05, part=-12, sweep=-18)
        locks = side_locks(M, ln=0.42, r=0.055, curl_in=0.04, ph=80) + back_layer(M, n=8, end_th=135, hang=0.42, r=0.065, curl=0.04)
    elif style == "bob":
        fr = fringe(M, (-36, -18, 0, 18, 36), length=0.17, r=0.048)
        locks = side_locks(M, ln=0.14, r=0.06, curl_in=0.025, ph=78) + back_layer(M, n=9, end_th=130, hang=0.07, r=0.065, curl=0.022, flare=0.03)
    elif style == "ponytail":
        fr = fringe(M, (-30, -8, 16), length=0.17, r=0.045, sweep=8)
        locks = side_locks(M, ln=0.1, r=0.04, ph=84)
        # smooth pulled-back strands meeting at the tie
        tie = HC + Vector((0, HR * 0.98, 0.03))
        for ph in (-120, -60, 0, 60, 120):
            locks.append(make_hair_lock("Strand", [sph(55, ph * 0.5, 0.03), sph(35, 180 - ph * 0.4, 0.04), tie + Vector((0, -0.01, 0))], 0.04, M["hair"],
                                        profile=lambda t: 1.0 - 0.3 * t))
        bpy.ops.mesh.primitive_torus_add(major_radius=0.04, minor_radius=0.018, major_segments=16, minor_segments=8,
                                         location=tie + Vector((0, 0.02, 0)), rotation=(math.pi / 2 - 0.3, 0, 0))
        t = bpy.context.object; t.name = "Tie"; assign(t, M["hatb"]); smooth(t); parts.append(t)
        for i, (dx, ln) in enumerate(((-0.025, 0.5), (0.0, 0.56), (0.028, 0.48))):
            p0 = tie + Vector((dx, 0.04, 0))
            locks.append(make_hair_lock("Ponytail", [p0, p0 + Vector((dx, 0.1, -0.05)), p0 + Vector((dx * 2, 0.1, -ln * 0.45)),
                                                     p0 + Vector((dx * 1.5 - 0.02, 0.04, -ln * 0.8)), p0 + Vector((dx - 0.04, 0.0, -ln))],
                                        0.06, M["hair"]))
    elif style == "buns":
        fr = fringe(M, (-34, -12, 12, 34), length=0.16, r=0.046)
        locks = side_locks(M, ln=0.16, r=0.04, ph=84) + back_layer(M, n=7, end_th=128, r=0.05, curl=-0.01)
        for sx in (-1, 1):  # each bun: a lock coiled up and over a round core (a dome spiral, not a flat disc)
            c = HC + Vector((sx * 0.185, 0.05, 0.2))
            pts = []
            for k in range(19):
                h = k / 18; a = h * math.tau * 2.4
                rr = 0.085 * math.sqrt(max(0.02, 1 - (h * 0.92) ** 2))
                pts.append(c + Vector((math.cos(a) * rr, math.sin(a) * rr, 0.09 * h)))
            tufts.append(make_hair_lock("Tuft", pts, 0.036, M["hair"], profile=lambda t: 0.9 - 0.5 * t * t, center=c + Vector((0, 0, 0.02)),
                                        width=1.25, flat=0.85, res=4))
            tufts.append(ico_s("TuftCore", 1, c + Vector((0, 0, 0.035)), M["hair"], 2, scale=(0.08, 0.08, 0.075)))
    parts.append(to_mesh(fr, "Fringe"))
    if locks: parts.append(to_mesh(locks, "Locks"))
    if tufts: parts.append(to_mesh(tufts, "Tuft"))
    return parts


# ---------------------------------------------------------------- outfits
def torso_rings(scale=1.0, z0=0.0, z1=9.0, extra=0.0):
    return [(z, rx * scale + extra, ry * scale + extra) for z, rx, ry in TORSO if z0 <= z <= z1]


def wave_hem(n=5, amp=0.04, dz=0.02, folds=0.02):
    return lambda t, a: (1 + t * t * (amp * math.sin(a * n) + folds * math.sin(a * 11 + 1)), -t ** 3 * dz * math.cos(a * n))


def build_outfit(M, kind):
    o = []
    if kind == "cloak":
        o.append(loft_profile("Tunic", torso_rings(1.0) + [(1.075, 0.075, 0.07)], segs=24, mat=M["o2"], subsurf=1))
        o.append(loft_profile("TunicSkirt", [(0.6, 0.155, 0.118), (0.48, 0.19, 0.15), (0.36, 0.22, 0.18)], segs=24, mat=M["o2"],
                              solidify=0.012, shape=wave_hem(6, 0.05, 0.015)))
        o.append(loft_profile("Belt", [(0.6, 0.158, 0.122), (0.64, 0.156, 0.12)], segs=24, mat=M["hatb"], solidify=0.02, subsurf=1))
        o.append(ico_s("Buckle", 1, (0, -0.128, 0.62), M["gold"], 2, scale=(0.03, 0.012, 0.025)))
        # long cape hanging from the shoulders down the back (open at the sides so the arms show)
        cape = [(1.02, 0.2, 0.15, 0, 0.03), (0.9, 0.26, 0.2, 0, 0.05), (0.62, 0.31, 0.25, 0, 0.07), (0.38, 0.35, 0.29, 0, 0.09), (0.16, 0.39, 0.33, 0, 0.11)]
        wav = lambda t, a: (1 + t * t * (0.05 * math.sin(a * 5) + 0.02 * math.sin(a * 13)), -t ** 3 * 0.025 * math.cos(a * 5))
        o.append(loft_profile("Cloak", cape, segs=36, mat=M["o1"], gap=1.95, solidify=0.018, displace=0.01, shape=wav))
        o.append(loft_profile("CloakTrim", [(0.21, 0.384, 0.325, 0, 0.105), (0.16, 0.395, 0.335, 0, 0.11)], segs=36, mat=M["o2"], gap=1.95,
                              solidify=0.024, shape=lambda t, a: (1.012 * (1 + (0.6 + 0.4 * t) * (0.05 * math.sin(a * 5) + 0.02 * math.sin(a * 13))), -(0.6 + 0.4 * t) * 0.025 * math.cos(a * 5))))
        # shoulder capelet: closed at the back, parted at the front, scalloped hem with trim
        cap_rings = [(1.075, 0.09, 0.085, 0, 0.01), (1.03, 0.19, 0.15, 0, 0.012), (0.97, 0.27, 0.19, 0, 0.015), (0.88, 0.31, 0.22, 0, 0.02)]
        scal = lambda t, a: (1 + t * 0.03 * math.sin(a * 8), -t * t * 0.03 * abs(math.sin(a * 4)))
        o.append(loft_profile("Capelet", cap_rings, segs=40, mat=M["o1"], gap=0.22, solidify=0.02, shape=scal, subsurf=1))
        o.append(loft_profile("CapeletTrim", [(0.9, 0.305, 0.217, 0, 0.02), (0.875, 0.315, 0.225, 0, 0.02)], segs=40, mat=M["o2"], gap=0.22, solidify=0.02,
                              shape=lambda t, a: (1.01 * (1 + 0.03 * math.sin(a * 8)), -0.03 * abs(math.sin(a * 4)))))
        # hood down: draped over the upper back, not a ring around the neck
        o.append(loft_profile("HoodDown", [(1.09, 0.13, 0.1, 0, 0.04), (1.04, 0.2, 0.15, 0, 0.09), (0.97, 0.19, 0.16, 0, 0.15),
                                           (0.9, 0.13, 0.12, 0, 0.19), (0.86, 0.04, 0.04, 0, 0.21)],
                              segs=24, mat=M["o1"], gap=2.0, solidify=0.018, subsurf=1))
        o.append(ico_s("Clasp", 1, (0, -0.135, 1.03), M["gold"], 2, scale=(0.038, 0.016, 0.038)))
        o.append(ico_s("ClaspGem", 1, (0, -0.15, 1.03), M["hatb"], 2, scale=(0.017, 0.01, 0.017)))
    elif kind == "vest":
        o.append(loft_profile("Torso", torso_rings(1.0, 0.5) + [(1.075, 0.075, 0.07)], segs=24, mat=M["skin"], subsurf=1))
        vest = torso_rings(1.07, 0.6, 1.035)
        o.append(loft_profile("Vest", vest, segs=28, mat=M["o1"], gap=0.5, solidify=0.02, subsurf=1,
                              shape=lambda t, a: (1.0, 0.0)))
        o.append(loft_profile("VestTrim", [(0.6, 0.162, 0.123), (0.63, 0.16, 0.121)], segs=28, mat=M["o2"], gap=0.5, solidify=0.026, subsurf=1))
        for sx in (-1, 1):  # front edge piping
            o.append(stroke("Piping", [Vector((sx * 0.062, -0.122, 0.62)), Vector((sx * 0.07, -0.13, 0.78)), Vector((sx * 0.07, -0.13, 0.9)),
                                       Vector((sx * 0.05, -0.11, 1.01))], 0.009, M["o2"]))
            o.append(loft_profile("Pocket", [(0.68, 0.035, 0.008, sx * 0.1, -0.13), (0.73, 0.035, 0.008, sx * 0.1, -0.13)], segs=12, mat=M["o2"],
                                  cap_top=True, cap_bottom=True, subsurf=1))
        o.append(loft_profile("Shorts", [(0.64, 0.152, 0.116), (0.56, 0.18, 0.138), (0.47, 0.2, 0.15)], segs=24, mat=M["o2"], subsurf=1))
        for sx in (-1, 1):
            o.append(loft_profile("ShortsLeg", [(0.5, 0.1, 0.1, sx * 0.1, 0), (0.4, 0.096, 0.096, sx * 0.105, 0), (0.355, 0.1, 0.1, sx * 0.108, 0)],
                                  segs=16, mat=M["o2"], solidify=0.012, subsurf=1, shape=lambda t, a: (1 + 0.03 * t * math.sin(a * 4), 0)))
        o.append(loft_profile("Sash", [(0.6, 0.158, 0.122), (0.655, 0.155, 0.119)], segs=24, mat=M["hatb"], solidify=0.024, subsurf=1,
                              shape=lambda t, a: (1, 0.01 * math.sin(a * 2))))
        knot = ico_s("SashKnot", 1, (0.1, -0.13, 0.625), M["hatb"], 2, scale=(0.035, 0.022, 0.03))
        tails = [stroke("SashTail", [Vector((0.1, -0.135, 0.62)), Vector((0.12 + i * 0.02, -0.145, 0.56)), Vector((0.13 + i * 0.04, -0.14, 0.49))],
                        0.018, M["hatb"], lambda t: 1 - 0.4 * t) for i in range(2)]
        o += [knot] + tails
    elif kind == "gown":
        o.append(loft_profile("Bodice", torso_rings(1.02, 0.6) + [(1.075, 0.075, 0.07)], segs=24, mat=M["o2"], subsurf=1))
        skirt = [(0.68, 0.152, 0.116), (0.6, 0.2, 0.16), (0.45, 0.3, 0.25), (0.28, 0.4, 0.34), (0.1, 0.47, 0.41)]
        o.append(loft_profile("Gown", skirt, segs=40, mat=M["o1"], solidify=0.015, displace=0.008,
                              shape=lambda t, a: (1 + t * (0.055 * math.sin(a * 8)) + t * t * 0.02 * math.sin(a * 3), -t ** 3 * 0.02 * math.cos(a * 8))))
        o.append(loft_profile("GownTrim", [(0.1, 0.475, 0.415), (0.145, 0.455, 0.395)], segs=40, mat=M["o2"], solidify=0.022,
                              shape=lambda t, a: (1.012 * (1 + (1 - t * 0.1) * 0.055 * math.sin(a * 8)), -(1 - t) * 0.02 * math.cos(a * 8))))
        o.append(loft_profile("Ruffle", [(1.0, 0.12, 0.1, 0, 0.005), (1.035, 0.19, 0.17, 0, 0.005)], segs=36, mat=M["o1"], solidify=0.012, subsurf=1,
                              shape=lambda t, a: (1, t * 0.022 * math.sin(a * 12))))
        for z in (0.72, 0.8, 0.88):
            o.append(ico_s("Button", 1, (0, -0.128 - (0.012 if z > 0.85 else 0.0), z), M["gold"], 2, scale=(0.014, 0.008, 0.014)))
        for sx in (-1, 1):  # bow at the back
            bpy.ops.mesh.primitive_torus_add(major_radius=0.05, minor_radius=0.016, major_segments=16, minor_segments=8,
                                             location=(sx * 0.05, 0.13, 0.68), rotation=(math.pi / 2, 0, sx * 0.4))
            b = bpy.context.object; b.name = "Bow"; b.scale = (1, 0.6, 1); assign(b, M["o2"]); smooth(b); o.append(b)
            o.append(stroke("BowTail", [Vector((0, 0.13, 0.67)), Vector((sx * 0.04, 0.14, 0.58)), Vector((sx * 0.06, 0.15, 0.5))], 0.016, M["o2"], lambda t: 1 - 0.5 * t))
        o.append(ico_s("BowKnot", 1, (0, 0.13, 0.68), M["o2"], 2, scale=(0.025, 0.02, 0.025)))
    elif kind == "jacket":
        jr = [(z, rx * 1.08, ry * 1.1) for z, rx, ry in TORSO if 0.48 <= z <= 1.035]
        jr[0] = (0.48, 0.185, 0.145)
        o.append(loft_profile("Jacket", jr, segs=28, mat=M["o1"], subsurf=1))
        o.append(loft_profile("JacketHem", [(0.46, 0.188, 0.148), (0.53, 0.19, 0.15)], segs=28, mat=M["o2"], solidify=0.02, subsurf=1,
                              shape=lambda t, a: (1 + 0.012 * math.sin(a * 28), 0)))   # ribbing
        o.append(loft_profile("Collar", [(1.0, 0.13, 0.11, 0, 0.005), (1.06, 0.1, 0.09, 0, 0.008), (1.11, 0.1, 0.092, 0, 0.01)], segs=24, mat=M["o2"],
                              gap=0.28, solidify=0.016, subsurf=1))
        o.append(loft_profile("Zip", [(0.47, 0.01, 0.006, 0, -0.163), (1.0, 0.01, 0.006, 0, -0.135)], segs=8, mat=M["ink"], subsurf=0,
                              shape=lambda t, a: (1, 0)))
        o.append(ico_s("ZipPull", 1, (0, -0.145, 0.98), M["gold"], 2, scale=(0.012, 0.006, 0.022)))
        for sx in (-1, 1):
            o.append(loft_profile("PocketFlap", [(0.6, 0.05, 0.01, sx * 0.11, -0.16), (0.64, 0.05, 0.01, sx * 0.11, -0.158)], segs=12, mat=M["o2"],
                                  cap_top=True, cap_bottom=True, subsurf=1))
            o.append(stroke("Seam", [Vector((sx * 0.2, 0, 0.5)), Vector((sx * 0.185, 0, 0.75)), Vector((sx * 0.2, 0, 0.95))], 0.006, M["o2"]))
            o.append(stroke("Stripe", [Vector((sx * 0.06, -0.09, 1.05)), Vector((sx * 0.15, -0.03, 1.02)), Vector((sx * 0.2, 0.02, 0.98))], 0.012, M["o2"]))
            o.append(stroke("Drawstring", [Vector((sx * 0.03, -0.12, 1.04)), Vector((sx * 0.035, -0.135, 0.97)), Vector((sx * 0.032, -0.14, 0.92))], 0.006, M["o2"]))
            o.append(ico_s("Aglet", 1, (sx * 0.032, -0.141, 0.91), M["gold"], 1, scale=(0.008, 0.008, 0.012)))
    curves = [x for x in o if x.type == "CURVE"]
    if curves:
        rest = [x for x in o if x.type != "CURVE"]   # (join deletes the other curve objects: list them first)
        o = rest + [to_mesh(curves, "Details")]
    return o


# ---------------------------------------------------------------- hats
def build_hat(M, kind):
    o = []
    top = H + 0.27     # roughly where hats sit over hair
    if kind == "straw":
        o.append(loft_profile("Brim", [(top - 0.06, 0.25, 0.25), (top - 0.07, 0.4, 0.4), (top - 0.055, 0.5, 0.5)], segs=36, mat=M["hatm"], solidify=0.018,
                              subsurf=1, shape=lambda t, a: (1 + t * 0.02 * math.sin(a * 6), t * t * 0.015 * math.sin(a * 2))))
        o.append(loft_profile("Dome", [(top - 0.07, 0.25, 0.25), (top + 0.04, 0.245, 0.245), (top + 0.11, 0.2, 0.2), (top + 0.14, 0.1, 0.1)], segs=28,
                              mat=M["hatm"], cap_top=True, subsurf=1))
        o.append(loft_profile("Band", [(top - 0.045, 0.255, 0.255), (top + 0.015, 0.252, 0.252)], segs=28, mat=M["hatb"], solidify=0.012, subsurf=1))
    elif kind == "wide":
        o.append(loft_profile("WideBrim", [(top - 0.06, 0.24, 0.24), (top - 0.07, 0.42, 0.42), (top - 0.1, 0.58, 0.58)], segs=40, mat=M["hatm"], solidify=0.016,
                              subsurf=1, shape=lambda t, a: (1 + t * 0.03 * math.sin(a * 4), -t * t * 0.05 * math.cos(a * 2) + t * t * 0.03)))
        o.append(loft_profile("WideCrown", [(top - 0.07, 0.24, 0.24), (top + 0.08, 0.235, 0.235), (top + 0.15, 0.22, 0.22), (top + 0.17, 0.15, 0.15)],
                              segs=28, mat=M["hatm"], cap_top=True, subsurf=1, shape=lambda t, a: (1, t * 0.02 * math.cos(a))))
        o.append(loft_profile("Ribbon", [(top - 0.05, 0.245, 0.245), (top + 0.02, 0.242, 0.242)], segs=28, mat=M["hatb"], solidify=0.012, subsurf=1))
        for k, (ph, z) in enumerate(((60, 0.0), (80, 0.02), (100, -0.01))):  # flowers: five petals around a gold centre
            p = math.radians(ph); c = Vector((math.sin(p) * 0.26, -math.cos(p) * 0.26, top - 0.02 + z))
            for i in range(5):
                a = i / 5 * math.tau
                o.append(ico_s("Flower", 1, c + Vector((0.025 * math.cos(a) * math.cos(p), 0.025 * math.cos(a) * math.sin(p), 0.025 * math.sin(a))),
                               M["hatb"], 1, scale=(0.022, 0.022, 0.022)))
            o.append(ico_s("Flower", 1, c + Vector((math.sin(p) * 0.012, -math.cos(p) * 0.012, 0)), M["gold"], 1, scale=(0.015, 0.015, 0.015)))
        o.append(stroke("RibbonTail", [Vector((0.2, 0.15, top - 0.03)), Vector((0.24, 0.24, top - 0.12)), Vector((0.22, 0.3, top - 0.26))], 0.02, M["hatb"],
                        lambda t: 1 - 0.3 * t))
    elif kind == "hood":
        rings = [(H - 0.22, 0.3, 0.28, 0, 0.04), (H - 0.05, 0.33, 0.33, 0, 0.03), (H + 0.12, 0.32, 0.33, 0, 0.03), (H + 0.26, 0.26, 0.28, 0, 0.04),
                 (H + 0.34, 0.14, 0.17, 0, 0.07), (H + 0.37, 0.04, 0.06, 0, 0.1)]
        hood = loft_profile("HoodUp", rings, segs=32, mat=M["hatm"], gap=0.78, gap_rows={0, 1, 2}, solidify=0.025, subsurf=1,
                            shape=lambda t, a: (1 + 0.015 * math.sin(a * 7) * (1 - t), 0))
        o.append(hood)
        o.append(stroke("HoodTip", [Vector((0, 0.12, H + 0.36)), Vector((0, 0.3, H + 0.3)), Vector((0, 0.4, H + 0.12)), Vector((0, 0.42, H - 0.02))],
                        0.06, M["hatm"], lambda t: max(0.0, 1 - t) ** 0.8))
    elif kind == "beanie":
        o.append(loft_profile("Beanie", [(H + 0.12, 0.31, 0.3), (H + 0.22, 0.3, 0.29), (H + 0.3, 0.26, 0.25), (H + 0.36, 0.17, 0.165), (H + 0.38, 0.05, 0.05)],
                              segs=32, mat=M["hatm"], cap_top=True, subsurf=1, shape=lambda t, a: (1 + 0.008 * math.sin(a * 16), 0)))
        o.append(loft_profile("BeanieCuff", [(H + 0.06, 0.315, 0.305), (H + 0.11, 0.322, 0.312), (H + 0.15, 0.314, 0.304)], segs=48, mat=M["hatb"],
                              solidify=0.03, subsurf=1, shape=lambda t, a: (1 + 0.02 * max(0, math.sin(a * 24)), 0)))
        pom = ico_s("Pom", 0.08, (0, 0.0, H + 0.43), M["hatb"], 3)
        rnd = random.Random(3)
        for v in pom.data.vertices: v.co *= 1 + rnd.uniform(-0.12, 0.12)
        o.append(pom)
    elif kind == "crown":
        o.append(loft_profile("CrownRing", [(top - 0.02, 0.2, 0.2), (top + 0.04, 0.205, 0.205), (top + 0.12, 0.22, 0.22)], segs=60, mat=M["gold"],
                              solidify=0.02, subsurf=1, shape=lambda t, a: (1, t * 0.06 * max(-0.4, math.cos(a * 6)))))
        for i in range(6):
            a = i / 6 * math.tau
            o.append(ico_s("Jewel", 1, (math.sin(a) * 0.22, -math.cos(a) * 0.22, top + 0.13), M["hatb"], 2, scale=(0.018, 0.018, 0.018)))
            o.append(ico_s("Jewel", 1, (math.sin(a + 0.52) * 0.215, -math.cos(a + 0.52) * 0.215, top + 0.02), M["hatb"], 2, scale=(0.012, 0.012, 0.012)))
    elif kind == "halo":
        bpy.ops.mesh.primitive_torus_add(major_radius=0.22, minor_radius=0.022, major_segments=40, minor_segments=8, location=(0, 0.05, H + 0.47),
                                         rotation=(0.15, 0, 0))
        hl = bpy.context.object; hl.name = "Halo"; assign(hl, M["halo"]); smooth(hl); o.append(hl)
    elif kind == "ears":
        for sx in (-1, 1):
            base = HC + Vector((sx * 0.17, 0.0, 0.2))
            ear = loft_profile("CatEar", [(0, 0.075, 0.035), (0.08, 0.05, 0.025), (0.15, 0.02, 0.012), (0.18, 0.004, 0.004)], segs=12, mat=M["hair"],
                               cap_bottom=True, subsurf=1, shape=lambda t, a: (1 - 0.25 * t * max(0, -math.cos(a)), 0))
            ear.location = base; ear.rotation_euler = (0.15, sx * 0.35, 0)
            inner = loft_profile("EarInner", [(0.02, 0.045, 0.012, 0, -0.022), (0.1, 0.028, 0.009, 0, -0.02), (0.15, 0.006, 0.004, 0, -0.012)], segs=10,
                                 mat=M["inner"], cap_bottom=True, subsurf=1)
            inner.location = base; inner.rotation_euler = (0.15, sx * 0.35, 0)
            o += [ear, inner]
    curves = [x for x in o if x.type == "CURVE"]
    if curves:
        rest = [x for x in o if x.type != "CURVE"]
        o = rest + [to_mesh(curves, "HatDetails")]
    return o


# ---------------------------------------------------------------- face options
def build_face_option(M, kind, head):
    o = []
    if kind == "scar":
        o.append(shrink_onto(stroke("ScarLine", [on_head(0.118, -0.03), on_head(0.128, -0.065), on_head(0.135, -0.1)], 0.006, M["scar"]), head))
        for d in (-0.047, -0.08):
            o.append(shrink_onto(stroke("Stitch", [on_head(0.112, d), on_head(0.145, d - 0.004)], 0.0035, M["scar"]), head))
    elif kind == "blush":
        for sx in (-1, 1):
            b = loft_profile("Blush", [(-0.001, 0.035, 0.035), (0.0, 0.035, 0.035)], segs=16, mat=M["blush"], cap_top=True, cap_bottom=True, subsurf=1)
            for v in b.data.vertices: v.co = on_head(sx * 0.15 + v.co.x, -0.06 + v.co.y * 0.55, 0.004 + v.co.z)
            o.append(shrink_onto(b, head, 0.002))
    elif kind == "glasses":
        for sx in (-1, 1):
            bpy.ops.mesh.primitive_torus_add(major_radius=0.06, minor_radius=0.008, major_segments=28, minor_segments=6,
                                             location=on_head(sx * 0.096, -0.01, 0.028), rotation=(math.pi / 2, 0, sx * 0.25))
            g = bpy.context.object; g.name = "GlassRim"; assign(g, M["ink"]); smooth(g); o.append(g)
            o.append(stroke("Temple", [on_head(sx * 0.152, 0.0, 0.03), Vector((sx * 0.25, -0.12, H + 0.0)), Vector((sx * 0.27, 0.0, H - 0.01))], 0.006, M["ink"]))
        o.append(stroke("Bridge", [on_head(-0.038, 0.0, 0.028), on_head(0, 0.012, 0.03), on_head(0.038, 0.0, 0.028)], 0.006, M["ink"]))
    curves = [x for x in o if x.type == "CURVE"]
    if curves:
        rest = [x for x in o if x.type != "CURVE"]
        o = rest + [to_mesh(curves, "FaceDetails")]
    for x in o: apply_mods(x)
    return o


HAIR_STYLES = ["spiky", "messy", "long", "bob", "ponytail", "buns"]
OUTFITS = ["cloak", "vest", "gown", "jacket"]
HATS = ["straw", "wide", "hood", "beanie", "crown", "halo", "ears"]
FACES = ["scar", "blush", "glasses"]


def build_avatar_parts():
    s = new_scene("avatar_parts"); M = avatar_mats()
    head = make_head(M, "TmpHead"); apply_mods(head)
    for k in OUTFITS: group("outfit_" + k, build_outfit(M, k))
    for k in HAIR_STYLES: group("hair_" + k, build_hair(M, k))
    for k in HATS: group("hat_" + k, build_hat(M, k))
    for k in FACES: group("face_" + k, build_face_option(M, k, head))
    bpy.data.objects.remove(head, do_unlink=True)
    finish("avatar_parts", s)


def preview_avatar(outfit="cloak", hair="spiky", hat="none", face="none", name="avatar_preview"):
    """build one look into a scene you can look at (not exported). Re-running replaces it."""
    old = bpy.data.scenes.get(name)
    if old:
        for o in list(old.objects): bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.scenes.remove(old)
    s = new_scene(name); M = avatar_mats()
    head = make_head(M); make_face(M, head)
    loft_profile("Neck", [(0.98, 0.06, 0.058), (1.08, 0.058, 0.056), (1.2, 0.07, 0.068)], segs=14, mat=M["skin"], subsurf=1)
    make_scarf(M)
    for sx, nm in ((-1, "R"), (1, "L")): make_arm(M, sx, nm); make_leg(M, sx, nm)
    build_outfit(M, outfit); build_hair(M, hair)
    if hat != "none": build_hat(M, hat)
    if face != "none": build_face_option(M, face, head)
    return s


def preview_grid(looks, name="avatar_preview", gap=1.1):
    """several looks side by side (x offsets) for review shots; looks = [(outfit, hair, hat, face), ...]"""
    s = preview_avatar(*looks[0], name=name)
    done = set(s.objects)
    for i, lk in enumerate(looks[1:], 1):
        M = avatar_mats()
        head = make_head(M); make_face(M, head)
        loft_profile("Neck", [(0.98, 0.06, 0.058), (1.08, 0.058, 0.056), (1.2, 0.07, 0.068)], segs=14, mat=M["skin"], subsurf=1)
        make_scarf(M)
        for sx, nm in ((-1, "R"), (1, "L")): make_arm(M, sx, nm); make_leg(M, sx, nm)
        build_outfit(M, lk[0]); build_hair(M, lk[1])
        if lk[2] != "none": build_hat(M, lk[2])
        if lk[3] != "none": build_face_option(M, lk[3], head)
        for o in s.objects:
            if o not in done and o.parent is None: o.location.x += i * gap
        done = set(s.objects)
    for o in s.objects:
        if o.type == "EMPTY": o.empty_display_size = 0.05
    return s
