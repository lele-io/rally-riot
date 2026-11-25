# Rally Riot — rigged anime-proportion character (v4). Exec'd by build_models.py after avatar.py.
#   build_avatar_rig()  -> public/models/avatar.glb : armature "Rig" + skinned body + EVERY part variant, all skinned to it.
#   preview_rig(look)   -> scene "rig_preview" with one look (parts filtered) for review shots.
# Proportions: anime gacha (~6 heads, 1.8 m with hair). One smooth body from a Skin-modifier graph of the whole skeleton
# (pelvis, waist, chest, shoulders, arms with elbows + mitten hands, legs with knees), auto-weighted to the bones.
# Parts are the v3 builders (avatar.py) re-proportioned with two warps instead of rebuilt by hand:
#   head warp     hair, face, hats, eyewear  -> scaled about the head centre onto the new oval head, weighted 100% to Head
#   garment warp  outfits, scarf/towel/chain  -> heights remapped landmark-to-landmark (ankle, knee, hip, waist, chest,
#                 shoulder, neck), widths narrowed; weights copied from the body (Data Transfer), so sleeves/shorts follow
#                 the joints. Skirts, capes and gowns hang from Hips only (they don't tear when the legs move).
# Object names: "<slot>_<id>__<piece>" (e.g. outfit_tee__Shirt, hair_middle__Fringe), base pieces "base__*".
# The game clones the rig (SkeletonUtils), keeps the chosen slots and drives the bones (anim.js).
import bpy, bmesh, math
from mathutils import Vector

RIG_H = 1.64                                  # new head centre
HEAD_F, HEAD_XY = 0.52, (0.82, 0.88)          # head warp: uniform scale, then extra x / y narrowing (oval anime head)
OLD_HEAD = Vector((0, 0, 1.38))               # chibi head centre (avatar.py H)
# garment warp: chibi height -> anime height (piecewise linear between body landmarks)
ZMAP = [(-1.0, -1.0), (0.0, 0.0), (0.13, 0.12), (0.29, 0.5), (0.5, 0.92), (0.62, 1.12), (0.84, 1.3), (0.99, 1.42), (1.075, 1.5), (1.25, 1.62)]
SX_TORSO, SX_LEGS = 0.72, 0.82                # width scale for torso / leg regions (lerped by height)
HIP_X = 0.086                                 # leg sockets (= chibi 0.105 * SX_LEGS so warped shorts legs line up)

# body skeleton graph: name -> (position, (rx, ry)); edges below. x mirrored for L (+x) / R (-x)
def _body_points():
    P = {"pelvis": ((0, 0, 0.95), (0.148, 0.1)), "waist": ((0, 0.004, 1.12), (0.112, 0.082)), "chest": ((0, 0, 1.28), (0.156, 0.104)),
         "upchest": ((0, 0.004, 1.38), (0.148, 0.092)), "neck0": ((0, 0.008, 1.46), (0.048, 0.046)), "neck1": ((0, 0.012, 1.55), (0.042, 0.042))}
    for s, n in ((1, "L"), (-1, "R")):
        P.update({
            "sh" + n: ((s * 0.172, 0.004, 1.405), (0.06, 0.06)), "bic" + n: ((s * 0.2, -0.002, 1.28), (0.055, 0.058)),
            "elb" + n: ((s * 0.208, 0.006, 1.15), (0.039, 0.039)), "fore" + n: ((s * 0.214, 0.0, 1.07), (0.046, 0.046)),
            "wri" + n: ((s * 0.22, 0.0, 0.925), (0.03, 0.03)), "palm" + n: ((s * 0.222, -0.004, 0.875), (0.021, 0.036)),
            "fing" + n: ((s * 0.223, -0.008, 0.81), (0.019, 0.032)), "thb" + n: ((s * 0.21, -0.03, 0.89), (0.014, 0.014)),
            "tht" + n: ((s * 0.205, -0.046, 0.86), (0.011, 0.011)),
            "hip" + n: ((s * HIP_X, 0.0, 0.9), (0.084, 0.084)), "thigh" + n: ((s * (HIP_X + 0.004), -0.006, 0.72), (0.08, 0.08)),
            "knee" + n: ((s * (HIP_X + 0.006), -0.012, 0.5), (0.05, 0.05)), "calf" + n: ((s * (HIP_X + 0.006), 0.014, 0.36), (0.06, 0.06)),
            "ank" + n: ((s * (HIP_X + 0.006), 0.0, 0.11), (0.036, 0.036)),
        })
    E = [("pelvis", "waist"), ("waist", "chest"), ("chest", "upchest"), ("upchest", "neck0"), ("neck0", "neck1")]
    for n in "LR":
        E += [("upchest", "sh" + n), ("sh" + n, "bic" + n), ("bic" + n, "elb" + n), ("elb" + n, "fore" + n), ("fore" + n, "wri" + n),
              ("wri" + n, "palm" + n), ("palm" + n, "fing" + n), ("wri" + n, "thb" + n), ("thb" + n, "tht" + n),
              ("pelvis", "hip" + n), ("hip" + n, "thigh" + n), ("thigh" + n, "knee" + n), ("knee" + n, "calf" + n), ("calf" + n, "ank" + n)]
    return P, E


