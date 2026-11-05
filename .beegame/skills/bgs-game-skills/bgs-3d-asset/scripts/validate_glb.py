"""Read GLB metadata, not format conformance. Retained filename for existing callers."""
import argparse
import json
import struct
from pathlib import Path


def inspect_glb(path, budget=None):
    data = path.read_bytes()
    result = {'structural_validation': 'not_run', 'triangles': None,
              'triangle_count_scope': 'Declared mesh definitions; no buffer validation or node-instance count',
              'budget_met': None, 'errors': []}
    errors = result['errors']
    if len(data) < 20:
        errors.append('File too short')
        return result
    magic, version, total = struct.unpack_from('<4sII', data)
    if magic != b'glTF' or version != 2 or total != len(data):
        errors.append('Invalid GLB header/version/length')
        return result
    offset, chunks = 12, []
    while offset < len(data):
        if offset + 8 > len(data):
            errors.append('Truncated chunk header')
            return result
        size, kind = struct.unpack_from('<I4s', data, offset)
        offset += 8
        if size % 4 or offset + size > len(data):
            errors.append('Malformed chunk size')
            return result
        chunks.append((kind, data[offset:offset + size]))
        offset += size
    if not chunks or chunks[0][0] != b'JSON':
        errors.append('Missing JSON first chunk')
        return result
    try:
        obj = json.loads(chunks[0][1].decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        errors.append('Cannot parse glTF JSON')
        return result
    if not isinstance(obj, dict):
        errors.append('glTF JSON must be an object')
        return result
    accessors, meshes = obj.get('accessors', []), obj.get('meshes', [])
    if not isinstance(accessors, list) or not isinstance(meshes, list):
        errors.append('Cannot read mesh/accessor metadata')
        return result
    result['mesh_count'] = len(meshes)
    triangles = 0
    for mesh in meshes:
        primitives = mesh.get('primitives') if isinstance(mesh, dict) else None
        if not isinstance(primitives, list) or not primitives:
            errors.append('Mesh has no readable primitives')
            continue
        for primitive in primitives:
            if not isinstance(primitive, dict):
                errors.append('Cannot read primitive metadata')
                continue
            mode = primitive.get('mode', 4)
            if type(mode) is not int or mode not in range(7):
                errors.append('Unknown primitive mode; triangle count unavailable')
                continue
            if mode < 4:
                continue  # points/lines contain no triangle primitives
            attributes = primitive.get('attributes', {})
            position = attributes.get('POSITION') if isinstance(attributes, dict) else None
            index = primitive.get('indices', position)
            if any(type(value) is not int or not 0 <= value < len(accessors) for value in [position, index]):
                errors.append('Invalid POSITION/index accessor reference')
                continue
            accessor = accessors[index]
            count = accessor.get('count') if isinstance(accessor, dict) else None
            if type(count) is not int or count < 0 or (mode == 4 and count % 3):
                errors.append('Invalid triangle accessor count')
                continue
            triangles += count // 3 if mode == 4 else max(0, count - 2)
    if not errors:
        result['triangles'] = triangles
        result['budget_met'] = triangles <= budget if budget is not None else None
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--max-triangles', type=int)
    parser.add_argument('--json', type=Path)
    args = parser.parse_args()
    if args.json and args.input.resolve() == args.json.resolve():
        parser.error('Input and report paths must differ')
    if args.max_triangles is not None and args.max_triangles <= 0:
        parser.error('Triangle budget must be positive')
    result = inspect_glb(args.input, args.max_triangles)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    raise SystemExit(2 if result['errors'] or result['budget_met'] is False else 0)


if __name__ == '__main__':
    main()
