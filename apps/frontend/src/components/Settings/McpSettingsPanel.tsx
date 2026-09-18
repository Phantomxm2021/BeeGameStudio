import { useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderOpen, MoreHorizontal, Network, Trash2 } from 'lucide-react';
import { Switch } from '../ui/switch';
import { ProjectSelect } from '../beui/project-select';
import { Button } from '../beui/project-button';
import {
  type ActiveDiscoveredMcpServer,
  type DiscoveredMcpServer,
  type McpServerConfig,
  type McpServerTestResult,
  type McpServerScope,
  type McpServerTransport,
} from '../../services/mcpServersApi';
import { isMcpFormSaveable, toPopoverAnchorRect, type McpServerForm, type PopoverAnchorRect } from './McpSettingsPanel.types';

export type McpSettingsCopy = {
  title: string;
  intro: string;
  configured: string;
  newServer: string;
  noServers: string;
  form: {
    name: string;
    enabled: string;
    transport: string;
    scope: string;
    command: string;
    args: string;
    url: string;
    cwd: string;
    env: string;
    argsHint: string;
    envHint: string;
    stdio: string;
    sse: string;
    http: string;
    beegame: string;
    global: string;
    project: string;
    edit: string;
    delete: string;
    cancel: string;
    save: string;
    saving: string;
    scanLocal: string;
    scanActive: string;
    scanning: string;
    discovered: string;
    activeDiscovered: string;
    noDiscovered: string;
    noActiveDiscovered: string;
    importServer: string;
    existing: string;
    source: string;
    testConnection: string;
    testingConnection: string;
    available: string;
    unavailable: string;
    untested: string;
    advanced: string;
    actions: string;
  };
  rows: Array<{
    title: string;
    description: string;
    note: string;
  }>;
};

function getMcpHealthLabel(copy: McpSettingsCopy, health: McpServerTestResult | undefined, isTesting: boolean): string {
  if (isTesting) return copy.form.testingConnection;
  if (!health) return copy.form.untested;
  return health.ok ? copy.form.available : copy.form.unavailable;
}

function getMcpHealthClass(health: McpServerTestResult | undefined, isTesting: boolean): string {
  if (isTesting) return 'text-orange-300';
  if (!health) return 'text-muted-foreground';
  return health.ok ? 'text-foreground' : 'text-foreground';
}

