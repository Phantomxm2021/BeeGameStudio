"""Static-prop baseline: import mesh, duplicate, decimate copies, UV if absent, export GLB.

Run from Blender: blender -b --python process_asset.py -- --input in.glb --output out.glb --report out.json --triangles 8000
Does NOT bake PBR, and does not pretend decimation is true retopology.
"""
import argparse
import json
import sys
from pathlib import Path


def parse_args():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument('--input', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--report', required=True)
    p.add_argument('--triangles', type=int, required=True)
    return p.parse_args(args)


def tris(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def main():
    a = parse_args()
    inp = Path(a.input).expanduser().resolve()
    out = Path(a.output).expanduser().resolve()
    report = Path(a.report).expanduser().resolve()
    if not inp.is_file():
        raise FileNotFoundError(inp)
    if a.triangles <= 0:
        raise ValueError('Triangle budget must be positive')
    if len({inp, out, report}) != 3:
        raise ValueError('Input, output and report paths must differ')
    if inp.suffix.lower() not in ('.glb', '.gltf', '.fbx', '.obj'):
        raise ValueError('Supported input: GLB, GLTF, FBX, OBJ')
    import bpy
    if not bpy.app.background:
        raise RuntimeError('Run this utility in a disposable Blender background process')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    suffix = inp.suffix.lower()
    if suffix in ('.glb', '.gltf'):
        bpy.ops.import_scene.gltf(filepath=str(inp))
    elif suffix == '.fbx':
        bpy.ops.import_scene.fbx(filepath=str(inp))
    else:
        bpy.ops.wm.obj_import(filepath=str(inp))
    originals = [ob for ob in bpy.context.scene.objects if ob.type == 'MESH']
    if not originals:
        raise ValueError('No mesh imported')
    total_in = sum(tris(ob) for ob in originals)
    if total_in == 0:
        raise ValueError('All imported meshes are empty')
    # Duplicates retain geometry + material slots; the source file stays unchanged.
    copies = []
    for ob in originals:
        cp = ob.copy()
        cp.data = ob.data.copy()
        bpy.context.collection.objects.link(cp)
        cp.name = ob.name + '_game'
        copies.append(cp)
    for ob in originals:
        bpy.data.objects.remove(ob, do_unlink=True)
    # Keep relative triangle budget across multiple pieces, avoid destroying tiny parts.
    targets = {ob.name: max(12, round(a.triangles * tris(ob) / total_in)) for ob in copies}
    for ob in copies:
        cur = tris(ob)
        target = targets[ob.name]
        if cur > target:
            mod = ob.modifiers.new('BGS_Decimate_Baseline', 'DECIMATE')
            mod.ratio = max(0.001, min(1.0, target / cur))
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.select_all(action='DESELECT')
            ob.select_set(True)
            bpy.ops.object.modifier_apply(modifier=mod.name)
        if len(ob.data.uv_layers) == 0:
            bpy.ops.object.select_all(action='DESELECT')
            ob.select_set(True)
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.uv.smart_project(island_margin=0.02)
            bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    for ob in copies:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = copies[0]
    out.parent.mkdir(parents=True, exist_ok=True)
    report.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB', use_selection=True, export_texcoords=True, export_normals=True, export_materials='EXPORT')
    total_out = sum(tris(ob) for ob in copies)
    result = {
        'status': 'needs_review',
        'input': str(inp), 'output': str(out),
        'blender_version': bpy.app.version_string,
        'triangles_before': total_in, 'triangles_after': total_out,
        'triangle_budget': a.triangles, 'budget_met': total_out <= a.triangles,
        'mesh_count': len(copies),
        'notes': ['Static-prop decimation baseline; not artistic retopology.',
                  'PBR baking not performed; imported materials only.',
                  'UVs created only when missing; inspect quality.',
                  'Requires visual and game-engine import review.']
    }
    report.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
