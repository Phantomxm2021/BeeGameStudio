import { Search } from 'lucide-react';
import type { WebSearchAdapter } from '../../services/webToolsApi';
import { ProjectSelect } from '../beui/project-select';

export function WebToolsPanel({
  label,
  searchBackend,
  adapter,
  keyField,
  keyValue,
  keyPreview,
  savedPrefix,
  status,
  onAdapterChange,
  onKeyChange,
}: {
  label: string;
  searchBackend: string;
  adapter: WebSearchAdapter;
  keyField: 'brave' | 'exa' | null;
  keyValue: string;
  keyPreview: string;
  savedPrefix: string;
  status: string;
  onAdapterChange: (value: WebSearchAdapter) => void;
  onKeyChange: (value: string) => void;
}) {
  return (
    <div className="grid min-h-16 gap-3 border-t border-border py-3 sm:grid-cols-[10.5rem_1fr] sm:items-start">
      <span className="flex items-center gap-2 text-sm font-medium text-foreground sm:mt-2.5"><Search className="h-4 w-4 text-muted-foreground" />{label}</span>
      <div className="min-w-0 space-y-2">
        <ProjectSelect ariaLabel={searchBackend} value={adapter} onValueChange={value => onAdapterChange(value as WebSearchAdapter)} options={[{ value: 'tavily', label: 'Tavily' }, { value: 'api', label: 'Anthropic API' }, { value: 'bing', label: 'Bing' }, { value: 'brave', label: 'Brave' }, { value: 'exa', label: 'Exa' }]} className="w-full" triggerClassName="h-10 rounded-lg" />
        {keyField ? <input aria-label={keyField === 'brave' ? 'BRAVE_SEARCH_API_KEY' : 'EXA_API_KEY'} type="password" value={keyValue} onChange={event => onKeyChange(event.target.value)} placeholder={keyPreview ? `${savedPrefix}${keyPreview}` : keyField === 'brave' ? 'BRAVE_SEARCH_API_KEY' : 'EXA_API_KEY'} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30" /> : null}
        {status ? <div className="text-xs text-foreground dark:text-foreground">{status}</div> : null}
      </div>
    </div>
  );
}