export function McpSettingsPanel({
  copy,
  servers,
  discovered,
  activeDiscovered,
  healthById,
  testingServerId,
  status,
  isSaving,
  onEdit,
  activeEditServerId,
  activeEditAnchorRect,
  form,
  onFormChange,
  onCloseForm,
  onSaveForm,
  onTest,
  onDelete,
  onImport,
  onImportActive,
}: {
  copy: McpSettingsCopy;
  servers: McpServerConfig[];
  discovered: DiscoveredMcpServer[];
  activeDiscovered: ActiveDiscoveredMcpServer[];
  healthById: Record<string, McpServerTestResult>;
  testingServerId: string;
  status: string;
  isSaving: boolean;
  onEdit: (server: McpServerConfig, rect: PopoverAnchorRect) => void;
  activeEditServerId: string;
  activeEditAnchorRect: PopoverAnchorRect | null;
  form: McpServerForm;
  onFormChange: (form: McpServerForm) => void;
  onCloseForm: () => void;
  onSaveForm: () => void;
  onTest: (server: McpServerConfig) => void;
  onDelete: (id: string) => void;
  onImport: (server: DiscoveredMcpServer) => void;
  onImportActive: (server: ActiveDiscoveredMcpServer) => void;
}) {
  const [activeServerMenuId, setActiveServerMenuId] = useState('');
  return (
    <div className="space-y-4 py-2">
      <p className="type-callout max-w-2xl text-muted-foreground">{copy.intro}</p>

      <div className="divide-y divide-border border-y border-border">
        <div className="type-caption-1 py-3 text-muted-foreground">{copy.configured}</div>
        {servers.length ? (
          servers.map(server => (
            <div key={server.id} className="flex items-center justify-between gap-3 py-3">
              <button
                type="button"
                onClick={event => onEdit(server, toPopoverAnchorRect(event.currentTarget.getBoundingClientRect()))}
                className="min-w-0 flex-1 rounded-lg px-2 py-1 text-left transition-colors hover:bg-accent"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${server.enabled ? 'bg-muted' : 'bg-muted-foreground'}`}
                  />
                  <span className="type-footnote truncate text-foreground">{server.name}</span>
                </div>
                <div className="type-footnote mt-1 truncate pl-4 text-muted-foreground">
                  {server.transport} · {server.scope}
                </div>
                <div className="type-footnote mt-1 flex items-center gap-2 pl-4">
                  <span className={getMcpHealthClass(healthById[server.id], testingServerId === server.id)}>
                    {getMcpHealthLabel(copy, healthById[server.id], testingServerId === server.id)}
                  </span>
                  {healthById[server.id]?.message ? (
                    <span className="truncate text-muted-foreground">{healthById[server.id].message}</span>
                  ) : null}
                </div>
              </button>
              <div className="relative flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  aria-label={copy.form.actions}
                  aria-haspopup="menu"
                  aria-expanded={activeServerMenuId === server.id}
                  data-mcp-row-action={server.id}
                  onClick={() => setActiveServerMenuId(current => (current === server.id ? '' : server.id))}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {activeServerMenuId === server.id ? (
                  <>
                    <div className="fixed inset-0 z-[250]" onMouseDown={() => setActiveServerMenuId('')} />
                    <div
                      role="menu"
                      className="bg-background absolute right-0 top-10 z-[260] w-44 overflow-hidden rounded-lg border border-border p-1.5 shadow-lg "
                      onMouseDown={event => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setActiveServerMenuId('');
                          onTest(server);
                        }}
                        disabled={isSaving || testingServerId === server.id}
                        className="type-button flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Network className="h-3.5 w-3.5 text-orange-300" />
                        {testingServerId === server.id ? copy.form.testingConnection : copy.form.testConnection}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={event => {
                          const anchor = Array.from(document.querySelectorAll('[data-mcp-row-action]')).find(
                            element => element.getAttribute('data-mcp-row-action') === server.id,
                          );
                          setActiveServerMenuId('');
                          onEdit(server, toPopoverAnchorRect((anchor ?? event.currentTarget).getBoundingClientRect()));
                        }}
                        className="type-button flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-foreground transition-colors hover:bg-accent"
                      >
                        <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                        {copy.form.edit}
                      </button>
                      <div className="my-1 h-px bg-accent" />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setActiveServerMenuId('');
                          onDelete(server.id);
                        }}
                        disabled={isSaving}
                        className="type-button flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {copy.form.delete}
                      </button>
                    </div>
                  </>
                ) : null}
                {activeEditServerId === server.id ? (
                  <McpServerFormPopover
                    mode="edit"
                    copy={copy}
                    form={form}
                    status={status}
                    isSaving={isSaving}
                    anchorRect={activeEditAnchorRect}
                    onChange={onFormChange}
                    onClose={onCloseForm}
                    onSave={onSaveForm}
                  />
                ) : null}
              </div>
            </div>
          ))
        ) : (
          <div className="type-callout py-4 text-muted-foreground">{copy.noServers}</div>
        )}
      </div>

      {activeDiscovered.length ? (
        <div className="divide-y divide-border border-y border-border">
          <div className="type-caption-1 py-3 text-muted-foreground">{copy.form.activeDiscovered}</div>
          {activeDiscovered.map(server => (
            <div key={`${server.endpoint}:${server.name}`} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-muted" />
                  <span className="type-footnote truncate text-foreground">{server.name}</span>
                  <span className="type-footnote text-foreground">{copy.form.available}</span>
                </div>
                <div className="type-footnote mt-1 truncate pl-4 text-muted-foreground">
                  {server.transport} · {server.endpoint}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onImportActive(server)}
                disabled={isSaving || server.exists}
                className="type-button h-8 shrink-0 rounded-full border border-border px-3 text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {server.exists ? copy.form.existing : copy.form.importServer}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {discovered.length ? (
        <div className="divide-y divide-border border-y border-border">
          <div className="type-caption-1 py-3 text-muted-foreground">{copy.form.discovered}</div>
          {discovered.map(server => (
            <div key={`${server.sourcePath}:${server.name}`} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${server.exists ? 'bg-muted-foreground' : 'bg-muted'}`}
                  />
                  <span className="type-footnote truncate text-foreground">{server.name}</span>
                </div>
                <div className="type-footnote mt-1 truncate pl-4 text-muted-foreground">
                  {server.transport} · {copy.form.source}: {server.sourcePath}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onImport(server)}
                disabled={isSaving || server.exists}
                className="type-button h-8 shrink-0 rounded-full border border-border px-3 text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {server.exists ? copy.form.existing : copy.form.importServer}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {status ? <div className="type-footnote text-foreground">{status}</div> : null}
    </div>
  );
}

export function McpServerFormPopover({
  mode,
  copy,
  form,
  status,
  isSaving,
  anchorRect,
  onChange,
  onClose,
  onSave,
}: {
  mode: 'create' | 'edit';
  copy: McpSettingsCopy;
  form: McpServerForm;
  status: string;
  isSaving: boolean;
  anchorRect: PopoverAnchorRect | null;
  onChange: (form: McpServerForm) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const update = (patch: Partial<McpServerForm>) => onChange({ ...form, ...patch });
  const saveDisabled = isSaving || !isMcpFormSaveable(form);
  if (!anchorRect) return null;

  const placement = getPopoverPlacement(anchorRect);
  return createPortal(
    <div className="fixed inset-0 z-[350]" onMouseDown={onClose}>
      <div
        className="fixed z-[360]"
        style={{ left: placement.left, top: placement.top }}
        onMouseDown={event => event.stopPropagation()}
        onClick={event => event.stopPropagation()}
      >
        <div
          className="absolute -top-2 h-4 w-4 rotate-45 border-l border-t border-border bg-background/95"
          style={{ left: placement.arrowLeft }}
        />
        <div className="bg-background relative flex max-h-[min(480px,calc(100vh-8rem))] w-[min(360px,calc(100vw-3rem))] flex-col overflow-hidden rounded-lg border border-border shadow-lg ">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2 [scrollbar-gutter:stable]">
            <div className="relative z-10 divide-y divide-border">
              <label className="grid gap-2 py-3">
                <span className="type-caption-1 text-muted-foreground">{copy.form.name}</span>
                <input
                  aria-label={copy.form.name}
                  value={form.name}
                  onChange={event => update({ name: event.target.value })}
                  className="type-input h-10 w-full rounded-lg border border-border bg-muted/40 px-3 text-foreground outline-none transition-colors focus:border-ring focus:bg-accent"
                />
              </label>

              <div className="flex items-center justify-between gap-3 py-3">
                <span className="type-footnote text-foreground">{copy.form.enabled}</span>
                <Switch
                  checked={form.enabled}
                  aria-label={copy.form.enabled}
                  onCheckedChange={() => update({ enabled: !form.enabled })}
                />
              </div>

              <div className="grid gap-2 py-3">
                <span className="type-caption-1 text-muted-foreground">{copy.form.transport}</span>
                <ProjectSelect ariaLabel={copy.form.transport} value={form.transport} onValueChange={value => update({ transport: value as McpServerTransport })} options={[{ value: 'stdio', label: copy.form.stdio }, { value: 'sse', label: copy.form.sse }, { value: 'http', label: copy.form.http }]} className="w-full" triggerClassName="type-input h-10 rounded-lg bg-muted/40" />
              </div>

              {form.transport !== 'stdio' ? (
                <label className="grid gap-2 py-3">
                  <span className="type-caption-1 text-muted-foreground">{copy.form.url}</span>
                  <input
                    aria-label={copy.form.url}
                    value={form.url}
                    onChange={event => update({ url: event.target.value })}
                    placeholder="http://127.0.0.1:3000/mcp"
                    className="type-input h-10 w-full rounded-lg border border-border bg-muted/40 px-3 text-foreground outline-none transition-colors focus:border-ring focus:bg-accent"
                  />
                </label>
              ) : null}

              <div className="py-2">
                <button
                  type="button"
                  aria-expanded={advancedOpen}
                  onClick={() => setAdvancedOpen(current => !current)}
                  className="type-button flex h-9 w-full items-center justify-between rounded-lg px-2 text-left text-foreground transition-colors hover:bg-accent"
                >
                  <span>{copy.form.advanced}</span>
                  <span className={`text-muted-foreground transition-transform ${advancedOpen ? 'rotate-180' : ''}`}>⌄</span>
                </button>
                {advancedOpen ? (
                  <div className="mt-1 divide-y divide-border">
                    {form.transport === 'stdio' ? (
                      <>
                        <label className="grid gap-2 py-3">
                          <span className="type-caption-1 text-muted-foreground">{copy.form.command}</span>
                          <input
                            aria-label={copy.form.command}
                            value={form.command}
                            onChange={event => update({ command: event.target.value })}
                            placeholder="npx"
                            className="type-code h-10 w-full rounded-lg border border-border bg-muted/40 px-3 text-foreground outline-none transition-colors focus:border-ring focus:bg-accent"
                          />
                        </label>
                        <label className="grid gap-2 py-3">
                          <span className="type-caption-1 text-muted-foreground">{copy.form.args}</span>
                          <div className="space-y-1">
                            <textarea
                              aria-label={copy.form.args}
                              value={form.argsText}
                              onChange={event => update({ argsText: event.target.value })}
                              rows={3}
                              className="type-code w-full resize-none rounded-lg border border-border bg-muted/40 px-3 py-2 text-foreground outline-none transition-colors focus:border-ring focus:bg-accent"
                            />
                            <div className="type-footnote text-muted-foreground">{copy.form.argsHint}</div>
                          </div>
                        </label>
                      </>
                    ) : null}
                    <div className="grid gap-2 py-3">
                      <span className="type-caption-1 text-muted-foreground">{copy.form.scope}</span>
                      <ProjectSelect ariaLabel={copy.form.scope} value={form.scope} onValueChange={value => update({ scope: value as McpServerScope })} options={[{ value: 'beegame', label: copy.form.beegame }, { value: 'project', label: copy.form.project }, { value: 'global', label: copy.form.global }]} className="w-full" triggerClassName="type-input h-10 rounded-lg bg-muted/40" />
                    </div>

                    <label className="grid gap-2 py-3">
                      <span className="type-caption-1 text-muted-foreground">{copy.form.cwd}</span>
                      <input
                        aria-label={copy.form.cwd}
                        value={form.cwd}
                        onChange={event => update({ cwd: event.target.value })}
                        className="type-code h-10 w-full rounded-lg border border-border bg-muted/40 px-3 text-foreground outline-none transition-colors focus:border-ring focus:bg-accent"
                      />
                    </label>

                    <label className="grid gap-2 py-3">
                      <span className="type-caption-1 text-muted-foreground">{copy.form.env}</span>
                      <div className="space-y-1">
                        <textarea
                          aria-label={copy.form.env}
                          value={form.envText}
                          onChange={event => update({ envText: event.target.value })}
                          rows={3}
                          className="type-code w-full resize-none rounded-lg border border-border bg-muted/40 px-3 py-2 text-foreground outline-none transition-colors focus:border-ring focus:bg-accent"
                        />
                        <div className="type-footnote text-muted-foreground">{copy.form.envHint}</div>
                      </div>
                    </label>
                  </div>
                ) : null}
              </div>
            </div>
            {status ? <div className="type-footnote py-2 text-foreground">{status}</div> : null}
          </div>

          {mode === 'create' ? (
            <footer className="relative z-10 flex shrink-0 items-center justify-end gap-2 border-t border-border bg-muted/30 px-4 py-3">
              <Button type="button" variant="secondary" onClick={onClose}>
                {copy.form.cancel}
              </Button>
              <Button
                type="button"
                onClick={onSave}
                disabled={saveDisabled}
              >
                {isSaving ? copy.form.saving : copy.form.save}
              </Button>
            </footer>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function getPopoverPlacement(anchorRect: PopoverAnchorRect): {
  left: number;
  top: number;
  arrowLeft: number;
} {
  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const popoverWidth = Math.min(360, Math.max(280, viewportWidth - 32));
  const margin = 16;
  const preferredLeft = anchorRect.right - popoverWidth;
  const left = Math.min(Math.max(margin, preferredLeft), Math.max(margin, viewportWidth - popoverWidth - margin));
  const anchorCenter = anchorRect.left + anchorRect.width / 2;
  return {
    left,
    top: anchorRect.bottom + 12,
    arrowLeft: Math.min(Math.max(18, anchorCenter - left - 8), popoverWidth - 34),
  };
}
