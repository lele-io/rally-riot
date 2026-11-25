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



# ================================================================ v2 art style
# Painterly/cel look: flat colors, chunky faceted shapes (the game toon-shades + outlines them).
import bmesh, random
from mathutils import Vector


def ico(r, loc, m, sub=1, scale=(1, 1, 1), name="ico"):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=r, subdivisions=sub, location=loc)
    o = bpy.context.object; o.name = name; o.scale = scale
    bpy.ops.object.transform_apply(scale=True); assign(o, m)
    return o


def cone(r1, r2, depth, loc, m, verts=8, rot=(0, 0, 0), name="cone"):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot)
    o = bpy.context.object; o.name = name; assign(o, m)
    return o


def jitter(obj, amt, seed=1, zmin=-1e9):
    """push vertices around a little for a hand-made look"""
    rnd = random.Random(seed)
    for v in obj.data.vertices:
        if v.co.z >= zmin:
            v.co.x += rnd.uniform(-amt, amt); v.co.y += rnd.uniform(-amt, amt); v.co.z += rnd.uniform(-amt, amt) * 0.6


# ---------------------------------------------------------------- avatar: base body + customizable parts
# Lives in avatar.py (skin-modifier limbs, lofted garments, swept hair clumps, face strokes): build_avatar(), build_avatar_parts(),
# preview_avatar(...) / preview_grid([...]) for review shots. (The old primitive version also overwrote the racket HEAD_Z global.)
exec(open(r"C:/games/racket-game/blender/avatar.py", encoding="utf-8").read())


# ---------------------------------------------------------------- shared environment pieces
def env_mats():
    return dict(
        grass=mat("Grass", (0.46, 0.66, 0.34), rough=0.9), grass2=mat("GrassDark", (0.3, 0.5, 0.3), rough=0.9),
        leaf=mat("Leaf", (0.36, 0.6, 0.4), rough=0.8), blossom=mat("Blossom", (0.98, 0.72, 0.78), rough=0.8),
        autumn=mat("Autumn", (0.97, 0.66, 0.36), rough=0.8),
        rock=mat("Rock", (0.6, 0.55, 0.62), rough=0.9), rockdark=mat("RockDark", (0.3, 0.26, 0.38), rough=0.9),
        stone=mat("Stone", (0.86, 0.81, 0.72), rough=0.85), wood=mat("Wood", (0.5, 0.33, 0.22), rough=0.8),
        gold=mat("Gold", (0.95, 0.74, 0.36), metal=0.6, rough=0.3), lantern=mat("Lantern", (1.0, 0.78, 0.45), emit=3.0),
        cloth1=mat("ClothRed", (0.88, 0.32, 0.36), rough=0.8), cloth2=mat("ClothTeal", (0.26, 0.66, 0.68), rough=0.8),
        cream=mat("Cream", (0.97, 0.93, 0.84), rough=0.8),
    )


def island(M, rx, ry, depth=12, seed=3):
    # grass top + jagged rock underside
    top = cyl(1, 0.6, (0, 0, -0.3), verts=40, m=M["grass"], name="IslandTop"); top.scale = (rx, ry, 1)
    bpy.ops.object.transform_apply(scale=True); jitter(top, 0.25, seed, zmin=0.29)
    rim = cyl(1, 1.2, (0, 0, -1.2), verts=40, m=M["rock"], name="IslandRim"); rim.scale = (rx * 0.99, ry * 0.99, 1)
    bpy.ops.object.transform_apply(scale=True); jitter(rim, 0.5, seed + 1)
    und = cone(1, 0.12, depth, (0, 0, -1.8 - depth / 2), M["rockdark"], verts=24, rot=(math.pi, 0, 0), name="Underside")
    und.scale = (rx * 0.95, ry * 0.95, 1); bpy.ops.object.transform_apply(scale=True, rotation=True)
    jitter(und, 1.6, seed + 2)
    return top


def tree(M, x, y, h=4.5, kind="leaf", seed=0, z=0.0):
    rnd = random.Random(seed)
    cyl(0.22, h, (x, y, z + h / 2), verts=7, m=M["wood"], name="Trunk")
    for i in range(3):
        ico(1.4 - i * 0.25 + rnd.uniform(-0.2, 0.2), (x + rnd.uniform(-0.7, 0.7), y + rnd.uniform(-0.7, 0.7), z + h + i * 0.9 - 0.3), M[kind], 1, name="Canopy")


