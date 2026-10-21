#!/usr/bin/env python3
"""Repeatable source branding. Dry-run by default; never walks runtime/user data.

Run on an upstream-compatible source branch, then commit the generated distribution
on a separate branch. External service identifiers below are deliberately retained.
"""
import argparse
import json
import re
import subprocess
from pathlib import Path

# These are upstream/external contracts, not BGS-owned names. Keep matches verbatim.
EXTERNAL = re.compile(
    r'https?://[^\s<>"\'`\\]+'
    r'|(?:gpt-[\w.-]*codex[\w.-]*|codex-(?:mini|[0-9])[\w.-]*)'
    r'|x-codex-[\w-]*'
    r'|\.codex-plugin\b'
    r'|\bcodex_cli_rs\b'
    r'|\bcodex_cli_simplified_flow\b'
    r'|["\'](?:codex_streamlined_login|missing_codex_entitlement)["\']'
    r'|\bcodex_(?:atlas|chatgpt_desktop|vscode)\b'
    r'|OpenAI Codex'
    r'|Codex Desktop'
    r'|old Codex language model built by OpenAI'
    r'|(?:Copyright|copyright)[^\n]*'
)
# Relative URLs and API identifiers used by the real ChatGPT backend.
NATIVE_EXTERNAL = re.compile(r'/api/codex\b|/backend-api/codex\b|\bcodex_auth\.age\b')

DISTRIBUTION_README = """# BGS runtime

BGS is a PhantomLab distribution based on OpenAI Codex. The upstream LICENSE
and NOTICE remain applicable. Product names, source modules, configuration,
environment variables and storage paths are branded; agent execution semantics
and external service contracts are retained.

Build from the parent BeeGameStudio repository with `bun run bgs:build` and
verify with `bun run bgs:verify`. The internal Cargo package is `bgs-cli`, target
`bgs`, under `bgs-rs/`. No public npm BGS package is assumed or required.

The runtime reads `BGS_HOME`, defaulting to `~/.bgs`. Skills are under
`$BGS_HOME/skills`; installed plugins and caches are under `$BGS_HOME/plugins`.
BGS servers use an owner-private `.runtime/app/bgs` home. Old home directories
require the offline migration described in the parent runbook; do not rename
active account stores or rewrite saved sessions.

Official binary self-updates are disabled. Keep `bgs/source-VERSION` as the
upstream-compatible source branch with the small product patches. Merge the
next official release there, then run the parent's `scripts/brand-bgs.py`
on a separate distribution branch. Never merge upstream directly into the
mechanically renamed tree. See `docs/bgs-runtime-upgrades.md` in BeeGameStudio.

External URLs/model IDs, protocol headers, third-party `.codex-plugin` manifests,
and original attribution are deliberate compatibility exceptions. A local
successful build does not validate untested platforms or live provider logins.
"""

def rename(value):
    return (value.replace('CODEX', 'BGS').replace('Codex', 'Bgs').replace('codex', 'bgs')
            .replace('BGS_BGS_', 'BGS_').replace('com.openai.bgs', 'com.phantomlab.bgs'))

def transform(text, native=True, name=''):
    if name.endswith('tui/src/empty_state_animation/paths.rs') and 'pub(super) const CODEX:' in text:
        text = text.replace('const BGS:', 'const BRAND_GLYPH:').replace('= BGS;', '= BRAND_GLYPH;')
    saved = []
    def protect(match):
        value = match.group()
        value = re.sub(r'\{[^{}]*\}', lambda part: rename(part.group()), value)
        saved.append(value)
        return f'\x00{len(saved)-1}\x00'
    if native and '/cli/src/desktop_app/' in name:
        # This launches the actual upstream desktop application; its signed bundle,
        # URL scheme and installer identities are external contracts.
        text = re.sub(r'"(?:\\.|[^"\\])*"', protect, text)
    if native and any(part in name for part in ('backend-client/', 'backend-openapi-models/', 'login/src/success_page', 'core-plugins/src/remote', 'model-provider-info/')):
        text = re.sub(r'"codex(?:_other)?"', protect, text)
    text = EXTERNAL.sub(protect, text)
    if native:
        text = NATIVE_EXTERNAL.sub(protect, text)
    text = rename(text)
    # Prose/CLI name, while Rust/TS identifiers use idiomatic BgsFoo spelling.
    text = re.sub(r'\bBgs (?=CLI|app-server|runtime|configuration|home|plugin|skills)', 'BGS ', text)
    text = re.sub(r'\x00(\d+)\x00', lambda m: saved[int(m[1])], text)
    text = text.replace('BGS CLI is an open source project led by OpenAI.', 'BGS CLI is a PhantomLab distribution based on OpenAI Codex.')
    if name in ('BGS.md', 'README.md') and native:
        return DISTRIBUTION_README
    return text

def tracked(root):
    result = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=root)
    return sorted(set(result.decode().split('\0')) - {''})

def convert(root, apply=False, native=True):
    changes, moves, contents = [], [], {}
    for name in tracked(root):
        path = root / name
        if not path.is_file() or path.is_symlink():
            continue
        if not native:
            # Only product source/config. Never projects, logs, runtime or audit evidence.
            if not (name.startswith(('apps/', 'packages/', 'scripts/')) or name in
                    ('package.json', '.env.example', 'Dockerfile', '.dockerignore', 'README.md')):
                continue
            if name == 'scripts/brand-bgs.py':
                continue
        if path.name in ('LICENSE', 'NOTICE', 'LICENSE.txt') or 'licenses/' in name.lower():
            continue
        new_name = rename(name)
        # Third-party manifest format is a read compatibility contract.
        new_name = new_name.replace('.bgs-plugin', '.codex-plugin')
        if new_name != name:
            moves.append((name, new_name))
        try:
            before = path.read_text(encoding='utf-8')
        except UnicodeError:
            continue
        after = transform(before, native, name)
        if before != after:
            changes.append(name)
            contents[name] = after
    # Validate destination collisions before any write.
    destinations = {}
    for old, new in moves:
        if new in destinations or (root / new).exists():
            raise RuntimeError(f'Branding destination already exists: {new}')
        destinations[new] = old
    paths = set()
    for old, _ in moves:
        path = Path(old)
        paths.add(path)
        paths.update(p for p in path.parents if str(p) != '.')
    for path in paths:
        source = root / path
        target = source.with_name(rename(path.name))
        if '.codex-plugin' not in path.parts and source != target and target.exists():
            raise RuntimeError(f'Rename collision (move old build caches out first): {target}')
    if apply:
        for name, body in contents.items():
            (root / name).write_text(body, encoding='utf-8')
        # Rename files and directories deepest first, retaining ignored build caches.
        for path in sorted(paths, key=lambda p: (len(p.parts), str(p)), reverse=True):
            source = root / path
            target = source.with_name(rename(path.name))
            if '.codex-plugin' in path.parts or source == target or not source.exists():
                continue
            if target.exists():
                raise RuntimeError(f'Rename collision: {target}')
            source.rename(target)
    return {'changedFiles': len(changes), 'renamedFiles': len(moves), 'files': changes, 'renames': moves}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--host', action='store_true', help='Convert only BGS host source, never data')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    report = convert(args.root.resolve(), args.apply, not args.host)
    if args.report:
        args.report.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k not in ('files', 'renames')}))
