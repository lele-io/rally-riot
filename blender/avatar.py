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
SHOULDER = (0.245, 0.0, 1.0)      # arm pivot (x mirrored) — broad, sporty shoulders
HIP = (0.105, 0.0, 0.5)           # leg pivot (x mirrored)
HAND_Z = -0.44                    # HandR empty below the shoulder (racket grip)
HC, HR = Vector((0, 0.012, H + 0.03)), 0.288   # hair shell: centre / radius (sits just off the scalp)
LIMB_SUB, CLOTH_SUB = 2, 1        # subdivision levels
HAIR_RES, HAIR_BEV = 4, 3         # lock smoothness: samples per control-point span / (unused) bevel steps
TORSO = [  # (z, rx, ry) athletic chibi torso: hips, waist, ribcage, chest, shoulders, neck (V-shape, not a bodybuilder)
    (0.44, 0.17, 0.13), (0.52, 0.176, 0.132), (0.62, 0.158, 0.118), (0.72, 0.17, 0.126),
    (0.84, 0.198, 0.14), (0.93, 0.216, 0.142), (0.99, 0.2, 0.128), (1.035, 0.14, 0.1), (1.075, 0.076, 0.072)]

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
        legs2=mat("Legs2", (0.1, 0.09, 0.13), rough=0.6), sock=mat("Sock", (0.97, 0.96, 0.94), rough=0.9),
        boot=mat("Boot", (0.36, 0.25, 0.2), rough=0.7), sole=mat("Sole", (0.93, 0.89, 0.8), rough=0.8),
        sleeve=mat("Sleeve", (0.94, 0.9, 0.8), rough=0.8), sleeve2=mat("Sleeve2", (0.94, 0.9, 0.8), rough=0.8),
        cuff=mat("Cuff", (0.2, 0.5, 1.0), rough=0.7),
        o1=mat("Outfit1", (0.94, 0.9, 0.8), rough=0.8), o2=mat("Outfit2", (0.2, 0.5, 1.0), rough=0.7),
        gold=mat("Gold", (0.95, 0.74, 0.36), metal=0.6, rough=0.3), hatm=mat("HatMain", (0.95, 0.8, 0.45), rough=0.8),
        hatb=mat("HatBand", (0.85, 0.2, 0.22), rough=0.7), halo=mat("Halo", (1.0, 0.9, 0.55), emit=3.0),
        scar=mat("Scar", (0.62, 0.3, 0.3), rough=0.6), blush=mat("Blush", (1.0, 0.55, 0.6), rough=0.8),
        ink=mat("Ink", (0.12, 0.1, 0.15), rough=0.5), mouth=mat("Mouth", (0.55, 0.2, 0.25), rough=0.6),
        inner=mat("EarInner", (1.0, 0.68, 0.72), rough=0.8), teeth=mat("Teeth", (1.0, 0.99, 0.97), rough=0.5),
        freckle=mat("Freckle", (0.72, 0.42, 0.3), rough=0.8), bandaid=mat("Bandaid", (0.96, 0.78, 0.6), rough=0.8),
        lens=mat("Lens", (0.08, 0.1, 0.16), metal=0.4, rough=0.15), towel=mat("Towel", (0.97, 0.96, 0.93), rough=0.95),
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
            x *= 1 + 0.035 * f
        if z < -0.12 and y < 0:          # soft little chin
            y -= 0.018 * min(1.0, (-0.12 - z) / 0.1)
        if y > 0.05: y *= 1.03           # rounder back of the skull
        v.co = Vector((x, y, z))
    ob = _mesh_obj(name, bm, M["skin"]); ob.location = (0, 0, H)
    s = ob.modifiers.new("sub", "SUBSURF"); s.levels = s.render_levels = 1
    return ob


def make_face(M, head):
    """ears + nose (always there). Eyes, brows and mouth are parts: build_eyes / build_brows / build_mouth"""
    out = []
    for sx in (-1, 1):
        ear = loft_profile("Ear", [(-0.05, 0.004, 0.01), (-0.035, 0.022, 0.03), (0.0, 0.03, 0.045), (0.035, 0.026, 0.038), (0.055, 0.008, 0.012)],
                           segs=12, mat=M["skin"], cap_top=True, cap_bottom=True, subsurf=1)
        for v in ear.data.vertices: v.co.x *= 0.55
        ear.location = (sx * 0.262, 0.02, H - 0.025); ear.rotation_euler = (0.1, 0, sx * -0.35)
        out.append(ear)
        out.append(ico_s("EarInner", 1, (sx * 0.27, 0.012, H - 0.025), M["inner"], 2, scale=(0.006, 0.018, 0.03), rot=(0.1, 0, sx * -0.35)))
    out.append(ico_s("Nose", 0.017, on_head(0, -0.072, -0.006), M["skin"], 2, scale=(0.95, 0.8, 0.9)))
    return out


EYE_X, EYE_Z = 0.096, -0.012


def _strokes_to_mesh(objs, names):
    for nm in names:
        cs = [o for o in objs if o.type == "CURVE" and o.name.startswith(nm)]
        if not cs: continue
        rest = [o for o in objs if o not in cs]
        objs = rest + [to_mesh(cs, nm)]
    return objs