def pillar(M, x, y, h, broken=True, seed=0):
    rnd = random.Random(seed)
    cyl(0.55, 0.3, (x, y, 0.15), verts=8, m=M["stone"], name="PillarBase")
    p = cyl(0.42, h, (x, y, 0.3 + h / 2), verts=8, m=M["stone"], name="Pillar")
    if broken:
        for v in p.data.vertices:
            if v.co.z > 0: v.co.z += rnd.uniform(-0.5, 0.2)
    else:
        box((1.2, 1.2, 0.3), (x, y, 0.45 + h), M["stone"], "Capital")
    return p


def lantern_post(M, x, y):
    cyl(0.07, 1.8, (x, y, 0.9), verts=6, m=M["wood"], name="Post")
    box((0.32, 0.32, 0.4), (x, y, 1.95), M["lantern"], "Lantern")
    cone(0.3, 0, 0.25, (x, y, 2.28), M["wood"], verts=4, rot=(0, 0, math.pi / 4), name="LanternRoof")


def grass_tufts(M, n, rx, ry, keep_out, seed=7):
    rnd = random.Random(seed); parts = []
    for i in range(n):
        a = rnd.uniform(0, math.tau); r = math.sqrt(rnd.uniform(0.05, 0.95))
        x, y = math.cos(a) * r * rx, math.sin(a) * r * ry
        if keep_out(x, y): continue
        for k in range(3):
            parts.append(cone(0.08, 0, rnd.uniform(0.25, 0.45), (x + rnd.uniform(-0.12, 0.12), y + rnd.uniform(-0.12, 0.12), 0.15), M["grass2"], verts=3,
                              rot=(rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), 0), name="tuft"))
    if parts: join(parts, "Tufts")


def flag(M, x, y, cloth, h=5):
    cyl(0.08, h, (x, y, h / 2), verts=6, m=M["wood"], name="FlagPole")
    ico(0.14, (x, y, h + 0.1), M["gold"], 1, name="Finial")
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=6, y_subdivisions=2, size=1, location=(x, y + 0.65, h - 1.3), rotation=(math.pi / 2, 0, math.pi / 2))
    f = bpy.context.object; f.name = "Banner"; f.scale = (1.2, 2.2, 1); bpy.ops.object.transform_apply(scale=True, rotation=True)
    for v in f.data.vertices: v.co.x += math.sin(v.co.y * 3) * 0.12
    assign(f, cloth)


# ---------------------------------------------------------------- court: floating ruins at golden hour
COURT_L, COURT_W, NET_H = 18.0, 10.0, 1.55


