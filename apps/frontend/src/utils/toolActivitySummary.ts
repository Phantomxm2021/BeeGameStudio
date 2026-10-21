import { filterPathsForDisplay } from './chatPathDisplay';

export type ActivityToolKind = 'search' | 'read' | 'write' | 'edit' | 'bash' | 'todo' | 'subagent' | 'image' | 'generic';

export function activityToolKind(name: string): ActivityToolKind {
    const tool = name.trim().toLowerCase();
    if (['search', 'grep', 'glob', 'websearch', 'web_search'].includes(tool)) return 'search';
    if (['bash', 'shell'].includes(tool)) return 'bash';
    if (['read', 'readdesignhandoff'].includes(tool)) return 'read';
    if (['write', 'writeprojectfile'].includes(tool)) return 'write';
    if (['edit', 'multiedit', 'editprojectfile'].includes(tool)) return 'edit';
    if (['agent', 'task', 'subagent'].includes(tool)) return 'subagent';
    if (['todowrite', 'todo_write'].includes(tool)) return 'todo';
    return tool === 'imageview' ? 'image' : 'generic';
}

// Read words for display only. Never expand variables, substitutions or globs.
// Operators stay separate so targets cannot be taken from a later command.
function shellWords(command: string): string[] | undefined {
    const words: string[] = [];
    let word = '', quote = '', started = false;
    const flush = () => { if (started) words.push(word); word = ''; started = false; };
    for (let i = 0; i < command.length; i++) {
        const char = command[i];
        if (char === '\\' && quote !== "'") {
            const next = command[i + 1];
            if (next === undefined) return;
            if (!quote || ['$', '`', '"', '\\', '\n'].includes(next)) { word += next; i++; }
            else word += char;
            started = true;
        } else if (quote) {
            if (char === quote) quote = ''; else word += char;
        } else if (char === "'" || char === '"') { quote = char; started = true; }
        else if (/\s/.test(char)) flush();
        else if (/[;&|<>]/.test(char)) { flush(); words.push(char); }
        else { word += char; started = true; }
    }
    if (quote) return;
    flush();
    return words;
}

const fileName = (value: string) => value.split(/[\\/]/).at(-1) || value;
const literal = (value: string) => !/[$`\n\r]/.test(value);

function shellSummary(command: string, zh: boolean): string {
    let words = shellWords(command);
    // Bgs supplies an executable, flags and one quoted command body.
    if (words?.length === 3 && /^(?:bash|zsh|sh)$/.test(fileName(words[0])) && /^-[il]*c$/.test(words[1])) {
        command = words[2];
        words = shellWords(command);
    }
    // A literal cwd followed by && is setup for the next action. Do not skip
    // conditional alternatives, redirections or arbitrary earlier commands.
    while (words?.[0] === 'cd' && words[1] && literal(words[1]) && words[2] === '&' && words[3] === '&') words = words.slice(4);
    const program = words?.[0] && literal(words[0]) ? fileName(words[0]) : '';
    if (program === 'cat' && words?.[1] === '>' && words[2] && !/[;&|<>]/.test(words[2]) && literal(words[2]))
        return `${zh ? '写入文件' : 'Write file'} · ${fileName(words[2])}`;
    if (command.includes('\n')) return `${zh ? '执行脚本' : 'Run script'}${program ? ` · ${program}` : ''}`;
    if (!words?.length) return zh ? '运行命令' : 'Run command';
    const end = words.findIndex(word => /^[;&|<>]$/.test(word));
    const first = end < 0 ? words : words.slice(0, end);
    if (program === 'cat' && first.length === 2 && !first[1].startsWith('-') && literal(first[1]))
        return `${zh ? '读取文件' : 'Read file'} · ${fileName(first[1])}`;
    if (program === 'curl' || program === 'wget') {
        const target = first.find(word => /^https?:\/\//.test(word) && literal(word));
        if (target) {
            try { return `${zh ? '请求网页' : 'Request URL'} · ${new URL(target).hostname}`; } catch { /* Use the command fallback. */ }
        }
    }
    if (['bun', 'node', 'nodejs'].includes(program) && first[1] && literal(first[1])) {
        if (fileName(first[1]) === 'assets.mjs' && first[2] === 'atlas' && first.length >= 6 && literal(first[5]))
            return `${zh ? '构建图集' : 'Build atlas'} · ${fileName(first[5])}`;
        if (program === 'bun' && first[1] === 'run' && first[2] && literal(first[2]))
            return `${zh ? '运行脚本' : 'Run script'} · ${first[2]}`;
        if (/\.[cm]?js$/.test(first[1])) return `${zh ? '执行脚本' : 'Run script'} · ${fileName(first[1])}`;
    }
    if (['npm', 'pnpm', 'yarn'].includes(program) && first[1] === 'run' && first[2] && literal(first[2]))
        return `${zh ? '运行脚本' : 'Run script'} · ${first[2]}`;
    const fileTarget = first.slice(1).filter(word => literal(word) && !/[\s$`]/.test(word) && !word.startsWith('-') && /[\w-]+\.[a-z0-9]{1,10}$/i.test(word)).at(-1);
    return `${zh ? '运行命令' : 'Run command'}${program ? ` · ${program}` : ''}${fileTarget ? ` · ${fileName(fileTarget)}` : ''}`;
}

export function toolActivitySummary(name: string, input: unknown, detail: string, zh: boolean): string {
    const kind = activityToolKind(name);
    const data = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    if (typeof data.description === 'string' && data.description.trim()) return data.description.trim().split('\n')[0];
    if (kind === 'bash') {
        const command = typeof data.command === 'string' ? data.command : detail.replace(/^Command:\s*/, '');
        return command ? shellSummary(command, zh) : name;
    }
    const target = [data.file_path, data.path, data.query, data.pattern, detail.replace(/^(?:Target|Command):\s*/, '')]
        .find(value => typeof value === 'string' && value.trim()) as string | undefined;
    const actions: Partial<Record<ActivityToolKind, string>> = { read: zh ? '读取' : 'Read', write: zh ? '写入' : 'Write', edit: zh ? '编辑' : 'Edit',
        search: zh ? '搜索' : 'Search', image: zh ? '查看图片' : 'View image' };
    return target ? `${actions[kind] ? `${actions[kind]} ` : ''}${filterPathsForDisplay(target).split('\n')[0]}` : name;
}