def build_eyes(M, style, head):
    """round: big glossy anime eyes + lashes with a flick. sharp: almond, tilted, bold lid. narrow: calm half-lidded.
    fierce: tilted hard, heavy angled lid. Each: Eye (recolored) + EyeShine + Lash (lid line)."""
    out = []
    cfg = {"round": dict(sc=(0.043, 0.02, 0.06), tilt=0.0, shines=2),
           "sharp": dict(sc=(0.044, 0.02, 0.043), tilt=0.22, shines=1),
           "narrow": dict(sc=(0.043, 0.02, 0.03), tilt=0.08, shines=1),
           "fierce": dict(sc=(0.042, 0.02, 0.038), tilt=0.38, shines=1)}[style]
    for sx in (-1, 1):
        ex, ez = sx * EYE_X, EYE_Z
        yaw = sx * math.atan2(abs(ex), -head_y(ex, ez)) * 0.9
        tilt = -sx * cfg["tilt"]                      # outer corner up
        out.append(ico_s("Eye", 1, on_head(ex, ez, -0.012), M["eye"], 3, scale=cfg["sc"], rot=(0.08, tilt, yaw)))
        hz = cfg["sc"][2]
        out.append(ico_s("EyeShine", 1, on_head(ex - sx * 0.013, ez + hz * 0.38, 0.004), M["shine"], 2,
                         scale=(0.011, 0.006, min(0.015, hz * 0.3)), rot=(0, 0, yaw)))
        if cfg["shines"] > 1:
            out.append(ico_s("EyeShine", 1, on_head(ex + sx * 0.014, ez - 0.026, 0.003), M["shine"], 1, scale=(0.006, 0.004, 0.006), rot=(0, 0, yaw)))
        if style == "round":
            lid = [on_head(ex + sx * 0.05 * math.cos(math.radians(150 - k * 25)), ez + 0.06 * math.sin(math.radians(150 - k * 25)) + 0.006, 0.016) for k in range(6)]
            lid.append(on_head(ex + sx * 0.068, ez + 0.042, 0.014))
            out.append(stroke("Lash", lid, 0.0095, M["ink"], lambda t: 0.45 + 0.75 * t))
        else:
            # a bold, nearly straight upper lid that follows the tilt (inner end lower = sharper look)
            rise = {"sharp": 0.016, "narrow": 0.004, "fierce": 0.026}[style]
            top = hz * 0.95 + 0.004
            lid = [on_head(ex + sx * d, ez + top + rise * (d / 0.05) - (0.006 * (1 - (d / 0.05) ** 2) if style == "narrow" else 0.0), 0.016)
                   for d in (-0.048, -0.02, 0.01, 0.04, 0.055)]
            out.append(stroke("Lash", lid, 0.011 if style != "narrow" else 0.012, M["ink"], lambda t: 0.75 + 0.35 * t))
            if style == "narrow":   # heavy upper lid in skin tone over the top of the eye
                out.append(ico_s("Lid", 1, on_head(ex, ez + hz * 0.6, -0.006), M["skin"], 2, scale=(0.05, 0.022, 0.022), rot=(0.08, tilt, yaw)))
    return _strokes_to_mesh(out, ("Lash",))


def build_brows(M, style, head):
    out = []
    for sx in (-1, 1):
        ex, ez = sx * EYE_X, EYE_Z
        if style == "soft":
            pts = [on_head(ex + sx * d, ez + 0.1 + 0.014 * math.sin((d + 0.04) / 0.09 * math.pi), 0.006) for d in (-0.035, -0.01, 0.015, 0.04)]
            out.append(stroke("Brow", pts, 0.011, M["hair"], lambda t: 1.0 - 0.55 * t))
        elif style == "thick":
            pts = [on_head(ex + sx * d, ez + 0.092 + 0.006 * math.sin((d + 0.045) / 0.1 * math.pi), 0.007) for d in (-0.045, -0.015, 0.015, 0.045)]
            out.append(stroke("Brow", pts, 0.017, M["hair"], lambda t: 1.0 - 0.3 * t))
        elif style == "angry":
            pts = [on_head(ex + sx * d, ez + 0.08 + 0.32 * (d + 0.045) - 0.004 * math.sin((d + 0.045) / 0.09 * math.pi), 0.007) for d in (-0.045, -0.015, 0.015, 0.042)]
            out.append(stroke("Brow", pts, 0.016, M["hair"], lambda t: 1.0 - 0.35 * t))
        elif style == "raised":
            pts = [on_head(ex + sx * d, ez + 0.112 + 0.022 * math.sin((d + 0.04) / 0.085 * math.pi), 0.006) for d in (-0.035, -0.01, 0.015, 0.04)]
            out.append(stroke("Brow", pts, 0.012, M["hair"], lambda t: 1.0 - 0.5 * t))
    out = [shrink_onto(o, head, 0.003) for o in out]
    return _strokes_to_mesh(out, ("Brow",))


def build_mouth(M, style, head):
    out = []
    if style == "smile":
        pts = [on_head(x, -0.118 - 0.012 * (1 - (x / 0.032) ** 2), 0.004) for x in (-0.032, -0.016, 0.0, 0.016, 0.032)]
        out.append(stroke("Mouth", pts, 0.0055, M["mouth"], lambda t: 0.6 + 0.4 * math.sin(t * math.pi)))
    elif style == "neutral":
        pts = [on_head(x, -0.122 + 0.002 * (x / 0.022) ** 2, 0.004) for x in (-0.022, 0.0, 0.022)]
        out.append(stroke("Mouth", pts, 0.0055, M["mouth"]))
    elif style == "smirk":
        pts = [on_head(x, -0.124 + 0.3 * max(0.0, x) ** 1.6 * 8 + 0.0, 0.004) for x in (-0.024, -0.006, 0.012, 0.03)]
        out.append(stroke("Mouth", pts, 0.0055, M["mouth"], lambda t: 0.7 + 0.3 * t))
    elif style == "grin":   # open, cheering mouth with a row of teeth
        out.append(ico_s("Mouth", 1, on_head(0, -0.124, -0.004), M["mouth"], 2, scale=(0.038, 0.012, 0.026)))
        out.append(ico_s("Teeth", 1, on_head(0, -0.108, -0.001), M["teeth"], 2, scale=(0.03, 0.008, 0.008)))
    out = [shrink_onto(o, head, 0.002) if o.type == "CURVE" else o for o in out]
    return _strokes_to_mesh(out, ("Mouth",))