def build_court():
    s = new_scene("court"); M = env_mats()
    courtA = mat("CourtA", (0.86, 0.6, 0.44), rough=0.8)
    courtB = mat("CourtB", (0.46, 0.66, 0.66), rough=0.8)
    line = mat("Line", (0.99, 0.96, 0.88), emit=0.25)
    netm = mat("Net", (0.97, 0.94, 0.86), rough=0.7)
    island(M, 30, 20, depth=16)
    L, W = COURT_L, COURT_W
    box((L + 6, W + 6, 0.12), (0, 0, -0.05), M["stone"], "Plaza")
    rnd = random.Random(11); tiles = []
    for i in range(70):  # worn stone tiles around the plaza
        a = rnd.uniform(0, math.tau)
        x, y = math.cos(a) * (L / 2 + 3.6 + rnd.uniform(0, 1.6)), math.sin(a) * (W / 2 + 3.4 + rnd.uniform(0, 1.2))
        tiles.append(box((rnd.uniform(0.6, 1.3), rnd.uniform(0.6, 1.3), 0.08), (x, y, 0.0), M["stone"], "tile", rot=(0, 0, rnd.uniform(0, 1))))
    join(tiles, "Tiles")
    box((L / 2 + 1, W + 2, 0.03), (-(L / 2 + 1) / 2, 0, 0.02), courtA, "SideA")
    box((L / 2 + 1, W + 2, 0.03), ((L / 2 + 1) / 2, 0, 0.02), courtB, "SideB")
    # real badminton markings, scaled from the 13.4 x 6.1 m court to this 18 x 10 m one (the game's in/out uses the outer box)
    lw, y = 0.08, 0.04
    sx, sw = L / 13.4, W / 6.1
    singles = 5.18 / 2 * sw            # singles sideline
    short = 1.98 * sx                  # short service line, from the net
    long_d = L / 2 - 0.76 * sx         # doubles long service line
    hl = lambda x0, x1, yy: box((abs(x1 - x0) + lw, lw, 0.01), ((x0 + x1) / 2, yy, y))   # along the court
    vl = lambda xx, w: box((lw, w + lw, 0.01), (xx, 0, y))                              # across the court
    lines = [hl(-L / 2, L / 2, W / 2), hl(-L / 2, L / 2, -W / 2),          # doubles sidelines
             hl(-L / 2, L / 2, singles), hl(-L / 2, L / 2, -singles),      # singles sidelines
             hl(short, L / 2, 0), hl(-L / 2, -short, 0)]                   # centre lines (short service line -> back)
    for sgn in (-1, 1):
        lines += [vl(sgn * L / 2, W), vl(sgn * short, W), vl(sgn * long_d, W)]  # back boundary, short + long service lines
    for o in lines: assign(o, line)
    join(lines, "Lines")
    for sy in (-1, 1):  # wooden net posts with gold finials
        cyl(0.08, NET_H + 0.1, (0, sy * (W / 2 + 0.3), (NET_H + 0.1) / 2), verts=8, m=M["wood"], name="Post")
        ico(0.13, (0, sy * (W / 2 + 0.3), NET_H + 0.18), M["gold"], 1, name="Finial")
    strands, top, bot, span = [], NET_H - 0.05, NET_H - 0.8, W + 0.6
    for i in range(int(span / 0.14) + 1):
        strands.append(box((0.014, 0.014, top - bot), (0, -span / 2 + i * 0.14, (top + bot) / 2), netm, "n"))
    for j in range(7):
        strands.append(box((0.014, span, 0.014), (0, 0, bot + j * (top - bot) / 6), netm, "n"))
    join(strands, "Net")
    box((0.06, W + 0.6, 0.09), (0, 0, NET_H - 0.02), netm, "NetTape")
    # ruin arches behind each baseline frame the view down the court
    for sx in (-1, 1):
        ax = sx * 25.5
        for sy in (-1, 1): pillar(M, ax, sy * 5.5, 8, broken=False, seed=sx * 3 + sy)
        box((1.4, 12.6, 1.1), (ax, 0, 9.3), M["stone"], "Lintel")
        box((1.0, 13.6, 0.4), (ax, 0, 10.05), M["stone"], "LintelTop")
        ico(0.5, (ax, 0, 9.3), M["gold"], 1, scale=(0.4, 1, 1), name="Emblem")
    # broken colonnade along the sides (outside the play walls at |z| > 15)
    for i, x in enumerate((-20, -13, -6, 6, 13, 20)):
        for sy in (-1, 1):
            pillar(M, x, sy * 16.5, 3.5 + (i * 1.3 % 3), broken=True, seed=i * 7 + sy)
    box((2.6, 0.9, 0.9), (-9, 17.6, 0.35), M["stone"], "Fallen", rot=(0, 0, 0.4))
    box((2.2, 0.9, 0.9), (16, -17.8, 0.35), M["stone"], "Fallen", rot=(0, 0, -0.3))
    for i, (x, y, k) in enumerate(((-23, 15, "blossom"), (-27, 6, "leaf"), (-27, -8, "autumn"), (-21, -16, "leaf"),
                                   (23, 15, "autumn"), (27, 7, "blossom"), (27, -6, "leaf"), (22, -16, "blossom"),
                                   (-3, 18.5, "leaf"), (9, 18.5, "blossom"), (-12, -18.5, "autumn"), (3, -18.5, "leaf"))):
        tree(M, x, y, h=3.8 + (i % 3) * 0.8, kind=k, seed=i)
    for sx in (-1, 1):
        for sy in (-1, 1):
            lantern_post(M, sx * (L / 2 + 2.6), sy * (W / 2 + 2.6))
            flag(M, sx * 15.5, sy * 15.2, M["cloth1"] if sx < 0 else M["cloth2"], h=5.5)
    for i in range(14):
        a = i / 14 * math.tau
        ico(random.Random(i).uniform(0.5, 1.2), (math.cos(a) * 28, math.sin(a) * 18.5, 0.2), M["rock"], 1, scale=(1.3, 1, 0.7), name="Rock")
    grass_tufts(M, 220, 29, 19.5, lambda x, y: abs(x) < L / 2 + 5 and abs(y) < W / 2 + 5)
    finish("court", s)


