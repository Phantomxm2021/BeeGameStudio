import { CodeBlock } from '../../beui/registry/components/agents/code-block';
import { agentCodeLanguage } from '../../beui/registry/components/agents/agent-code';
import { filterPathsForDisplay } from '../../../utils/chatPathDisplay';

/** Read tools may return a partial file. Only show source line numbers when
 * the receipt supplies a contiguous gutter; never assume it starts at line 1. */
export function SourceCodeBlock({ output, path, streaming = false }: { output: string; path?: string; streaming?: boolean }) {
    const lines = output.replace(/\n$/, '').split('\n');
    const numbered = lines.map(line => /^\s*(\d+)(?:→|\t)(.*)$/.exec(line));
    const hasGutter = numbered.length > 0 && numbered.every((line, i) => line && Number(line[1]) > 0 &&
        (!i || Number(line[1]) === Number(numbered[i - 1]![1]) + 1));
    const language = agentCodeLanguage(path?.split('.').pop());
    return <div data-language={language}>
        <CodeBlock code={hasGutter ? numbered.map(line => line![2]).join('\n') : output} language={language}
            filename={path ? filterPathsForDisplay(path) : undefined} showLineNumbers={hasGutter}
            startLine={hasGutter ? Number(numbered[0]![1]) : 1} status={streaming ? 'streaming' : 'complete'} />
    </div>;
}