# ---------------------------------------------------------------- base body
def make_arm(M, sx, nm):
    # deltoid, bicep, elbow, forearm bulge, wrist, mitten hand + thumb (sporty, not bulky)
    pts = [((0, 0, 0), 0.076), ((0, -0.004, -0.065), 0.071), ((0, -0.012, -0.125), (0.068, 0.074)), ((0, -0.004, -0.2), 0.053),
           ((0, -0.006, -0.25), 0.058), ((0, 0, -0.345), 0.041), ((0, 0, -0.4), (0.037, 0.055)), ((0, 0, -0.47), (0.033, 0.047)),
           ((-sx * 0.008, -0.036, -0.38), 0.023), ((-sx * 0.012, -0.06, -0.42), 0.018)]
    edges = [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (5, 6), (6, 7), (5, 8), (8, 9)]
    arm = apply_mods(skin_limb("Arm" + nm, pts, edges, None, loc=(sx * SHOULDER[0], SHOULDER[1], SHOULDER[2])))
    me = arm.data
    for m in (M["sleeve"], M["sleeve2"], M["skin"]): me.materials.append(m)
    # zones: upper arm (short sleeve) / forearm (long sleeve) / hand. The game colors them per outfit.
    for p in me.polygons: p.material_index = 0 if p.center.z > -0.15 else (1 if p.center.z > -0.33 else 2)
    smooth(arm)
    for nm2, z0, r in (("CuffShort", -0.135, 0.079), ("Cuff", -0.31, 0.05)):
        c = loft_profile(nm2, [(z0, r, r), (z0 - 0.025, r * 1.02, r * 1.02)], segs=18, mat=M["cuff"], solidify=0.01, subsurf=1)
        c.location = arm.location; apply_mods(c); parent_keep(c, arm)
    hand = _link(bpy.data.objects.new("Hand" + nm, None)); hand.location = (arm.location.x, 0, SHOULDER[2] + HAND_Z)
    parent_keep(hand, arm)
    return arm


def make_leg(M, sx, nm):
    # thigh, knee, calf muscle, ankle
    pts = [((0, 0, 0), 0.094), ((0, -0.006, -0.09), 0.088), ((0, -0.012, -0.17), 0.068), ((0, -0.012, -0.21), 0.06),
           ((0, 0.012, -0.27), 0.068), ((0, 0.006, -0.33), 0.054), ((0, 0, -0.385), 0.046)]
    leg = apply_mods(skin_limb("Leg" + nm, pts, [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (5, 6)], None, loc=(sx * HIP[0], 0, HIP[2])))
    me = leg.data; me.materials.append(M["legs"]); me.materials.append(M["legs2"])
    for p in me.polygons: p.material_index = 0 if p.center.z > -0.19 else 1     # thigh / lower leg
    smooth(leg)
    x = sx * HIP[0]
    sole = loft_profile("Sole", [(0.0, 0.06, 0.135, x, -0.035), (0.03, 0.064, 0.14, x, -0.037)], segs=20, mat=M["sole"],
                        cap_top=True, cap_bottom=True, subsurf=1)
    shoe = loft_profile("Shoe", [(0.024, 0.06, 0.132, x, -0.036), (0.062, 0.064, 0.134, x, -0.04), (0.097, 0.057, 0.108, x, -0.025),
                                 (0.127, 0.049, 0.064, x, -0.002), (0.15, 0.047, 0.052, x, 0.004)],
                        segs=16, mat=M["boot"], subsurf=1, shape=lambda t, a: (1.0 + 0.06 * (1 - t) * max(0, math.cos(a)), 0.0))
    sock = loft_profile("Sock", [(0.14, 0.05, 0.05, x, 0.002), (0.2, 0.05, 0.05, x, 0.0)], segs=14, mat=M["sock"], solidify=0.008, subsurf=1)
    tongue = loft_profile("ShoeTongue", [(0.08, 0.022, 0.03, x, -0.082), (0.12, 0.02, 0.025, x, -0.054), (0.15, 0.016, 0.02, x, -0.047)],
                          segs=10, mat=M["sole"], cap_top=True, subsurf=1)
    laces = [stroke("Lace", [Vector((x - 0.026, -0.1 + i * 0.022, 0.095 + i * 0.012)), Vector((x, -0.108 + i * 0.022, 0.102 + i * 0.012)),
                             Vector((x + 0.026, -0.1 + i * 0.022, 0.095 + i * 0.012))], 0.005, M["sole"]) for i in range(2)]
    for p in (sole, shoe, sock, tongue): apply_mods(p)
    laces = to_mesh(laces, "Laces")
    for p in (sole, shoe, sock, tongue, laces): parent_keep(p, leg)
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
    loft_profile("Neck", [(0.98, 0.068, 0.064), (1.08, 0.064, 0.06), (1.2, 0.072, 0.07)], segs=14, mat=M["skin"], subsurf=1)
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
                           "crew": dict(front=50, side=90, back=122), "middle": dict(front=56, side=96, back=130),
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
    elif style == "middle":
        # curtain bangs: parted in the centre, each side sweeping out to frame the face
        for sg in (-1, 1):
            for ph0, ln in ((5, 0.2), (17, 0.17), (30, 0.14)):
                pts = [sph(10, sg * (ph0 * 0.4 + 2), 0.05), sph(30, sg * (ph0 + 10), 0.1), sph(54, sg * (ph0 + 30), 0.1), sph(76, sg * (ph0 + 46), 0.05)]
                pts.append(pts[-1] + Vector((sg * 0.006, -0.012, -ln * 0.6)))
                fr.append(make_hair_lock("Fringe", pts, 0.05, M["hair"]))
        locks = side_locks(M, ln=0.15, r=0.05, curl_in=0.02, ph=82) + back_layer(M, n=7, end_th=128, hang=0.03, r=0.058, curl=0.015)
    elif style == "crew":
        # short crop: many small flat clumps combed down and back, a textured fringe flicked up
        rnd = random.Random(11)
        for th in (16, 42, 68, 94):
            n = 6 if th < 30 else 9
            for i in range(n):
                ph = -180 + (i + rnd.uniform(0.25, 0.75)) * 360 / n
                aph = abs(ph); lim = 50 + 40 * min(1, aph / 90) if aph < 90 else 90 + 32 * (aph - 90) / 90
                if th + 12 > lim: continue
                pts = [sph(max(2, th - 10), ph, 0.0), sph(th + 6, ph, 0.03), sph(th + 20, ph + rnd.uniform(-6, 6), 0.012)]
                locks.append(make_hair_lock("Crop", pts, 0.05, M["hair"], width=2.3, flat=0.4, curl=0.2))
        for ph in (-30, -11, 8, 27):
            fr.append(make_hair_lock("Fringe", [sph(36, ph, 0.04), sph(48, ph, 0.08), sph(47, ph + 5, 0.17)], 0.042, M["hair"], width=1.5, flat=0.7))
    if fr: parts.append(to_mesh(fr, "Fringe"))
    if locks: parts.append(to_mesh(locks, "Locks"))
    if tufts: parts.append(to_mesh(tufts, "Tuft"))
    return parts


