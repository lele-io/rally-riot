# Rally Riot — procedural model builder. Run inside Blender (via MCP):
#   exec(open(r"C:/games/racket-game/blender/build_models.py").read()); build_all()
# Each model is built in its own scratch scene and exported to public/models/<name>.glb.
# Blender is Z-up / front = -Y; glTF export converts to Y-up / front = +Z.
# Material names matter: the game recolors "Frame", "Accent", "Team" at runtime.
import bpy, math, os
from mathutils import Vector

OUT = r"C:/games/racket-game/public/models"


def mat(name, color, metal=0.0, rough=0.5, emit=0.0, alpha=1.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit > 0:
        b.inputs["Emission Color"].default_value = (*color, 1)
        b.inputs["Emission Strength"].default_value = emit
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        try: m.surface_render_method = "BLENDED"
        except Exception: pass
    return m


def assign(obj, m):
    obj.data.materials.clear(); obj.data.materials.append(m)
    return obj


def shade_smooth(obj):
    for p in obj.data.polygons: p.use_smooth = True


def new_scene(name):
    s = bpy.data.scenes.new(name)
    bpy.context.window.scene = s
    return s


def finish(name, scene):
    # apply all modifiers, export, drop the scratch scene
    for o in list(scene.objects):
        if o.type == "MESH" and o.modifiers:
            bpy.context.view_layer.objects.active = o
            for md in list(o.modifiers):
                bpy.ops.object.modifier_apply(modifier=md.name)
    path = os.path.join(OUT, name + ".glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_active_scene=True,
                              export_apply=True, export_yup=True)
    keep = bpy.data.scenes[0] if bpy.data.scenes[0] != scene else bpy.data.scenes[1]
    for o in list(scene.objects): bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.window.scene = keep
    bpy.data.scenes.remove(scene)
    for blk in (bpy.data.meshes, bpy.data.curves):
        for d in list(blk):
            if d.users == 0: blk.remove(d)
    print("exported", path, os.path.getsize(path), "bytes")


def cyl(r, depth, loc, rot=(0, 0, 0), verts=12, m=None, name="cyl"):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.object; o.name = name
    if m: assign(o, m)
    return o


def box(size, loc, m=None, name="box", rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object; o.name = name; o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if m: assign(o, m)
    return o


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.object; o.name = name
    return o


# ---------------------------------------------------------------- rackets
# Grip butt at origin, handle up +Z, head centre at z=HEAD_Z, string bed in the XZ plane.
HEAD_Z = 0.56


def strings(rx, rz, cz, m):
    parts = []
    n_v, n_h = 9, 11
    for i in range(n_v):
        x = -rx + (i + 1) * 2 * rx / (n_v + 1)
        h = 2 * rz * math.sqrt(max(0, 1 - (x / rx) ** 2)) * 0.96
        parts.append(cyl(0.0016, h, (x, 0, cz), verts=4, m=m, name="s"))
    for i in range(n_h):
        z = -rz + (i + 1) * 2 * rz / (n_h + 1)
        w = 2 * rx * math.sqrt(max(0, 1 - (z / rz) ** 2)) * 0.96
        parts.append(cyl(0.0016, w, (0, 0, cz + z), rot=(0, math.pi / 2, 0), verts=4, m=m, name="s"))
    return join(parts, "Strings")


def racket_base(M, head_segments=32, rx=0.125, rz=0.16):
    handle = cyl(0.017, 0.24, (0, 0, 0.12), verts=8, m=M["Grip"], name="Grip")
    cap = cyl(0.021, 0.02, (0, 0, 0.0), verts=8, m=M["Accent"], name="Cap")
    shaft = cyl(0.0075, 0.17, (0, 0, 0.325), verts=8, m=M["Frame"], name="Shaft")
    gem = None
    bpy.ops.mesh.primitive_ico_sphere_add(radius=0.02, subdivisions=1, location=(0, 0, 0.255))
    gem = bpy.context.object; gem.name = "Gem"; gem.scale = (1, 0.6, 1.4); assign(gem, M["Accent"])
    bpy.ops.mesh.primitive_torus_add(major_radius=1, minor_radius=0.075, major_segments=head_segments,
                                     minor_segments=6, location=(0, 0, HEAD_Z), rotation=(math.pi / 2, 0, 0))
    head = bpy.context.object; head.name = "Head"; head.scale = (rx, rz, rx)
    bpy.ops.object.transform_apply(scale=True)
    assign(head, M["Frame"]); shade_smooth(head)
    st = strings(rx * 0.95, rz * 0.95, HEAD_Z, M["Strings"])
    return [handle, cap, shaft, gem, head, st]


def racket_mats():
    return {
        "Frame": mat("Frame", (0.85, 0.85, 0.9), metal=0.6, rough=0.3),
        "Accent": mat("Accent", (0.2, 0.8, 1.0), emit=2.0, rough=0.2),
        "Grip": mat("Grip", (0.08, 0.08, 0.1), rough=0.9),
        "Strings": mat("Strings", (0.95, 0.95, 0.95), rough=0.6),
    }


def build_racket_round():
    s = new_scene("racket_round"); M = racket_mats()
    racket_base(M)
    finish("racket_round", s)


def build_racket_blade():
    s = new_scene("racket_blade"); M = racket_mats()
    parts = racket_base(M, head_segments=6, rx=0.13, rz=0.17)
    # forward-swept fins on the head
    for sx in (-1, 1):
        bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.03, radius2=0, depth=0.12,
                                        location=(sx * 0.15, 0, HEAD_Z + 0.08), rotation=(0, sx * -0.9, 0))
        f = bpy.context.object; f.scale = (1, 0.25, 1); assign(f, M["Accent"])
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.025, radius2=0, depth=0.1,
                                    location=(0, 0, HEAD_Z + 0.21))
    t = bpy.context.object; t.scale = (1, 0.25, 1); assign(t, M["Accent"])
    finish("racket_blade", s)


