import { describe, expect, it } from 'vitest';
import { activityToolKind, toolActivitySummary } from './toolActivitySummary';

describe('tool activity summaries', () => {
    it('removes a shell wrapper and transport flags without changing the original command', () => {
        const command = `/bin/zsh -lc 'curl -sL -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" "https://fonts.example.com/css?family=Example" | head -40'`;
        expect(toolActivitySummary('Shell', { command }, '', true)).toBe('请求网页 · fonts.example.com');
        expect(command).toContain('/bin/zsh -lc');
    });
    it('uses the output file of the atlas command, ignoring later diagnostic commands', () => {
        const command = `/bin/zsh -lc 'bun .beegame/tmp/tools/assets.mjs atlas assets/source.png assets/frames.json assets/runtime/result.png 2>&1 | head -20; ls assets/runtime'`;
        expect(toolActivitySummary('Shell', { command }, '', true)).toBe('构建图集 · result.png');
    });
    it.each([
        ['node script.mjs --secret private-value', 'Run script · script.mjs'],
        ['npm run build -- --mode production', 'Run script · build'],
        ['bun run test', 'Run script · test'],
        ['python3 - <<\'PY\'\nprint("https://unrelated.example")\nPY', 'Run script · python3'],
        ['unknown-tool --token private-value', 'Run command · unknown-tool'],
        ['echo hello; curl https://later.example', 'Run command · echo'],
        ['curl "$DYNAMIC_URL"', 'Run command · curl'],
        ['curl "https://$HOST/private"', 'Run command · curl'],
        ['curl "unterminated', 'Run command'],
        ['/bin/zsh -lc \'cd "/workspace/example game" && bun run build\'', 'Run script · build'],
        ['cd /workspace && cat > requests/data.json <<\'JSON\'\n{"fixture":true}\nJSON', 'Write file · data.json'],
        ['cd /workspace && cat docs/guide.md', 'Read file · guide.md'],
        ['cd /workspace || curl https://later.example', 'Run command · cd'],
        ['cd /workspace && grep -n "heading" docs/guide.md', 'Run command · grep · guide.md'],
    ])('uses a conservative summary for %s', (command, expected) => {
        expect(toolActivitySummary('Shell', { command }, '', false)).toBe(expected);
    });
    it('recognizes native and BGS file tools and preserves existing descriptions', () => {
        expect(activityToolKind('Shell')).toBe('bash');
        expect(activityToolKind('Bash')).toBe('bash');
        expect(activityToolKind('WriteProjectFile')).toBe('write');
        expect(activityToolKind('EditProjectFile')).toBe('edit');
        expect(toolActivitySummary('EditProjectFile', { file_path: 'src/Example.ts' }, '', true)).toBe('编辑 Example.ts');
        expect(toolActivitySummary('Bash', { description: 'Check layout', command: 'node verify.mjs' }, '', false)).toBe('Check layout');
        expect(toolActivitySummary('Shell', {}, 'Command: /bin/zsh -lc "bun run build"', false)).toBe('Run script · build');
    });
});