# ---------------------------------------------------------------- distant backdrop: layered ridge silhouettes + floating islets
def build_backdrop():
    s = new_scene("backdrop"); M = env_mats()
    layers = [(150, mat("Far1", (0.55, 0.52, 0.72)), 28, 1), (200, mat("Far2", (0.7, 0.66, 0.82)), 40, 2), (260, mat("Far3", (0.85, 0.78, 0.86)), 55, 3)]
    for R, m, hmax, seed in layers:
        rnd = random.Random(seed); n = 90; verts, faces = [], []
        for i in range(n + 1):
            a = i / n * math.tau
            h = hmax * (0.35 + 0.65 * abs(math.sin(a * 3 + seed)) * rnd.uniform(0.6, 1.0)) + rnd.uniform(-4, 4)
            verts += [(math.cos(a) * R, math.sin(a) * R, -40), (math.cos(a) * R, math.sin(a) * R, h)]
        for i in range(n):
            a0 = i * 2; faces.append((a0, a0 + 2, a0 + 3, a0 + 1))
        me = bpy.data.meshes.new("ridge"); me.from_pydata(verts, [], faces); me.update()
        o = bpy.data.objects.new("Ridge%d" % seed, me); s.collection.objects.link(o); o.data.materials.append(m)
    rnd = random.Random(5)
    for i in range(9):
        a = i / 9 * math.tau + rnd.uniform(-0.2, 0.2); r = rnd.uniform(55, 95)
        x, y, z = math.cos(a) * r, math.sin(a) * r, rnd.uniform(-6, 22)
        sc = rnd.uniform(2.5, 5)
        t = cyl(sc, 0.8, (x, y, z), verts=12, m=M["grass"], name="IsletTop"); jitter(t, 0.3, i)
        u = cone(sc, 0.2, sc * 2.2, (x, y, z - sc * 1.1 - 0.4), M["rockdark"], verts=10, rot=(math.pi, 0, 0), name="IsletRock"); jitter(u, 0.6, i + 50)
        tree(M, x, y, h=2.5, kind=rnd.choice(["leaf", "blossom", "autumn"]), seed=i + 100, z=z + 0.4)
    finish("backdrop", s)