def build_racket_wing():
    s = new_scene("racket_wing"); M = racket_mats()
    racket_base(M, rx=0.13, rz=0.165)
    # halo ring + wings
    bpy.ops.mesh.primitive_torus_add(major_radius=0.2, minor_radius=0.006, major_segments=40, minor_segments=4,
                                     location=(0, 0, HEAD_Z), rotation=(math.pi / 2, 0, 0))
    halo = bpy.context.object; halo.name = "Halo"; assign(halo, M["Accent"])
    for sx in (-1, 1):
        feathers = []
        for i in range(4):
            bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.022, radius2=0, depth=0.16 - i * 0.025,
                                            location=(sx * (0.16 + i * 0.015), 0, HEAD_Z - 0.05 + i * 0.045),
                                            rotation=(0, sx * (1.9 - i * 0.25), 0))
            f = bpy.context.object; f.scale = (1, 0.2, 1); assign(f, M["Accent"]); feathers.append(f)
        join(feathers, "Wing")
    finish("racket_wing", s)


# ---------------------------------------------------------------- shuttle
def build_shuttle():
    s = new_scene("shuttle")
    cork = mat("Cork", (0.95, 0.92, 0.85), rough=0.7)
    feather = mat("Feather", (1.0, 1.0, 1.0), rough=0.4, emit=0.4)
    band = mat("Band", (0.9, 0.2, 0.3), rough=0.5)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.014, segments=12, ring_count=6, location=(0, 0, 0))
    c = bpy.context.object; c.name = "Cork"; assign(c, cork); shade_smooth(c)
    cyl(0.014, 0.012, (0, 0, 0.006), verts=12, m=band, name="Band")
    bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=0.012, radius2=0.033, depth=0.058,
                                    location=(0, 0, 0.041), end_fill_type="NOTHING")
    sk = bpy.context.object; sk.name = "Skirt"; assign(sk, feather)
    sol = sk.modifiers.new("sol", "SOLIDIFY"); sol.thickness = 0.0015
    # feather rib lines
    ribs = []
    for i in range(16):
        a = i / 16 * math.tau
        p0 = Vector((math.cos(a) * 0.012, math.sin(a) * 0.012, 0.012))
        p1 = Vector((math.cos(a) * 0.034, math.sin(a) * 0.034, 0.071))
        mid = (p0 + p1) / 2; d = p1 - p0
        o = cyl(0.0009, d.length, mid, verts=3, m=band, name="rib")
        o.rotation_mode = "QUATERNION"; o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d)
        ribs.append(o)
    join(ribs, "Ribs")
    finish("shuttle", s)