# ---------------------------------------------------------------- outfits
def torso_rings(scale=1.0, z0=0.0, z1=9.0, extra=0.0):
    return [(z, rx * scale + extra, ry * scale + extra) for z, rx, ry in TORSO if z0 <= z <= z1]


def wave_hem(n=5, amp=0.04, dz=0.02, folds=0.02):
    return lambda t, a: (1 + t * t * (amp * math.sin(a * n) + folds * math.sin(a * 11 + 1)), -t ** 3 * dz * math.cos(a * n))


def athletic_shorts(M, o, main="o2", trim="o1"):
    """sports shorts: waist + two leg openings. The leg tubes are named *_LegL / *_LegR so the game parents them to the legs."""
    # sits low on the hips, under the shirt hem (the waistband only shows with tucked / short tops)
    o.append(loft_profile("Shorts", [(0.6, 0.158, 0.12), (0.54, 0.19, 0.145), (0.5, 0.205, 0.155), (0.46, 0.205, 0.155)], segs=28, mat=M[main], subsurf=1))
    o.append(loft_profile("Waistband", [(0.57, 0.168, 0.128), (0.605, 0.162, 0.124)], segs=28, mat=M[trim], solidify=0.012, subsurf=1))
    for sx, nm in ((-1, "R"), (1, "L")):
        x = sx * HIP[0]
        o.append(loft_profile("ShortsLeg_Leg" + nm, [(0.53, 0.112, 0.112, x, 0), (0.42, 0.113, 0.111, x, 0.0), (0.34, 0.119, 0.116, x, 0.004)],
                              segs=18, mat=M[main], solidify=0.012, subsurf=1))
        o.append(loft_profile("ShortsHem_Leg" + nm, [(0.342, 0.12, 0.117, x, 0.004), (0.364, 0.119, 0.116, x, 0.004)], segs=18, mat=M[trim],
                              solidify=0.016, subsurf=1))


