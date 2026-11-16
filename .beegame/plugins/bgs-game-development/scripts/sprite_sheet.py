"""Measure alpha-connected candidates or crop explicitly named PNG rectangles.

Pillow is needed only when processing images; --help needs only Python.
No BGS service, generation, semantic segmentation, recentering or overwrite.
"""
import argparse
import hashlib
import io
import json
import re
import struct
from pathlib import Path

MAX_PIXELS = 64 * 1024 * 1024
MAX_RUNS = 1_000_000  # Bound label storage for highly fragmented external images.


def alpha_regions(alpha, width, height, threshold, min_pixels):
    """Eight-connected components using horizontal runs; right/bottom are exclusive."""
    if not (0 <= threshold <= 254 and min_pixels >= 1):
        raise ValueError('alpha threshold must be 0..254 and min pixels must be positive')
    if width <= 0 or height <= 0 or len(alpha) != width * height:
        raise ValueError('alpha length must match positive image dimensions')
    parents, bounds, previous = [], [], []

    def find(label):
        while parents[label] != label:
            parents[label] = parents[parents[label]]
            label = parents[label]
        return label

    def union(a, b):
        a, b = find(a), find(b)
        if a == b:
            return
        # Merge smaller area into larger area, retaining all original pixel counts.
        if bounds[a][4] < bounds[b][4]:
            a, b = b, a
        parents[b] = a
        p, q = bounds[a], bounds[b]
        p[:] = [min(p[0], q[0]), min(p[1], q[1]),
                max(p[2], q[2]), max(p[3], q[3]), p[4] + q[4]]

    mask = bytes(alpha).translate(bytes(255 if v > threshold else 0 for v in range(256)))
    for y in range(height):
        current, first = [], 0
        for match in re.finditer(b'\xff+', mask[y * width:(y + 1) * width]):
            left, right = match.span()
            label = len(parents)
            if label == MAX_RUNS:
                raise ValueError('Image exceeds one million alpha runs; select a smaller source region')
            parents.append(label)
            bounds.append([left, y, right, y + 1, right - left])
            # Equality means diagonal contact across the neighboring rows.
            while first < len(previous) and previous[first][1] < left:
                first += 1
            index = first
            while index < len(previous) and previous[index][0] <= right:
                union(label, previous[index][2])
                index += 1
            current.append((left, right, label))
        previous = current
    components = [bounds[i] for i in range(len(parents)) if parents[i] == i]
    kept = [b for b in components if b[4] >= min_pixels]
    if len(kept) > 4096:
        raise ValueError('More than 4096 candidate regions; choose min pixels or a smaller source region')
    kept.sort(key=lambda b: (b[1], b[0]))
    return {
        'components': len(components),
        'filteredComponents': len(components) - len(kept),
        'filteredPixels': sum(b[4] for b in components if b[4] < min_pixels),
        'regions': [{'id': f'region_{i + 1}',
                     'frame': {'x': b[0], 'y': b[1], 'w': b[2] - b[0], 'h': b[3] - b[1]},
                     'pixels': b[4]} for i, b in enumerate(kept)],
    }


def read_png(path):
    try:
        from PIL import Image
    except ImportError as error:
        raise RuntimeError('Image processing needs an available Pillow installation; nothing was installed') from error
    raw = Path(path).read_bytes()
    with Image.open(io.BytesIO(raw)) as image:
        if image.format != 'PNG' or getattr(image, 'n_frames', 1) != 1:
            raise ValueError('Select a single-frame PNG; animated images need their own frame/timing export')
        if image.width * image.height > MAX_PIXELS:
            raise ValueError('Decoded PNG exceeds 64 megapixels')
        if raw[24] > 8 or image.mode not in ('1', 'L', 'LA', 'P', 'RGB', 'RGBA'):
            raise ValueError('Select an 8-bit PNG; higher precision conversion must be chosen explicitly')
        rgba = image.convert('RGBA')
        # Preserve supported PNG interpretation metadata when exporting crops.
        info = {key: image.info[key] for key in ('icc_profile', 'gamma', 'srgb', 'chromaticity', 'dpi') if key in image.info}
    return rgba, info, hashlib.sha256(raw).hexdigest()


def crop_frames(image, info, frames, output):
    """Export requested rectangles without trimming, scaling or changing their origin."""
    from PIL.PngImagePlugin import PngInfo
    if not 1 <= len(frames) <= 128:
        raise ValueError('Select 1..128 explicitly named rectangles')
    parsed, names = [], set()
    for name, x, y, w, h in frames:
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', name) or name in names:
            raise ValueError('Frame names must be distinct letters/digits/underscore/hyphen, starting with a letter or digit')
        names.add(name)
        x, y, w, h = map(int, (x, y, w, h))
        if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > image.width or y + h > image.height:
            raise ValueError(f'{name}: rectangle exceeds decoded dimensions or has nonpositive size')
        parsed.append((name, x, y, w, h))
    target = Path(output)
    # A new directory avoids touching either sources or an earlier export.
    target.mkdir()
    pnginfo = PngInfo()
    if 'gamma' in info:
        pnginfo.add(b'gAMA', struct.pack('>I', round(info['gamma'] * 100000)))
    if 'chromaticity' in info:
        pnginfo.add(b'cHRM', struct.pack('>8I', *(round(v * 100000) for v in info['chromaticity'])))
    if 'srgb' in info:
        pnginfo.add(b'sRGB', bytes([info['srgb']]))
    save_options = {key: info[key] for key in ('icc_profile', 'dpi') if key in info}
    exported = []
    for name, x, y, w, h in parsed:
        file = target / f'{name}.png'
        with file.open('xb') as stream:
            image.crop((x, y, x + w, y + h)).save(stream, format='PNG', pnginfo=pnginfo, **save_options)
        exported.append({'id': name, 'path': str(file),
                         'frame': {'x': x, 'y': y, 'w': w, 'h': h}})
    return exported


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest='mode', required=True)
    regions = modes.add_parser('regions', help='Read-only alpha component candidates, not semantic objects')
    regions.add_argument('input')
    regions.add_argument('--alpha-threshold', type=int, required=True)
    regions.add_argument('--min-pixels', type=int, required=True)
    crop = modes.add_parser('crop', help='Export only explicitly selected source rectangles to a new directory')
    crop.add_argument('input')
    crop.add_argument('--frame', nargs=5, action='append', required=True, metavar=('NAME', 'X', 'Y', 'W', 'H'))
    crop.add_argument('--output', required=True, help='New directory under an existing parent')
    args = parser.parse_args()
    image, info, sha = read_png(args.input)
    report = {'input': args.input, 'sha256': sha, 'width': image.width, 'height': image.height}
    if args.mode == 'regions':
        alpha = image.getchannel('A')
        report.update({'alphaThreshold': args.alpha_threshold, 'minPixels': args.min_pixels,
                       'hasTransparency': alpha.getextrema()[0] < 255})
        report.update(alpha_regions(alpha.tobytes(), image.width, image.height,
                                    args.alpha_threshold, args.min_pixels))
    else:
        report['outputs'] = crop_frames(image, info, args.frame, args.output)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError) as error:
        raise SystemExit(str(error)) from error