# ---------------------------------------------------------------- avatar
def build_avatar():
    s = new_scene("avatar")
    team = mat("Team", (0.2, 0.5, 1.0), rough=0.6)
    skin = mat("Skin", (1.0, 0.8, 0.62), rough=0.6)
    dark = mat("Dark", (0.05, 0.05, 0.07), rough=0.4)
    white = mat("White", (0.97, 0.97, 0.97), rough=0.5)
    shoe = mat("Shoe", (0.95, 0.95, 0.98), rough=0.4)

    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=20, ring_count=12, location=(0, 0, 0.82))
    body = bpy.context.object; body.name = "Body"; body.scale = (0.3, 0.24, 0.42)
    bpy.ops.object.transform_apply(scale=True); assign(body, team); shade_smooth(body)
    # shorts
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=20, ring_count=10, location=(0, 0, 0.58))
    sh = bpy.context.object; sh.name = "Shorts"; sh.scale = (0.29, 0.23, 0.18)
    bpy.ops.object.transform_apply(scale=True); assign(sh, dark); shade_smooth(sh)

    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.23, segments=20, ring_count=12, location=(0, 0, 1.42))
    head = bpy.context.object; head.name = "Head"; assign(head, skin); shade_smooth(head)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.225, minor_radius=0.03, major_segments=24, minor_segments=6,
                                     location=(0, 0, 1.52))
    hb = bpy.context.object; hb.name = "Headband"; assign(hb, team); shade_smooth(hb)
    for sx in (-1, 1):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.035, segments=10, ring_count=6,
                                             location=(sx * 0.08, -0.2, 1.45))
        e = bpy.context.object; e.name = "Eye"; e.scale = (1, 0.6, 1.3); assign(e, dark)
    # legs + shoes
    for sx, nm in ((-1, "R"), (1, "L")):
        cyl(0.07, 0.36, (sx * 0.13, 0, 0.3), verts=10, m=skin, name="Leg" + nm)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=12, ring_count=8, location=(sx * 0.13, -0.04, 0.07))
        f = bpy.context.object; f.name = "Foot" + nm; f.scale = (0.09, 0.15, 0.07)
        bpy.ops.object.transform_apply(scale=True); assign(f, shoe); shade_smooth(f)
    # arms: object origin at the shoulder so the game can rotate them; hand empty at the tip
    for sx, nm in ((-1, "R"), (1, "L")):
        sxp = sx * 0.34
        bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=12, ring_count=8, location=(0, 0, -0.22))
        arm = bpy.context.object; arm.scale = (0.065, 0.065, 0.25)
        bpy.ops.object.transform_apply(scale=True)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.07, segments=10, ring_count=6, location=(0, 0, -0.46))
        hand = bpy.context.object; assign(hand, skin)
        assign(arm, team if False else skin)
        arm = join([arm, hand], "Arm" + nm); shade_smooth(arm)
        arm.location = (sxp, 0, 1.08)
        bpy.ops.object.empty_add(type="PLAIN_AXES", location=(sxp, 0, 1.08 - 0.47))
        h = bpy.context.object; h.name = "Hand" + nm
        h.parent = arm; h.matrix_parent_inverse = arm.matrix_world.inverted()
    finish("avatar", s)


# ---------------------------------------------------------------- court (game: x = length, net at x=0; Blender y = -game z)
COURT_L, COURT_W, NET_H = 18.0, 10.0, 1.55