def build_outfit(M, kind):
    o = []
    if kind == "cloak":
        o.append(loft_profile("Tunic", torso_rings(1.0) + [(1.075, 0.076, 0.072)], segs=24, mat=M["o2"], subsurf=1))
        o.append(loft_profile("TunicSkirt", [(0.6, 0.155, 0.118), (0.48, 0.19, 0.15), (0.36, 0.22, 0.18)], segs=24, mat=M["o2"],
                              solidify=0.012, shape=wave_hem(6, 0.05, 0.015)))
        o.append(loft_profile("Belt", [(0.6, 0.158, 0.122), (0.64, 0.156, 0.12)], segs=24, mat=M["hatb"], solidify=0.02, subsurf=1))
        o.append(ico_s("Buckle", 1, (0, -0.128, 0.62), M["gold"], 2, scale=(0.03, 0.012, 0.025)))
        # long cape hanging from the shoulders down the back (open at the sides so the arms show)
        cape = [(1.02, 0.22, 0.16, 0, 0.035), (0.9, 0.29, 0.21, 0, 0.055), (0.62, 0.33, 0.26, 0, 0.075), (0.38, 0.36, 0.3, 0, 0.09), (0.16, 0.4, 0.34, 0, 0.11)]
        wav = lambda t, a: (1 + t * t * (0.05 * math.sin(a * 5) + 0.02 * math.sin(a * 13)), -t ** 3 * 0.025 * math.cos(a * 5))
        o.append(loft_profile("Cloak", cape, segs=36, mat=M["o1"], gap=1.95, solidify=0.018, displace=0.01, shape=wav))
        o.append(loft_profile("CloakTrim", [(0.21, 0.384, 0.325, 0, 0.105), (0.16, 0.395, 0.335, 0, 0.11)], segs=36, mat=M["o2"], gap=1.95,
                              solidify=0.024, shape=lambda t, a: (1.012 * (1 + (0.6 + 0.4 * t) * (0.05 * math.sin(a * 5) + 0.02 * math.sin(a * 13))), -(0.6 + 0.4 * t) * 0.025 * math.cos(a * 5))))
        # shoulder capelet: closed at the back, parted at the front, scalloped hem with trim
        cap_rings = [(1.075, 0.092, 0.088, 0, 0.01), (1.03, 0.21, 0.16, 0, 0.012), (0.97, 0.31, 0.205, 0, 0.015), (0.88, 0.355, 0.235, 0, 0.02)]
        scal = lambda t, a: (1 + t * 0.03 * math.sin(a * 8), -t * t * 0.03 * abs(math.sin(a * 4)))
        o.append(loft_profile("Capelet", cap_rings, segs=40, mat=M["o1"], gap=0.22, solidify=0.02, shape=scal, subsurf=1))
        o.append(loft_profile("CapeletTrim", [(0.9, 0.35, 0.232, 0, 0.02), (0.875, 0.36, 0.24, 0, 0.02)], segs=40, mat=M["o2"], gap=0.22, solidify=0.02,
                              shape=lambda t, a: (1.01 * (1 + 0.03 * math.sin(a * 8)), -0.03 * abs(math.sin(a * 4)))))
        # hood down: draped over the upper back, not a ring around the neck
        o.append(loft_profile("HoodDown", [(1.09, 0.13, 0.1, 0, 0.04), (1.04, 0.2, 0.15, 0, 0.09), (0.97, 0.19, 0.16, 0, 0.15),
                                           (0.9, 0.13, 0.12, 0, 0.19), (0.86, 0.04, 0.04, 0, 0.21)],
                              segs=24, mat=M["o1"], gap=2.0, solidify=0.018, subsurf=1))
        o.append(ico_s("Clasp", 1, (0, -0.135, 1.03), M["gold"], 2, scale=(0.038, 0.016, 0.038)))
        o.append(ico_s("ClaspGem", 1, (0, -0.15, 1.03), M["hatb"], 2, scale=(0.017, 0.01, 0.017)))
    elif kind in ("tee", "polo"):
        sr = [(z, rx * 1.06, ry * 1.08) for z, rx, ry in TORSO if 0.52 <= z <= 1.035]
        sr = [(0.44, 0.226, 0.176)] + sr          # untucked: the hem drapes over the shorts
        o.append(loft_profile("Shirt", sr, segs=28, mat=M["o1"], subsurf=1, shape=lambda t, a: (1 + 0.012 * (1 - t) * math.sin(a * 7), 0)))
        if kind == "tee":
            o.append(loft_profile("Neckline", [(1.02, 0.122, 0.098), (1.05, 0.1, 0.084)], segs=24, mat=M["o2"], solidify=0.014, subsurf=1))
            o.append(loft_profile("ChestStripe", [(0.82, 0.21, 0.149), (0.85, 0.214, 0.151)], segs=28, mat=M["o2"], solidify=0.008, subsurf=1))
        else:   # polo: fold-down collar, button placket
            o.append(loft_profile("Collar", [(1.02, 0.125, 0.1, 0, 0.004), (1.075, 0.125, 0.1, 0, 0.008), (1.05, 0.165, 0.14, 0, 0.012)], segs=28,
                                  mat=M["o2"], gap=0.3, solidify=0.012, subsurf=1))
            o.append(loft_profile("Placket", [(0.9, 0.022, 0.006, 0, -0.153), (1.02, 0.022, 0.006, 0, -0.126)], segs=8, mat=M["o2"], cap_top=True, cap_bottom=True, subsurf=0))
            for z, y in ((0.94, -0.162), (0.99, -0.148)):
                o.append(ico_s("Button", 1, (0, y, z), M["o1"], 2, scale=(0.01, 0.006, 0.01)))
        athletic_shorts(M, o)
    elif kind == "tank":
        o.append(loft_profile("Torso", torso_rings(1.0, 0.5) + [(1.075, 0.076, 0.072)], segs=24, mat=M["skin"], subsurf=1))
        tr = [(0.44, 0.224, 0.174)] + [(z, rx * 1.05, ry * 1.08) for z, rx, ry in TORSO if 0.52 <= z <= 0.93]
        o.append(loft_profile("Shirt", tr, segs=28, mat=M["o1"], solidify=0.012, subsurf=1,
                              shape=lambda t, a: (1, -t * 0.05 * max(0, math.cos(a)) ** 3)))     # scoop neck at the front
        o.append(loft_profile("ChestStripe", [(0.76, 0.182, 0.139), (0.8, 0.192, 0.144)], segs=28, mat=M["o2"], solidify=0.008, subsurf=1))
        for sx in (-1, 1):   # wide straps over the shoulders
            o.append(stroke("Strap", [Vector((sx * 0.1, -0.15, 0.9)), Vector((sx * 0.13, -0.1, 1.0)), Vector((sx * 0.14, 0.0, 1.035)),
                                      Vector((sx * 0.13, 0.1, 1.0)), Vector((sx * 0.1, 0.15, 0.9))], 0.03, M["o1"]))
        athletic_shorts(M, o)
    elif kind == "hoodie":
        hr = [(z, rx * 1.1, ry * 1.13) for z, rx, ry in TORSO if 0.46 <= z <= 1.035]
        hr[0] = (0.45, 0.2, 0.16)
        o.append(loft_profile("Hoodie", hr, segs=28, mat=M["o1"], subsurf=1, displace=0.006))
        o.append(loft_profile("HoodieHem", [(0.43, 0.2, 0.16), (0.49, 0.198, 0.158)], segs=32, mat=M["o2"], solidify=0.02, subsurf=1,
                              shape=lambda t, a: (1 + 0.01 * math.sin(a * 32), 0)))
        o.append(loft_profile("Pocket", [(0.52, 0.12, 0.012, 0, -0.163), (0.6, 0.115, 0.012, 0, -0.16), (0.66, 0.095, 0.012, 0, -0.155)], segs=16,
                              mat=M["o1"], cap_top=True, cap_bottom=True, subsurf=1))
        o.append(loft_profile("HoodDown", [(1.09, 0.14, 0.11, 0, 0.045), (1.04, 0.22, 0.16, 0, 0.1), (0.97, 0.21, 0.17, 0, 0.16),
                                           (0.9, 0.14, 0.13, 0, 0.2), (0.86, 0.04, 0.04, 0, 0.22)], segs=24, mat=M["o1"], gap=2.0, solidify=0.018, subsurf=1))
        for sx in (-1, 1):
            o.append(stroke("Drawstring", [Vector((sx * 0.035, -0.13, 1.05)), Vector((sx * 0.04, -0.15, 0.96)), Vector((sx * 0.036, -0.158, 0.88))], 0.007, M["o2"]))
            o.append(ico_s("Aglet", 1, (sx * 0.036, -0.159, 0.87), M["gold"], 1, scale=(0.008, 0.008, 0.013)))
            nm = "L" if sx > 0 else "R"
            o.append(loft_profile("JoggerCuff_Leg" + nm, [(0.13, 0.054, 0.054, sx * HIP[0], 0.002), (0.19, 0.058, 0.058, sx * HIP[0], 0.0)], segs=16,
                                  mat=M["o2"], solidify=0.012, subsurf=1, shape=lambda t, a: (1 + 0.02 * math.sin(a * 16), 0)))
    elif kind == "dress":
        o.append(loft_profile("Bodice", torso_rings(1.04, 0.6) + [(1.075, 0.076, 0.072)], segs=26, mat=M["o1"], subsurf=1))
        o.append(loft_profile("Neckline", [(1.02, 0.125, 0.1), (1.05, 0.102, 0.086)], segs=24, mat=M["o2"], solidify=0.012, subsurf=1))
        o.append(loft_profile("Waistband", [(0.62, 0.17, 0.128), (0.665, 0.166, 0.126)], segs=28, mat=M["o2"], solidify=0.016, subsurf=1))
        pleat = lambda t, a: (1 + t * 0.045 * math.sin(a * 18), -t * t * 0.008 * math.cos(a * 18))
        o.append(loft_profile("Skirt", [(0.64, 0.168, 0.128), (0.54, 0.24, 0.195), (0.42, 0.3, 0.25)], segs=54, mat=M["o1"], solidify=0.012, shape=pleat))
        o.append(loft_profile("SkirtTrim", [(0.42, 0.302, 0.252), (0.445, 0.296, 0.247)], segs=54, mat=M["o2"], solidify=0.016,
                              shape=lambda t, a: (1.01 * (1 + 0.045 * math.sin(a * 18)), 0)))
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