def _bones():
    B = {"Hips": ((0, 0, 0.9), (0, 0, 1.05), None), "Spine": ((0, 0, 1.05), (0, 0, 1.22), "Hips"), "Chest": ((0, 0, 1.22), (0, 0, 1.42), "Spine"),
         "Neck": ((0, 0.008, 1.44), (0, 0.012, 1.55), "Chest"), "Head": ((0, 0.012, 1.55), (0, 0.012, 1.8), "Neck")}
    for s, n in ((1, "L"), (-1, "R")):
        B["Arm" + n] = ((s * 0.17, 0.004, 1.405), (s * 0.208, 0.006, 1.15), "Chest")
        B["Forearm" + n] = ((s * 0.208, 0.006, 1.15), (s * 0.22, 0.0, 0.925), "Arm" + n)
        B["Hand" + n] = ((s * 0.22, 0.0, 0.925), (s * 0.223, -0.008, 0.8), "Forearm" + n)
        B["Leg" + n] = ((s * HIP_X, 0.0, 0.9), (s * (HIP_X + 0.006), -0.012, 0.5), "Hips")
        B["Shin" + n] = ((s * (HIP_X + 0.006), -0.012, 0.5), (s * (HIP_X + 0.006), 0.0, 0.11), "Leg" + n)
        B["Foot" + n] = ((s * (HIP_X + 0.006), 0.0, 0.11), (s * (HIP_X + 0.006), -0.13, 0.03), "Shin" + n)
    return B


def make_rig():
    arm = bpy.data.armatures.new("Rig"); rig = _link(bpy.data.objects.new("Rig", arm))
    bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode="EDIT")
    B = _bones()
    for name, (h, t, _) in B.items():
        b = arm.edit_bones.new(name); b.head = h; b.tail = t; b.roll = 0.0
    for name, (_, _, par) in B.items():
        if par: arm.edit_bones[name].parent = arm.edit_bones[par]
        if name.startswith(("Forearm", "Hand", "Shin", "Foot", "Neck", "Head", "Spine", "Chest")) and par: arm.edit_bones[name].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def rig_bind(ob, rig, auto=False, group=None):
    """skin `ob` to the rig: auto (heat) weights, or 100% to one bone"""
    if group:
        vg = ob.vertex_groups.get(group) or ob.vertex_groups.new(name=group)
        vg.add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")
    bpy.context.view_layer.update()
    mw = ob.matrix_world.copy()
    if auto:
        bpy.ops.object.select_all(action="DESELECT"); ob.select_set(True); rig.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")
        bpy.ops.object.select_all(action="DESELECT")
    else:
        ob.parent = rig; ob.matrix_world = mw
        m = ob.modifiers.new("rig", "ARMATURE"); m.object = rig
    return ob


