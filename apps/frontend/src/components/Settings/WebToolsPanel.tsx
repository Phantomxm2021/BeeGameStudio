import { Search } from 'lucide-react';

export function WebToolsPanel({ label, language }: { label: string; language: string }) {
  return (
    <div className="grid min-h-16 gap-3 border-t border-border py-3 sm:grid-cols-[10.5rem_1fr] sm:items-start">
      <span className="flex items-center gap-2 text-sm font-medium text-foreground"><Search className="h-4 w-4 text-muted-foreground" />{label}</span>
      <p role="status" className="text-xs text-muted-foreground">{language.startsWith('zh')
        ? '旧搜索适配器已停用。请在 MCP 设置中接入搜索工具；已保存的旧配置不会用于 BGS。'
        : 'Legacy search adapters are disabled. Connect search tools in MCP settings; saved legacy configuration is not used by BGS.'}</p>
    </div>
  );
}