# ---------------------------------------------------------------- accessories (Roblox-style slots)
def bill(name, mat, ang=66, ln=0.17, z=H + 0.075, r=0.322, back=False):
    """curved cap bill: a strip around the front of the head, sticking out and drooping a little"""
    bm = bmesh.new(); nu, nv = 13, 5; grid = []
    for i in range(nu):
        u = i / (nu - 1) * 2 - 1; ph = math.radians(u * ang) + (math.pi if back else 0.0)
        base = Vector((math.sin(ph) * r, -math.cos(ph) * r, z)); d = Vector((math.sin(ph), -math.cos(ph), 0))
        row = []
        for j in range(nv):
            v = j / (nv - 1); L = ln * (1 - 0.45 * u * u)
            row.append(bm.verts.new(base + d * (v * L) + Vector((0, 0, -0.035 * v * v - 0.018 * u * u * v))))
        grid.append(row)
    for i in range(nu - 1):
        for j in range(nv - 1):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    ob = _mesh_obj(name, bm, mat)
    m = ob.modifiers.new("thick", "SOLIDIFY"); m.thickness = 0.016; m.offset = 0
    m = ob.modifiers.new("sub", "SUBSURF"); m.levels = 1
    return ob


def cap_dome(M, name="CapDome", low=0.06, top=0.34):
    return loft_profile(name, [(H + low, 0.322, 0.316, 0, 0.012), (H + 0.16, 0.318, 0.312, 0, 0.012), (H + 0.25, 0.284, 0.278, 0, 0.014),
                               (H + 0.31, 0.205, 0.2, 0, 0.016), (H + top, 0.07, 0.07, 0, 0.018)], segs=32, mat=M["hatm"], cap_top=True, subsurf=1)


def build_hat(M, kind):
    o = []
    top = H + 0.27     # roughly where hats sit over hair
    if kind in ("cap", "backcap"):
        back = kind == "backcap"
        o.append(cap_dome(M))
        o.append(bill("CapBill", M["hatm"], back=back))
        o.append(ico_s("CapButton", 1, (0, 0.018, H + 0.345), M["hatb"], 2, scale=(0.028, 0.028, 0.014)))
        for k in range(6):   # panel seams from the button down to the band
            a = k / 6 * math.tau + 0.52
            o.append(stroke("Seam", [Vector((math.sin(a) * 0.06, 0.018 - math.cos(a) * 0.06, H + 0.338)), Vector((math.sin(a) * 0.22, 0.016 - math.cos(a) * 0.215, H + 0.29)),
                                     Vector((math.sin(a) * 0.318, 0.014 - math.cos(a) * 0.312, H + 0.16))], 0.0045, M["hatb"]))
        o.append(ico_s("CapLogo", 1, (0, 0.012 + (0.318 if back else -0.318), H + 0.19), M["hatb"], 2, scale=(0.045, 0.012, 0.03)))
    elif kind == "visor":
        o.append(loft_profile("VisorBand", [(H + 0.05, 0.322, 0.316, 0, 0.012), (H + 0.12, 0.318, 0.312, 0, 0.012)], segs=32, mat=M["hatm"], solidify=0.016, subsurf=1))
        o.append(bill("VisorBill", M["hatm"], z=H + 0.08, ln=0.19))
        o.append(loft_profile("VisorStripe", [(H + 0.075, 0.326, 0.32, 0, 0.012), (H + 0.095, 0.326, 0.32, 0, 0.012)], segs=32, mat=M["hatb"], solidify=0.01, subsurf=1))
    elif kind == "headband":
        tilt = lambda t, a: (1 + 0.008 * math.sin(a * 40), 0.035 * math.cos(a))      # higher over the forehead, lower at the back
        o.append(loft_profile("Headband", [(H + 0.07, 0.296, 0.284, 0, 0.018), (H + 0.12, 0.29, 0.278, 0, 0.018)], segs=48, mat=M["hatb"], solidify=0.022,
                              subsurf=1, shape=tilt))
        o.append(ico_s("HeadbandLogo", 1, (0, -0.29, H + 0.13), M["hatm"], 2, scale=(0.03, 0.008, 0.018)))
    elif kind == "bandana":
        o.append(loft_profile("Bandana", [(H + 0.05, 0.318, 0.312, 0, 0.014), (H + 0.15, 0.316, 0.31, 0, 0.014), (H + 0.24, 0.28, 0.274, 0, 0.016),
                                          (H + 0.3, 0.18, 0.176, 0, 0.018), (H + 0.315, 0.05, 0.05, 0, 0.02)], segs=32, mat=M["hatb"], cap_top=True, subsurf=1,
                              shape=lambda t, a: (1 + 0.012 * math.sin(a * 9) * (1 - t), 0.03 * math.cos(a) * (1 - t))))
        o.append(ico_s("BandanaKnot", 1, (0, 0.33, H + 0.06), M["hatb"], 2, scale=(0.04, 0.03, 0.035)))
        for sx in (-1, 1):
            o.append(stroke("BandanaTail", [Vector((0, 0.34, H + 0.05)), Vector((sx * 0.04, 0.37, H - 0.04)), Vector((sx * 0.06, 0.38, H - 0.14))], 0.022, M["hatb"],
                            lambda t: 1 - 0.6 * t))
    elif kind == "hood":
        rings = [(H - 0.22, 0.3, 0.28, 0, 0.04), (H - 0.05, 0.33, 0.33, 0, 0.03), (H + 0.12, 0.32, 0.33, 0, 0.03), (H + 0.26, 0.26, 0.28, 0, 0.04),
                 (H + 0.34, 0.14, 0.17, 0, 0.07), (H + 0.37, 0.04, 0.06, 0, 0.1)]
        o.append(loft_profile("HoodUp", rings, segs=32, mat=M["hatm"], gap=0.78, gap_rows={0, 1, 2}, solidify=0.025, subsurf=1,
                              shape=lambda t, a: (1 + 0.015 * math.sin(a * 7) * (1 - t), 0)))
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
    return _finish_group(o, "HatDetails")