def copy_weights(ob, body, rig):
    """garment: copy bone weights from the body (nearest surface, interpolated), then skin"""
    for bname in rig.data.bones.keys():
        if not ob.vertex_groups.get(bname): ob.vertex_groups.new(name=bname)
    m = ob.modifiers.new("wt", "DATA_TRANSFER"); m.object = body; m.use_vert_data = True
    m.data_types_verts = {"VGROUP_WEIGHTS"}; m.vert_mapping = "POLYINTERP_NEAREST"
    m.layers_vgroup_select_src = "ALL"; m.layers_vgroup_select_dst = "NAME"
    apply_mods(ob)
    return rig_bind(ob, rig)


def _zmap(z):
    for (z0, w0), (z1, w1) in zip(ZMAP, ZMAP[1:]):
        if z <= z1: return w0 + (w1 - w0) * (z - z0) / (z1 - z0)
    z0, w0 = ZMAP[-1]; return w0 + (z - z0)


def warp(ob, kind):
    """bake modifiers, then move every vertex into the new proportions (see header)"""
    if ob.type == "CURVE": ob = to_mesh([ob], ob.name)
    if ob.type != "MESH": return ob
    bpy.context.view_layer.update()
    apply_mods(ob)
    mw = ob.matrix_world.copy(); me = ob.data
    me.transform(mw); ob.matrix_world = ob.matrix_world.__class__.Identity(4)
    if ob.parent: ob.parent = None
    for v in me.vertices:
        p = v.co
        if kind == "head":
            d = (p - OLD_HEAD) * HEAD_F
            v.co = Vector((d.x * HEAD_XY[0], d.y * HEAD_XY[1], d.z)) + Vector((0, 0, RIG_H))
        else:
            t = max(0.0, min(1.0, (p.z - 0.42) / 0.16))          # 0 = leg region, 1 = torso region
            sx = SX_LEGS + (SX_TORSO - SX_LEGS) * t
            v.co = Vector((p.x * sx, p.y * (sx * 0.98), _zmap(p.z)))
    me.update()
    return ob


def _name_all(objs, prefix):
    out = []
    for o in objs:
        if o.type == "CURVE": o = to_mesh([o], o.name)
        if o.type != "MESH": continue
        base = o.name.split(".")[0]
        o.name = f"{prefix}__{base}"; o.data.name = o.name
        out.append(o)
    return out


def _gather(fn):
    """run a v3 builder, return every new mesh/curve object it left in the scene (incl. children)"""
    before = set(bpy.context.scene.objects)
    res = fn()
    new = [o for o in bpy.context.scene.objects if o not in before and o.type in ("MESH", "CURVE")]
    for o in [o for o in bpy.context.scene.objects if o not in before and o.type == "EMPTY"]:
        bpy.data.objects.remove(o, do_unlink=True)
    return new


# ---------------------------------------------------------------- new body
def make_body(M):
    P, E = _body_points()
    names = list(P.keys()); idx = {n: i for i, n in enumerate(names)}
    me = bpy.data.meshes.new("Body"); me.from_pydata([P[n][0] for n in names], [(idx[a], idx[b]) for a, b in E], [])
    ob = _link(bpy.data.objects.new("Body", me))
    sk = ob.modifiers.new("skin", "SKIN"); sk.use_smooth_shade = True; sk.branch_smoothing = 0.8
    for n, i in idx.items(): me.skin_vertices[0].data[i].radius = P[n][1]
    me.skin_vertices[0].data[idx["pelvis"]].use_root = True
    s = ob.modifiers.new("sub", "SUBSURF"); s.levels = 2
    apply_mods(ob); smooth(ob)
    # material zones (colored per outfit by the game): upper arm, forearm, thigh, shin; the rest is skin
    under = mat("Undershirt", (0.94, 0.9, 0.8), rough=0.8)   # torso under the clothes: outfit colored, so stretched cloth never shows skin
    for m in (M["skin"], M["sleeve"], M["sleeve2"], M["legs"], M["legs2"], under): ob.data.materials.append(m)
    for p in ob.data.polygons:
        c = p.center
        if abs(c.x) > 0.165 and 0.85 < c.z < 1.43: p.material_index = 1 if c.z > 1.17 else (2 if c.z > 0.94 else 0)
        elif c.z < 0.9 and abs(c.x) < 0.2: p.material_index = 3 if c.z > 0.52 else (4 if c.z > 0.15 else 0)
        elif 0.98 < c.z < 1.44: p.material_index = 5
    return ob