# ---------------------------------------------------------------- lobby: shrine courtyard (game -z = Blender +y)
def build_lobby():
    s = new_scene("lobby"); M = env_mats()
    portal = mat("Portal", (0.55, 0.9, 1.0), emit=4.0)
    crystal = mat("Crystal", (0.75, 0.95, 1.0), emit=4.0)
    rune = mat("Rune", (1.0, 0.82, 0.45), emit=2.5)
    island(M, 15, 15, depth=12, seed=9)
    cyl(10, 0.12, (0, 0, -0.04), verts=10, m=M["stone"], name="Plaza")
    bpy.ops.mesh.primitive_torus_add(major_radius=10, minor_radius=0.07, major_segments=40, minor_segments=4, location=(0, 0, 0.03))
    assign(bpy.context.object, M["gold"])
    for i in range(8):
        a = i / 8 * math.tau
        box((0.5, 0.18, 0.04), (math.cos(a) * 3.2, math.sin(a) * 3.2, 0.03), rune, "Rune", rot=(0, 0, a))
    ay = 7.0  # resonance shrine (summon altar)
    for i, r in enumerate((3.3, 2.7, 2.1)):
        cyl(r, 0.3, (0, ay, 0.15 + i * 0.3), verts=8, m=M["stone"], name="AltarStep")
    bpy.ops.mesh.primitive_torus_add(major_radius=1.8, minor_radius=0.16, major_segments=8, minor_segments=4,
                                     location=(0, ay, 3.2), rotation=(math.pi / 2, 0, math.pi / 8))
    ring = bpy.context.object; ring.name = "PortalRing"; assign(ring, M["stone"])
    bpy.ops.mesh.primitive_torus_add(major_radius=1.55, minor_radius=0.05, major_segments=48, minor_segments=6,
                                     location=(0, ay, 3.2), rotation=(math.pi / 2, 0, 0))
    pr = bpy.context.object; pr.name = "PortalGlow"; assign(pr, portal)
    for sx in (-1, 1):
        pillar(M, sx * 2.6, ay, 4.4, broken=False, seed=sx)
        cone(0.35, 0, 0.9, (sx * 2.6, ay, 5.5), M["gold"], verts=4, name="Spire")
    ico(0.45, (0, ay, 3.2), crystal, 0, scale=(1, 1, 1.7), name="Crystal")
    kx, ky = 7.5, -2  # market stall (shop, game +x)
    box((2.8, 1.4, 1.0), (kx, ky, 0.5), M["wood"], "Counter")
    box((3.0, 1.6, 0.1), (kx, ky, 1.05), M["cream"], "CounterTop")
    for sx in (-1, 1):
        for sy in (-1, 1): cyl(0.07, 2.7, (kx + sx * 1.35, ky + sy * 0.7, 1.35), verts=6, m=M["wood"], name="StallPost")
    for i in range(6):
        box((3.2 / 6, 2.0, 0.08), (kx - 1.6 + (i + 0.5) * 3.2 / 6, ky, 2.75), M["cloth1"] if i % 2 == 0 else M["cream"], "Stripe", rot=(0.25, 0, 0))
    for i in range(3): ico(0.18, (kx - 0.8 + i * 0.8, ky - 0.2, 1.3), [M["lantern"], M["gold"], M["cloth2"]][i], 1, name="Goods")
    rx, ry = -7.5, -2  # racket rack (loadout, game -x)
    for sy in (-1, 1): cyl(0.1, 2.6, (rx, ry + sy * 1.4, 1.3), verts=6, m=M["wood"], name="RackPost")
    box((0.16, 3.2, 0.14), (rx, ry, 2.5), M["wood"], "RackBar")
    box((0.16, 3.2, 0.14), (rx, ry, 1.2), M["wood"], "RackBar")
    for i in range(4):
        y = ry - 1.05 + i * 0.7
        bpy.ops.mesh.primitive_torus_add(major_radius=0.22, minor_radius=0.03, major_segments=16, minor_segments=4,
                                         location=(rx + 0.12, y, 2.0), rotation=(0, math.pi / 2, 0))
        o = bpy.context.object; o.scale = (1, 1, 1.3); assign(o, [M["cloth1"], M["gold"], M["cloth2"], M["cream"]][i])
        cyl(0.025, 0.45, (rx + 0.12, y, 1.55), verts=5, m=M["wood"], name="RackHandle")
    gy = -9.6  # gate to the arena (game +z = Blender -y)
    for sx in (-1, 1): cyl(0.22, 5, (sx * 2.6, gy, 2.5), verts=8, m=M["cloth1"], name="GatePost")
    box((7.4, 0.5, 0.45), (0, gy, 5.0), M["cloth1"], "GateBeam")
    box((8.4, 0.6, 0.3), (0, gy, 5.45), M["rockdark"], "GateTop")
    box((6, 0.3, 0.25), (0, gy, 4.2), M["cloth1"], "GateTie")
    box((1.2, 0.12, 0.7), (0, gy - 0.2, 4.6), M["gold"], "GatePlaque")
    for i, (x, y, k) in enumerate(((-11, 6, "blossom"), (11, 6, "autumn"), (-12, -6, "leaf"), (12, -6, "blossom"), (-6, 11.5, "leaf"), (6, 11.5, "autumn"))):
        tree(M, x, y, h=3.6 + (i % 2) * 0.8, kind=k, seed=i + 20)
    for a in range(8):
        ang = a / 8 * math.tau + math.pi / 8
        lantern_post(M, math.cos(ang) * 9.3, math.sin(ang) * 9.3)
    flag(M, -4.5, -10, M["cloth2"], 5); flag(M, 4.5, -10, M["cloth2"], 5)
    grass_tufts(M, 160, 14.5, 14.5, lambda x, y: math.hypot(x, y) < 10.3, seed=3)
    finish("lobby", s)


# the title-screen island lives in lobby.py (overrides build_lobby above)
exec(open(r"C:/games/racket-game/blender/lobby.py", encoding="utf-8").read())


def build_all():
    os.makedirs(OUT, exist_ok=True)
    for f in (build_racket_round, build_racket_blade, build_racket_wing, build_shuttle, build_avatar, build_avatar_parts, build_court, build_backdrop, build_lobby):
        f()