def build_court():
    s = new_scene("court")
    floor = mat("ArenaFloor", (0.11, 0.1, 0.16), rough=0.8)
    court = mat("CourtFloor", (0.13, 0.42, 0.36), rough=0.55)
    court2 = mat("CourtFloor2", (0.1, 0.3, 0.55), rough=0.55)
    line = mat("Line", (1, 1, 1), emit=0.6)
    post = mat("Post", (0.9, 0.25, 0.3), metal=0.4, rough=0.35)
    netm = mat("Net", (0.95, 0.95, 1.0), emit=0.3)
    wall = mat("Wall", (0.16, 0.14, 0.26), rough=0.85)
    seat = mat("Seats", (0.55, 0.12, 0.3), rough=0.7)
    seat2 = mat("Seats2", (0.12, 0.25, 0.6), rough=0.7)
    lamp = mat("Lamp", (1.0, 0.97, 0.9), emit=6.0)
    neon1 = mat("NeonA", (1.0, 0.2, 0.55), emit=5.0)
    neon2 = mat("NeonB", (0.15, 0.8, 1.0), emit=5.0)

    box((44, 30, 0.2), (0, 0, -0.1), floor, "ArenaFloor")
    L, W = COURT_L, COURT_W
    box((L / 2 + 1, W + 2, 0.02), (-(L / 2 + 1) / 2, 0, 0.01), court, "SideA")
    box((L / 2 + 1, W + 2, 0.02), ((L / 2 + 1) / 2, 0, 0.01), court2, "SideB")
    lw, y = 0.07, 0.025
    lines = [
        box((L, lw, 0.01), (0, W / 2, y)), box((L, lw, 0.01), (0, -W / 2, y)),
        box((lw, W, 0.01), (L / 2, 0, y)), box((lw, W, 0.01), (-L / 2, 0, y)),
        box((lw, W, 0.01), (0, 0, y)),
        box((lw, W, 0.01), (3, 0, y)), box((lw, W, 0.01), (-3, 0, y)),
        box((L / 2 - 3, lw, 0.01), (-(L / 2 + 3) / 2, 0, y)), box((L / 2 - 3, lw, 0.01), ((L / 2 + 3) / 2, 0, y)),
    ]
    for o in lines: assign(o, line)
    join(lines, "Lines")
    # net
    for sy in (-1, 1):
        cyl(0.06, NET_H + 0.05, (0, sy * (W / 2 + 0.3), (NET_H + 0.05) / 2), verts=12, m=post, name="Post")
    strands, top, bot, span = [], NET_H - 0.05, NET_H - 0.8, W + 0.6
    for i in range(int(span / 0.12) + 1):
        strands.append(box((0.012, 0.012, top - bot), (0, -span / 2 + i * 0.12, (top + bot) / 2), netm, "n"))
    for j in range(8):
        strands.append(box((0.012, span, 0.012), (0, 0, bot + j * (top - bot) / 7), netm, "n"))
    join(strands, "Net")
    box((0.05, W + 0.6, 0.07), (0, 0, NET_H - 0.02), netm, "NetTape")
    # walls + stands
    box((44, 0.4, 7), (0, 15, 3.5), wall, "WallN"); box((44, 0.4, 7), (0, -15, 3.5), wall, "WallS")
    box((0.4, 30, 7), (22, 0, 3.5), wall, "WallE"); box((0.4, 30, 7), (-22, 0, 3.5), wall, "WallW")
    for side, sm in ((1, seat), (-1, seat2)):
        for i in range(4):
            box((30, 1.2, 0.5 + i * 0.6), (0, side * (9.5 + i * 1.2), (0.5 + i * 0.6) / 2), sm if i % 2 == 0 else wall, "Stand")
    for sx, nm in ((-1, neon2), (1, neon1)):
        box((0.15, 26, 0.25), (sx * 21.7, 0, 3.0), nm, "NeonStrip")
        box((0.15, 26, 0.12), (sx * 21.7, 0, 5.2), nm, "NeonStrip")
    for i in range(3):
        for j in (-1, 1):
            box((4, 1.2, 0.15), (-8 + i * 8, j * 4, 9), lamp, "Lamp")
    finish("court", s)