def make_head_kit(M):
    """the v3 head, ears and nose, warped onto the anime head"""
    objs = _gather(lambda: (lambda h: make_face(M, h))(make_head(M)))
    out = []
    for o in objs:
        o = warp(o, "head")
        if o.name.startswith("Head"):   # anime face: slightly longer, softer pointed chin
            for v in o.data.vertices:
                rz = v.co.z - RIG_H
                if rz < -0.03 and v.co.y < 0.02: v.co.x *= 1 - 0.18 * min(1, (-0.03 - rz) / 0.1)
                if rz < 0: v.co.z = RIG_H + rz * 1.06
        out.append(o)
    return out


def make_shoes(M, rig):
    out = []
    for s, n in ((1, "L"), (-1, "R")):
        x = s * (HIP_X + 0.006)
        parts = [loft_profile("Sole", [(0.0, 0.045, 0.115, x, -0.035), (0.022, 0.048, 0.118, x, -0.036)], segs=18, mat=M["sole"], cap_top=True, cap_bottom=True, subsurf=1),
                 loft_profile("Shoe", [(0.018, 0.045, 0.112, x, -0.035), (0.05, 0.048, 0.114, x, -0.038), (0.08, 0.042, 0.09, x, -0.024),
                                       (0.105, 0.037, 0.055, x, -0.004), (0.125, 0.036, 0.044, x, 0.002)], segs=16, mat=M["boot"], subsurf=1,
                              shape=lambda t, a: (1.0 + 0.06 * (1 - t) * max(0, math.cos(a)), 0.0)),
                 loft_profile("ShoeTongue", [(0.065, 0.017, 0.024, x, -0.07), (0.1, 0.016, 0.02, x, -0.046), (0.125, 0.013, 0.016, x, -0.04)], segs=10, mat=M["sole"], cap_top=True, subsurf=1)]
        laces = to_mesh([stroke("Lace", [Vector((x - 0.02, -0.085 + i * 0.018, 0.078 + i * 0.01)), Vector((x, -0.092 + i * 0.018, 0.084 + i * 0.01)),
                                          Vector((x + 0.02, -0.085 + i * 0.018, 0.078 + i * 0.01))], 0.004, M["sole"]) for i in range(2)], "Laces")
        parts.append(laces)
        for p in parts:
            apply_mods(p); p.name = f"base__{p.name.split('.')[0]}{n}"
            out.append(rig_bind(p, rig, group="Foot" + n))
        sock = loft_profile("Sock", [(0.11, 0.04, 0.04, x, 0.002), (0.17, 0.041, 0.041, x, 0.002)], segs=14, mat=M["sock"], solidify=0.006, subsurf=1)
        apply_mods(sock); sock.name = "base__Sock" + n; out.append(rig_bind(sock, rig, group="Shin" + n))
        for nm, z0, r, bone in (("CuffShort", 1.2, 0.058, "Arm"), ("Cuff", 0.965, 0.043, "Forearm")):
            xx = s * (0.205 if bone == "Arm" else 0.217)
            c = loft_profile(nm, [(z0, r, r, xx, 0.004), (z0 - 0.022, r * 1.02, r * 1.02, xx, 0.004)], segs=16, mat=M["cuff"], solidify=0.008, subsurf=1)
            apply_mods(c); c.name = f"base__{nm}{n}"; out.append(rig_bind(c, rig, group=bone + n))
    return out


HANGS_FROM_HIPS = ("Skirt", "Gown", "Cloak", "TunicSkirt", "HoodDown")