def _finish_group(o, details_name):
    curves = [x for x in o if x.type == "CURVE"]
    if curves:
        rest = [x for x in o if x.type != "CURVE"]
        o = rest + [to_mesh(curves, details_name)]
    return o


def build_eyewear(M, kind):
    o = []
    if kind == "glasses":
        for sx in (-1, 1):
            bpy.ops.mesh.primitive_torus_add(major_radius=0.058, minor_radius=0.008, major_segments=28, minor_segments=6,
                                             location=on_head(sx * 0.096, -0.012, 0.03), rotation=(math.pi / 2, 0, sx * 0.25))
            g = bpy.context.object; g.name = "GlassRim"; assign(g, M["ink"]); smooth(g); o.append(g)
            o.append(stroke("Temple", [on_head(sx * 0.15, 0.0, 0.03), Vector((sx * 0.25, -0.12, H + 0.0)), Vector((sx * 0.27, 0.0, H - 0.01))], 0.006, M["ink"]))
        o.append(stroke("Bridge", [on_head(-0.04, 0.0, 0.03), on_head(0, 0.012, 0.032), on_head(0.04, 0.0, 0.03)], 0.006, M["ink"]))
    elif kind == "shades":
        # wraparound sport shades: a curved lens band across the eyes, rimmed on top, arms back to the ears
        sh = loft_profile("Shades", [(H - 0.03, 0.28, 0.268, 0, 0.0), (H + 0.02, 0.283, 0.271, 0, 0.0)], segs=40, mat=M["lens"], gap=1.95, solidify=0.006,
                          subsurf=1, shape=lambda t, a: (1, -0.012 * (1 - t) * max(0, math.cos(a)) ** 8))
        sh.rotation_euler = (0, 0, math.pi); apply_mods(sh); o.append(sh)
        rim = loft_profile("ShadesRim", [(H + 0.018, 0.285, 0.273, 0, 0.0), (H + 0.03, 0.285, 0.273, 0, 0.0)], segs=40, mat=M["hatb"], gap=1.95, solidify=0.01, subsurf=1)
        rim.rotation_euler = (0, 0, math.pi); apply_mods(rim); o.append(rim)
    return _finish_group(o, "EyewearDetails")


def build_neck(M, kind):
    if kind == "scarf":
        return make_scarf(M)
    o = []
    if kind == "towel":
        ring = loft_profile("Towel", [(1.02, 0.135, 0.12, 0, 0.012), (1.06, 0.15, 0.135, 0, 0.014), (1.1, 0.13, 0.118, 0, 0.012)], segs=24, mat=M["towel"],
                            solidify=0.03, subsurf=1, shape=lambda t, a: (1 + 0.03 * math.sin(a * 4), 0.01 * math.sin(a * 2)))
        curves = []
        for sx in (-1, 1):
            cu = bpy.data.curves.new("TowelEnd", "CURVE"); cu.dimensions = "3D"
            sp = cu.splines.new("BEZIER"); sp.bezier_points.add(2)
            for k, bp in enumerate(sp.bezier_points):
                t = k / 2
                bp.co = Vector((sx * (0.09 + 0.01 * t), -0.13 - 0.04 * t, 1.04 - 0.24 * t)); bp.handle_left_type = bp.handle_right_type = "AUTO"
            cu.extrude = 0.05; cu.resolution_u = 6
            ob = _link(bpy.data.objects.new("TowelEnd", cu)); cu.materials.append(M["towel"]); curves.append(ob)
        ends = to_mesh(curves, "TowelEnds")
        m = ends.modifiers.new("thick", "SOLIDIFY"); m.thickness = 0.02
        o = [ring, ends]
    elif kind == "chain":
        pts = [Vector((math.sin(a) * 0.128, -math.cos(a) * 0.118 + 0.01, 1.04 - 0.05 * max(0, math.cos(a)) ** 2)) for a in [i / 12 * math.tau for i in range(13)]]
        o.append(stroke("Chain", pts, 0.008, M["gold"], res=4))
        o.append(ico_s("Pendant", 1, (0, -0.122, 0.975), M["gold"], 2, scale=(0.022, 0.008, 0.028)))
    return _finish_group(o, "NeckDetails")