# ---------------------------------------------------------------- lobby hub
def build_lobby():
    s = new_scene("lobby")
    stone = mat("Stone", (0.24, 0.22, 0.34), rough=0.8)
    tile = mat("Tile", (0.33, 0.3, 0.46), rough=0.6)
    gold = mat("Gold", (1.0, 0.75, 0.3), metal=0.9, rough=0.25)
    portal = mat("Portal", (0.7, 0.35, 1.0), emit=6.0)
    crystal = mat("Crystal", (0.4, 0.95, 1.0), emit=5.0)
    awning = mat("Awning", (1.0, 0.35, 0.35), rough=0.6)
    awning2 = mat("Awning2", (1, 1, 1), rough=0.6)
    neon = mat("NeonB", (0.15, 0.8, 1.0), emit=5.0)
    banner = mat("Banner", (0.95, 0.3, 0.6), rough=0.7)

    cyl(13, 0.3, (0, 0, -0.15), verts=48, m=stone, name="Plaza")
    cyl(9, 0.05, (0, 0, 0.02), verts=48, m=tile, name="Inner")
    bpy.ops.mesh.primitive_torus_add(major_radius=9, minor_radius=0.06, major_segments=64, minor_segments=4, location=(0, 0, 0.05))
    assign(bpy.context.object, neon)
    # summon altar (game -z = Blender +y)
    ay = 7.0
    for i, r in enumerate((3.2, 2.6, 2.0)):
        cyl(r, 0.3, (0, ay, 0.15 + i * 0.3), verts=8, m=stone if i % 2 == 0 else tile, name="AltarStep")
    bpy.ops.mesh.primitive_torus_add(major_radius=1.8, minor_radius=0.14, major_segments=48, minor_segments=8,
                                     location=(0, ay, 3.2), rotation=(math.pi / 2, 0, 0))
    ring = bpy.context.object; ring.name = "PortalRing"; assign(ring, portal)
    bpy.ops.mesh.primitive_torus_add(major_radius=2.05, minor_radius=0.06, major_segments=48, minor_segments=6,
                                     location=(0, ay, 3.2), rotation=(math.pi / 2, 0, 0))
    assign(bpy.context.object, gold)
    for sx in (-1, 1):
        cyl(0.25, 4.2, (sx * 2.4, ay, 2.1 + 0.6), verts=8, m=gold, name="Pillar")
        bpy.ops.mesh.primitive_ico_sphere_add(radius=0.35, subdivisions=1, location=(sx * 2.4, ay, 5.1))
        assign(bpy.context.object, crystal)
    bpy.ops.mesh.primitive_ico_sphere_add(radius=0.45, subdivisions=0, location=(0, ay, 3.2))
    c = bpy.context.object; c.name = "Crystal"; c.scale = (1, 1, 1.6); assign(c, crystal)
    # shop kiosk (game +x side)
    kx, ky = 7.5, -2
    box((2.6, 1.4, 1.1), (kx, ky, 0.55), tile, "Counter")
    for sx in (-1, 1): cyl(0.07, 2.6, (kx + sx * 1.2, ky, 1.3), verts=6, m=gold, name="KPole")
    for i in range(6):
        box((2.8 / 6, 1.8, 0.08), (kx - 1.4 + (i + 0.5) * 2.8 / 6, ky, 2.65), awning if i % 2 == 0 else awning2, "Stripe")
    # loadout rack (game -x)
    rx, ry = -7.5, -2
    box((0.2, 3, 2.4), (rx, ry, 1.2), tile, "Rack")
    box((0.3, 3.2, 0.12), (rx, ry, 2.45), gold, "RackTop")
    # arena gate (toward camera, game +z = Blender -y)
    for sx in (-1, 1):
        cyl(0.12, 4, (sx * 3, -9.5, 2), verts=6, m=gold, name="BannerPole")
        box((1.2, 0.05, 2.2), (sx * 3 + sx * 0.65, -9.5, 2.6), banner, "Banner")
    finish("lobby", s)


def build_all():
    os.makedirs(OUT, exist_ok=True)
    for f in (build_racket_round, build_racket_blade, build_racket_wing, build_shuttle, build_avatar, build_court, build_lobby):
        f()