def build_avatar_rig(export=True, only=None, name="avatar"):
    s = new_scene(name if export else "rig_preview"); M = avatar_mats()
    rig = make_rig()
    body = make_body(M); body.name = "base__Body"
    rig_bind(body, rig, auto=True)
    for o in make_head_kit(M):
        o.name = "base__" + o.name.split(".")[0]; rig_bind(o, rig, group="Head")
    make_shoes(M, rig)
    old_head = make_head(M, "TmpHead"); apply_mods(old_head)        # shrinkwrap target for the v3 face builders
    lists = {"outfit": OUTFITS, "hair": HAIR_STYLES, "hat": HATS, "eyewear": EYEWEAR, "neck": NECKWEAR, "face": FACES, "eyes": EYES, "brows": BROWS, "mouth": MOUTHS}
    builders = {"outfit": lambda k: build_outfit(M, k), "hair": lambda k: build_hair(M, k), "hat": lambda k: build_hat(M, k),
                "eyewear": lambda k: build_eyewear(M, k), "neck": lambda k: build_neck(M, k), "face": lambda k: build_face_option(M, k, old_head),
                "eyes": lambda k: build_eyes(M, k, old_head), "brows": lambda k: build_brows(M, k, old_head), "mouth": lambda k: build_mouth(M, k, old_head)}
    head_slots = {"hair", "hat", "eyewear", "face", "eyes", "brows", "mouth"}
    for slot, ids in lists.items():
        for k in ids:
            if only and only.get(slot) != k: continue
            objs = _gather(lambda: builders[slot](k))
            objs = [warp(o, "head" if slot in head_slots else "garment") for o in objs]
            for o in _name_all(objs, f"{slot}_{k}"):
                if slot in head_slots: rig_bind(o, rig, group="Head")
                elif any(t in o.name for t in HANGS_FROM_HIPS) or (slot == "outfit" and k in ("gown", "cloak") and "Trim" in o.name): rig_bind(o, rig, group="Hips")
                elif slot == "neck": rig_bind(o, rig, group="Chest")
                else: copy_weights(o, body, rig)
    # wristbands: rigid on the forearms
    for k in WRISTWEAR:
        if only and only.get("wrist") != k: continue
        for s_, n in ((1, "L"), (-1, "R")):
            if k == "band" and n == "L": continue
            c = loft_profile("Wristband", [(0.925, 0.036, 0.036, s_ * 0.219, 0), (0.975, 0.04, 0.04, s_ * 0.218, 0)], segs=18, mat=M["hatb"], solidify=0.012, subsurf=1,
                             shape=lambda t, a: (1 + 0.012 * math.sin(a * 24), 0))
            apply_mods(c); c.name = f"wrist_{k}__Band{n}"; rig_bind(c, rig, group="Forearm" + n)
    bpy.data.objects.remove(old_head, do_unlink=True)
    for o in list(s.objects):
        if o.type == "EMPTY": bpy.data.objects.remove(o, do_unlink=True)
    if export: finish_rig(name, s)
    return s


def finish_rig(name, scene):
    # bake every modifier except the armature, export with skins, drop the scratch scene
    for o in list(scene.objects):
        if o.type == "MESH":
            bpy.context.view_layer.objects.active = o
            for md in list(o.modifiers):
                if md.type != "ARMATURE": bpy.ops.object.modifier_apply(modifier=md.name)
    path = os.path.join(OUT, name + ".glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_active_scene=True, export_apply=False, export_yup=True,
                              export_skins=True, export_animations=False, export_def_bones=False)
    keep = bpy.data.scenes[0] if bpy.data.scenes[0] != scene else bpy.data.scenes[1]
    for o in list(scene.objects): bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.window.scene = keep
    bpy.data.scenes.remove(scene)
    for blk in (bpy.data.meshes, bpy.data.curves, bpy.data.armatures):
        for d in list(blk):
            if d.users == 0: blk.remove(d)
    print("exported", path, os.path.getsize(path), "bytes")


def preview_rig(**look):
    """one look in scene 'rig_preview' (not exported). look keys: outfit hair hat eyewear neck face eyes brows mouth wrist"""
    old = bpy.data.scenes.get("rig_preview")
    if old:
        for o in list(old.objects): bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.scenes.remove(old)
    d = dict(outfit="tee", hair="spiky", eyes="sharp", brows="thick", mouth="smile")
    d.update(look)
    return build_avatar_rig(export=False, only=d)