def build_wrist(M, kind):
    o = []
    for sx, nm in ((-1, "R"), (1, "L")):
        if kind == "band" and nm == "L": continue
        x = sx * SHOULDER[0]
        o.append(loft_profile("Wristband_Arm" + nm, [(SHOULDER[2] - 0.365, 0.048, 0.048, x, 0), (SHOULDER[2] - 0.305, 0.052, 0.052, x, 0)], segs=20,
                              mat=M["hatb"], solidify=0.018, subsurf=1, shape=lambda t, a: (1 + 0.012 * math.sin(a * 24), 0)))
    return o


# ---------------------------------------------------------------- face marks
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
    elif kind == "freckles":
        rnd = random.Random(5)
        for sx in (-1, 1):
            for i in range(7):
                o.append(ico_s("Freckle", 1, on_head(sx * (0.1 + rnd.uniform(0, 0.07)), -0.05 - rnd.uniform(0, 0.035), 0.001), M["freckle"], 1,
                               scale=(0.0055, 0.003, 0.0055)))
    elif kind == "bandaid":
        o.append(ico_s("Bandaid", 1, on_head(0.13, -0.07, -0.002), M["bandaid"], 2, scale=(0.04, 0.008, 0.013), rot=(0, 0.35, 0.45)))
        o.append(ico_s("BandaidPad", 1, on_head(0.13, -0.07, 0.003), M["sole"], 1, scale=(0.012, 0.005, 0.009), rot=(0, 0.35, 0.45)))
    elif kind == "eyeblack":
        for sx in (-1, 1):
            o.append(ico_s("EyeBlack", 1, on_head(sx * 0.1, -0.072, -0.001), M["ink"], 2, scale=(0.032, 0.005, 0.008), rot=(0, sx * -0.1, sx * 0.35)))
    o = _finish_group(o, "FaceDetails")
    for x in o: apply_mods(x)
    return o


EYES = ["round", "sharp", "narrow", "fierce"]
BROWS = ["soft", "thick", "angry", "raised"]
MOUTHS = ["smile", "grin", "neutral", "smirk"]
HAIR_STYLES = ["spiky", "messy", "middle", "crew", "long", "bob", "ponytail", "buns"]
OUTFITS = ["tee", "polo", "tank", "hoodie", "dress", "jacket", "cloak", "gown"]
HATS = ["cap", "backcap", "visor", "headband", "beanie", "bandana", "hood", "ears", "halo", "crown"]
EYEWEAR = ["glasses", "shades"]
NECKWEAR = ["scarf", "towel", "chain"]
WRISTWEAR = ["bands", "band"]
FACES = ["scar", "blush", "freckles", "bandaid", "eyeblack"]


def build_avatar_parts():
    s = new_scene("avatar_parts"); M = avatar_mats()
    head = make_head(M, "TmpHead"); apply_mods(head)
    for k in OUTFITS: group("outfit_" + k, build_outfit(M, k))
    for k in HAIR_STYLES: group("hair_" + k, build_hair(M, k))
    for k in HATS: group("hat_" + k, build_hat(M, k))
    for k in EYEWEAR: group("eyewear_" + k, build_eyewear(M, k))
    for k in NECKWEAR: group("neck_" + k, build_neck(M, k))
    for k in WRISTWEAR: group("wrist_" + k, build_wrist(M, k))
    for k in FACES: group("face_" + k, build_face_option(M, k, head))
    for k in EYES: group("eyes_" + k, [apply_mods(x) for x in build_eyes(M, k, head)])
    for k in BROWS: group("brows_" + k, [apply_mods(x) for x in build_brows(M, k, head)])
    for k in MOUTHS: group("mouth_" + k, [apply_mods(x) for x in build_mouth(M, k, head)])
    bpy.data.objects.remove(head, do_unlink=True)
    finish("avatar_parts", s)


DEFAULT_LOOK = dict(outfit="tee", hair="spiky", hat="none", face="none", eyes="sharp", brows="thick", mouth="smile", eyewear="none", neck="scarf", wrist="none")


def _build_look(M, look, head):
    lk = {**DEFAULT_LOOK, **look}
    build_outfit(M, lk["outfit"]); build_hair(M, lk["hair"])
    build_eyes(M, lk["eyes"], head); build_brows(M, lk["brows"], head); build_mouth(M, lk["mouth"], head)
    if lk["hat"] != "none": build_hat(M, lk["hat"])
    if lk["face"] != "none": build_face_option(M, lk["face"], head)
    if lk["eyewear"] != "none": build_eyewear(M, lk["eyewear"])
    if lk["neck"] != "none": build_neck(M, lk["neck"])
    if lk["wrist"] != "none": build_wrist(M, lk["wrist"])


def _build_body(M):
    head = make_head(M); make_face(M, head)
    loft_profile("Neck", [(0.98, 0.068, 0.064), (1.08, 0.064, 0.06), (1.2, 0.072, 0.07)], segs=14, mat=M["skin"], subsurf=1)
    for sx, nm in ((-1, "R"), (1, "L")): make_arm(M, sx, nm); make_leg(M, sx, nm)
    return head


def preview_grid(looks, name="avatar_preview", gap=1.15):
    """several looks side by side (x offsets) for review shots; looks = [dict(outfit=..., hair=..., hat=..., ...), ...] (not exported)"""
    old = bpy.data.scenes.get(name)
    if old:
        for o in list(old.objects): bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.scenes.remove(old)
    s = new_scene(name); done = set()
    for i, lk in enumerate(looks):
        M = avatar_mats(); head = _build_body(M); _build_look(M, lk, head)
        for o in s.objects:
            if o not in done and o.parent is None: o.location.x += i * gap
        done = set(s.objects)
    for o in s.objects:
        if o.type == "EMPTY": o.empty_display_size = 0.05
    return s


def preview_avatar(name="avatar_preview", **look):
    return preview_grid([look], name=name)
