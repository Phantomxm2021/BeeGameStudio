#!/usr/bin/env python3
"""Apply only BGS home/documentation packaging names to the maintained source.

The source branch carries the reviewed CLI display and source-update packaging
patches. Keep upstream paths, Cargo names, identifiers and protocols unchanged.
"""
import argparse
import json
import re
import subprocess
from pathlib import Path

DISTRIBUTION_README = """# BGS runtime

BGS is a PhantomLab distribution based on OpenAI Codex. LICENSE and NOTICE
retain upstream attribution. Native execution, Goal accounting, history,
model metadata and wire protocols follow the selected upstream release.

Build from BeeGameStudio with `bun run bgs:build`, then `bun run bgs:verify`.
The public executable is `bgs`; internal Cargo names and the companion
`codex-code-mode-host` retain upstream names under `codex-rs/`.

The runtime reads `BGS_HOME`, defaulting to `~/.bgs`. BeeGameStudio supplies
an owner-private `.runtime/app/bgs` home. Existing sessions are not rewritten.
SQLite overrides use `BGS_SQLITE_HOME`; TUI recording uses
`BGS_TUI_RECORD_SESSION` and `BGS_TUI_SESSION_LOG_PATH`. Their Codex-named
counterparts are not read. No existing databases or logs are migrated.
Project configuration uses `.bgs`, system configuration `/etc/bgs`, and macOS
managed preferences `com.phantomlab.bgs`; Codex configuration is not loaded.
Protocol fields, MCP metadata, model/service identifiers and third-party plugin
formats retain upstream names.

Official binary self-replacement is disabled for this source-built package.
Merge upstream into `bgs/source-VERSION`, review its branding/packaging-only
diff, then run `scripts/brand-bgs.py` to generate the distribution. Do not add
native behavior patches without explicit user authorization. See the parent
`docs/bgs-runtime-upgrades.md` for provenance, validation and deployment.
"""

def transform(text, name=''):
    # Exact environment-name literals only; no identifier or protocol renaming.
    if name.startswith('codex-rs/'):
        text = text.replace('"CODEX_HOME"', '"BGS_HOME"').replace("'CODEX_HOME'", "'BGS_HOME'")
        # These three names are BGS-owned storage/log configuration, not wire
        # identifiers. Keep suffixes and unrelated internal CODEX_* names intact.
        for before, after in (
            ('CODEX_SQLITE_HOME', 'BGS_SQLITE_HOME'),
            ('CODEX_TUI_RECORD_SESSION', 'BGS_TUI_RECORD_SESSION'),
            ('CODEX_TUI_SESSION_LOG_PATH', 'BGS_TUI_SESSION_LOG_PATH'),
        ):
            text = re.sub(r'\b' + before + r'\b', after, text)
        # Update configuration references without renaming Rust identifiers
        # such as the existing CODEX_HOME static in the TUI highlighter.
        text = text.replace('${CODEX_HOME', '${BGS_HOME')
        text = re.sub(r'\$CODEX_HOME\b', '$BGS_HOME', text)
        text = text.replace('`CODEX_HOME`', '`BGS_HOME`')
        text = re.sub(r'\bCODEX_HOME(?=[/\\])', 'BGS_HOME', text)
        for before, after in (
            ('failed to resolve CODEX_HOME', 'failed to resolve BGS_HOME'),
            ('CODEX_HOME must be', 'BGS_HOME must be'),
            ('CODEX_HOME is not available', 'BGS_HOME is not available'),
            ('Path to CODEX_HOME', 'Path to BGS_HOME'),
            ('WSL CODEX_HOME', 'WSL BGS_HOME'),
            ('beneath CODEX_HOME', 'beneath BGS_HOME'),
            ('outside CODEX_HOME', 'outside BGS_HOME'),
        ):
            text = text.replace(before, after)
        # Plain names in documentation/schema descriptions describe the user
        # configuration directory. Leave source identifiers and wire keys alone.
        text = ''.join(re.sub(r'\bCODEX_HOME\b', 'BGS_HOME', line)
                       if name.endswith('.md') or line.lstrip().startswith(('//', '"description":'))
                       else line for line in text.splitlines(keepends=True))
        # BGS-owned configuration paths stay separate from Codex. Exact path
        # literals only: third-party .codex-plugin and wire identifiers stay intact.
        text = text.replace('".codex"', '".bgs"').replace("'.codex'", "'.bgs'")
        # Match local path components, including test file:// URIs, while
        # keeping links to real upstream documentation and services unchanged.
        text = ''.join(part if part.startswith(('http://', 'https://')) else
                       re.sub(r'\.codex(?=[/\\])|(?:~|\$HOME)/\.codex\b(?!-)',
                              lambda match: match[0].replace('.codex', '.bgs'), part)
                       for part in re.split(r'(https?://[^\s<>"\'`]+)', text))
    if name.startswith('codex-rs/config/'):
        text = text.replace('/etc/codex/', '/etc/bgs/')
        text = text.replace('.join("OpenAI")', '.join("PhantomLab")').replace('.join("Codex")', '.join("BGS")')
        text = text.replace('OpenAI\\Codex', 'PhantomLab\\BGS').replace('OpenAI\\\\Codex', 'PhantomLab\\\\BGS')
    if name == 'codex-rs/config/src/loader/mod.rs':
        text = text.replace('Path::new("OpenAI").join("BGS")', 'Path::new("PhantomLab").join("BGS")')
    if name in ('codex-rs/config/src/loader/macos.rs', 'codex-rs/config/src/config_requirements.rs'):
        text = text.replace('com.openai.codex', 'com.phantomlab.bgs')
    if name == 'codex-rs/skills/src/lib.rs':
        text = text.replace('".codex-system-skills.marker"', '".bgs-system-skills.marker"')
    if name == 'codex-rs/utils/home-dir/src/lib.rs':
        text = text.replace('CODEX_HOME', 'BGS_HOME').replace('.codex', '.bgs')
    if name in ('codex-rs/utils/cli/src/config_override.rs', 'codex-rs/cli/src/mcp_cmd.rs'):
        text = text.replace('~/.codex/config.toml', '~/.bgs/config.toml')
    if name == 'codex-rs/cli/src/bin/logs_client.rs':
        text = text.replace('or ~/.codex.', 'or ~/.bgs.')
    if name == 'codex-rs/tui/src/render/highlight.rs':
        # This table documents the Rust static, rather than the environment.
        text = text.replace('| `BGS_HOME` | `OnceLock', '| `CODEX_HOME` | `OnceLock')
    if name in ('BGS.md', 'README.md'):
        return DISTRIBUTION_README
    return text

def tracked(root):
    result = subprocess.check_output(['git', 'ls-files', '-z', '--cached'], cwd=root)
    return sorted(set(result.decode().split('\0')) - {''})

def convert(root, apply=False):
    changes = []
    for name in tracked(root):
        path = root / name
        if not path.is_file() or path.is_symlink():
            continue
        if path.name in ('LICENSE', 'NOTICE', 'LICENSE.txt') or 'licenses/' in name.lower():
            continue
        try:
            before = path.read_text(encoding='utf-8')
        except UnicodeError:
            continue
        after = transform(before, name)
        if before != after:
            changes.append(name)
            if apply:
                path.write_text(after, encoding='utf-8')
    return {'changedFiles': len(changes), 'renamedFiles': 0, 'files': changes, 'renames': []}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    report = convert(args.root.resolve(), args.apply)
    if args.report:
        args.report.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k not in ('files', 'renames')}))
