import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, Brain, Cpu, FolderOpen, Globe, KeyRound, MoreHorizontal, Network, Plus, RotateCcw, Search, ShieldCheck, Trash2, X } from 'lucide-react';
import { LANGUAGE_OPTIONS, translations, type Language } from '../AgentsConfig';
import { getBeeGameText } from '../BeeGameI18n';
import {
    getBeeGameSubagentsEnabled,
    getBeeGameWorkspaceSettings,
    resetBeeGameWorkspaceRoot,
    setBeeGameSubagentsEnabled,
    setBeeGameWorkspaceRoot,
} from '../../../services/beeGameAdapter';
import {
    createModelConfig,
    listModelConfigs,
    updateModelConfig,
    type ModelConfig,
    type ModelProviderKind,
} from '../../../services/modelConfigApi';
import {
    getWebToolsConfig,
    saveWebToolsConfig,
    type WebSearchAdapter,
} from '../../../services/webToolsApi';
import {
    getRuntimeSettings,
    saveRuntimeSettings,
    type RuntimeSettingsConfig,
} from '../../../services/runtimeSettingsApi';
import {
    createMcpServer,
    deleteMcpServer,
    discoverActiveMcpServers,
    listMcpServers,
    testMcpServer,
    updateMcpServer,
    type ActiveDiscoveredMcpServer,
    type DiscoveredMcpServer,
    type McpServerConfig,
    type McpServerInput,
    type McpServerTestResult,
    type McpServerScope,
    type McpServerTransport,
} from '../../../services/mcpServersApi';

interface SettingsMenuProps {
    isOpen: boolean;
    lang: Language;
    onClose: () => void;
    onSetLang: (lang: Language) => void;
}

type SettingsTab = 'general' | 'runtime' | 'mcp' | 'model';
type PopoverAnchorRect = {
    top: number;
    right: number;
    bottom: number;
    left: number;
    width: number;
};
type McpFormAnchor =
    | { kind: 'new'; rect: PopoverAnchorRect }
    | { kind: 'edit'; serverId: string; rect: PopoverAnchorRect }
    | null;

type McpServerForm = {
    id: string;
    name: string;
    enabled: boolean;
    transport: McpServerTransport;
    scope: McpServerScope;
    command: string;
    argsText: string;
    url: string;
    cwd: string;
    envText: string;
    autoStart: boolean;
};

export function SettingsMenu({ isOpen, lang, onClose, onSetLang }: SettingsMenuProps) {
    const t = translations[lang];
    const text = getBeeGameText(lang);
    const [existingConfigs, setExistingConfigs] = useState<ModelConfig[]>([]);
    const [selectedModelConfigId, setSelectedModelConfigId] = useState('');
    const [name, setName] = useState('');
    const [provider, setProvider] = useState<ModelProviderKind>('openai-compatible');
    const [baseUrl, setBaseUrl] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [fastModel, setFastModel] = useState('');
    const [balancedModel, setBalancedModel] = useState('');
    const [strongModel, setStrongModel] = useState('');
    const [apiKeyPreview, setApiKeyPreview] = useState('');
    const [isDefault, setIsDefault] = useState(true);
    const [status, setStatus] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [workspacePath, setWorkspacePath] = useState('');
    const [workspaceStatus, setWorkspaceStatus] = useState('');
    const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
    const [webSearchAdapter, setWebSearchAdapter] = useState<WebSearchAdapter>('tavily');
    const [braveApiKey, setBraveApiKey] = useState('');
    const [braveApiKeyPreview, setBraveApiKeyPreview] = useState('');
    const [exaApiKey, setExaApiKey] = useState('');
    const [exaApiKeyPreview, setExaApiKeyPreview] = useState('');
    const [webToolsStatus, setWebToolsStatus] = useState('');
    const [isSavingWebTools, setIsSavingWebTools] = useState(false);
    const [runtimeSettings, setRuntimeSettings] = useState<Required<RuntimeSettingsConfig>>(() => normalizeRuntimeSettings({}));
    const [runtimeSettingsStatus, setRuntimeSettingsStatus] = useState('');
    const [isSavingRuntimeSettings, setIsSavingRuntimeSettings] = useState(false);
    const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
    const [mcpForm, setMcpForm] = useState<McpServerForm>(() => createEmptyMcpForm());
    const [mcpFormAnchor, setMcpFormAnchor] = useState<McpFormAnchor>(null);
    const [isMcpActionMenuOpen, setIsMcpActionMenuOpen] = useState(false);
    const [mcpStatus, setMcpStatus] = useState('');
    const [isSavingMcp, setIsSavingMcp] = useState(false);
    const [discoveredMcpServers, setDiscoveredMcpServers] = useState<DiscoveredMcpServer[]>([]);
    const [activeMcpServers, setActiveMcpServers] = useState<ActiveDiscoveredMcpServer[]>([]);
    const [mcpHealthById, setMcpHealthById] = useState<Record<string, McpServerTestResult>>({});
    const [testingMcpServerId, setTestingMcpServerId] = useState('');
    const [isScanningActiveMcp, setIsScanningActiveMcp] = useState(false);
    const [activeTab, setActiveTab] = useState<SettingsTab>('general');
    const [subagentsEnabled, setSubagentsEnabled] = useState(true);
    const mcpAutoSaveTimerRef = useRef<number | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        void listModelConfigs()
            .then((configs) => {
                if (cancelled) return;
                setExistingConfigs(configs);
                const defaultConfig = configs.find((config) => config.isDefault) || configs[0];
                if (!defaultConfig) return;
                setSelectedModelConfigId(defaultConfig.id);
                setName(defaultConfig.name);
                setProvider(defaultConfig.provider);
                setBaseUrl(defaultConfig.baseUrl || '');
                setFastModel(defaultConfig.models.fast || '');
                setBalancedModel(defaultConfig.models.balanced || '');
                setStrongModel(defaultConfig.models.strong || '');
                setApiKeyPreview(defaultConfig.apiKeyPreview || '');
                setIsDefault(defaultConfig.isDefault);
            })
            .catch(() => {
                if (!cancelled) {
                    setExistingConfigs([]);
                    setSelectedModelConfigId('');
                    setApiKeyPreview('');
                }
            });
        void getBeeGameWorkspaceSettings()
            .then((settings) => {
                if (cancelled) return;
                setWorkspacePath(settings.workspacePath);
                setWorkspaceStatus('');
            })
            .catch((error) => {
                if (!cancelled) {
                    setWorkspaceStatus(error instanceof Error ? error.message : text.workspaceReadFailed);
                }
            });
        setSubagentsEnabled(getBeeGameSubagentsEnabled());
        void getWebToolsConfig()
            .then((config) => {
                if (cancelled) return;
                setWebSearchAdapter(config.webSearchAdapter || 'tavily');
                setBraveApiKeyPreview(config.braveApiKeyPreview || '');
                setExaApiKeyPreview(config.exaApiKeyPreview || '');
                setBraveApiKey('');
                setExaApiKey('');
                setWebToolsStatus('');
            })
            .catch((error) => {
                if (!cancelled) {
                    setWebToolsStatus(error instanceof Error ? error.message : text.webToolsReadFailed);
                }
            });
        void getRuntimeSettings()
            .then((config) => {
                if (cancelled) return;
                setRuntimeSettings(normalizeRuntimeSettings(config));
                setRuntimeSettingsStatus('');
            })
            .catch((error) => {
                if (!cancelled) {
                    setRuntimeSettingsStatus(error instanceof Error ? error.message : 'Runtime settings unavailable');
                }
            });
        void listMcpServers()
            .then((servers) => {
                if (cancelled) return;
                setMcpServers(servers);
                setMcpForm(createEmptyMcpForm());
                setMcpFormAnchor(null);
                setIsMcpActionMenuOpen(false);
                setDiscoveredMcpServers([]);
                setMcpStatus('');
            })
            .catch((error) => {
                if (!cancelled) {
                    setMcpStatus(error instanceof Error ? error.message : 'MCP settings unavailable');
                }
            });
        return () => {
            cancelled = true;
            if (mcpAutoSaveTimerRef.current !== null) {
                window.clearTimeout(mcpAutoSaveTimerRef.current);
                mcpAutoSaveTimerRef.current = null;
            }
        };
    }, [isOpen]);

    const handleSaveModelConfig = async () => {
        setStatus('');
        setIsSaving(true);
        try {
            const payload = {
                name: name.trim() || 'BeeGame LLM',
                provider,
                ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
                ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
                models: {
                    ...(fastModel.trim() ? { fast: fastModel.trim() } : {}),
                    balanced: balancedModel.trim(),
                    ...(strongModel.trim() ? { strong: strongModel.trim() } : {}),
                },
                isDefault,
            };
            const saved = selectedModelConfigId
                ? await updateModelConfig(selectedModelConfigId, payload)
                : await createModelConfig({
                    ...payload,
                    apiKey: apiKey.trim(),
                });
            setSelectedModelConfigId(saved.id);
            setExistingConfigs([saved, ...existingConfigs.filter((config) => config.id !== saved.id)]);
            setName(saved.name);
            setProvider(saved.provider);
            setBaseUrl(saved.baseUrl || '');
            setFastModel(saved.models.fast || '');
            setBalancedModel(saved.models.balanced || '');
            setStrongModel(saved.models.strong || '');
            setApiKeyPreview(saved.apiKeyPreview || apiKeyPreview);
            setApiKey('');
            return true;
        } catch (error) {
            setStatus(error instanceof Error ? error.message : text.modelSaveFailed);
            return false;
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveWorkspace = () => {
        setWorkspaceStatus('');
        setIsSavingWorkspace(true);
        try {
            const saved = setBeeGameWorkspaceRoot(workspacePath);
            setWorkspacePath(saved.workspacePath);
            return true;
        } catch (error) {
            setWorkspaceStatus(error instanceof Error ? error.message : text.workspaceSaveFailed);
            return false;
        } finally {
            setIsSavingWorkspace(false);
        }
    };

    const handleResetWorkspace = async () => {
        setWorkspaceStatus('');
        setIsSavingWorkspace(true);
        try {
            const next = await resetBeeGameWorkspaceRoot();
            setWorkspacePath(next.workspacePath);
        } catch (error) {
            setWorkspaceStatus(error instanceof Error ? error.message : text.workspaceResetFailed);
        } finally {
            setIsSavingWorkspace(false);
        }
    };

    const handleSaveWebTools = async () => {
        setWebToolsStatus('');
        setIsSavingWebTools(true);
        try {
            const saved = await saveWebToolsConfig({
                webSearchAdapter,
                ...(braveApiKey.trim() ? { braveApiKey: braveApiKey.trim() } : {}),
                ...(exaApiKey.trim() ? { exaApiKey: exaApiKey.trim() } : {}),
            });
            setWebSearchAdapter(saved.webSearchAdapter || webSearchAdapter);
            setBraveApiKeyPreview(saved.braveApiKeyPreview || '');
            setExaApiKeyPreview(saved.exaApiKeyPreview || '');
            setBraveApiKey('');
            setExaApiKey('');
            return true;
        } catch (error) {
            setWebToolsStatus(error instanceof Error ? error.message : text.webSearchSaveFailed);
            return false;
        } finally {
            setIsSavingWebTools(false);
        }
    };

    const handleSaveRuntimeSettings = async () => {
        setRuntimeSettingsStatus('');
        setIsSavingRuntimeSettings(true);
        try {
            const saved = await saveRuntimeSettings(runtimeSettings);
            setBeeGameSubagentsEnabled(subagentsEnabled);
            setRuntimeSettings(normalizeRuntimeSettings(saved));
            return true;
        } catch (error) {
            setRuntimeSettingsStatus(error instanceof Error ? error.message : 'Runtime settings save failed');
            return false;
        } finally {
            setIsSavingRuntimeSettings(false);
        }
    };

    const handleSaveMcpServer = async (
        formOverride: McpServerForm = mcpForm,
        options: { closeAfterSave?: boolean; testAfterSave?: boolean } = {},
    ) => {
        const closeAfterSave = options.closeAfterSave !== false;
        const testAfterSave = options.testAfterSave !== false;
        setMcpStatus('');
        setIsSavingMcp(true);
        try {
            const payload = mcpFormToInput(formOverride);
            const saved = formOverride.id
                ? await updateMcpServer(formOverride.id, payload)
                : await createMcpServer(payload);
            setMcpServers((current) => [
                saved,
                ...current.filter((server) => server.id !== saved.id),
            ]);
            if (closeAfterSave) {
                setMcpForm(mcpServerToForm(saved));
                setMcpFormAnchor(null);
            }
            if (testAfterSave) void handleTestMcpServer(saved);
            return true;
        } catch (error) {
            setMcpStatus(error instanceof Error ? error.message : 'MCP server save failed');
            return false;
        } finally {
            setIsSavingMcp(false);
        }
    };

    const handleEditMcpFormChange = (nextForm: McpServerForm) => {
        setMcpForm(nextForm);
        if (mcpAutoSaveTimerRef.current !== null) window.clearTimeout(mcpAutoSaveTimerRef.current);
        if (!isMcpFormSaveable(nextForm)) {
            mcpAutoSaveTimerRef.current = null;
            return;
        }
        mcpAutoSaveTimerRef.current = window.setTimeout(() => {
            mcpAutoSaveTimerRef.current = null;
            void handleSaveMcpServer(nextForm, { closeAfterSave: false, testAfterSave: false });
        }, 450);
    };

    const handleDeleteMcpServer = async (id: string) => {
        setMcpStatus('');
        setIsSavingMcp(true);
        try {
            await deleteMcpServer(id);
            setMcpServers((current) => {
                const next = current.filter((server) => server.id !== id);
                setMcpForm(createEmptyMcpForm());
                setMcpFormAnchor(null);
                return next;
            });
            setMcpHealthById((current) => {
                const next = { ...current };
                delete next[id];
                return next;
            });
        } catch (error) {
            setMcpStatus(error instanceof Error ? error.message : 'MCP server delete failed');
        } finally {
            setIsSavingMcp(false);
        }
    };

    const handleTestMcpServer = async (server: McpServerConfig) => {
        setMcpStatus('');
        setTestingMcpServerId(server.id);
        try {
            const result = await testMcpServer(mcpServerToInput(server));
            setMcpHealthById((current) => ({ ...current, [server.id]: result }));
        } catch (error) {
            setMcpHealthById((current) => ({
                ...current,
                [server.id]: {
                    ok: false,
                    status: 'unavailable',
                    message: error instanceof Error ? error.message : 'MCP connection test failed',
                    checkedAt: new Date().toISOString(),
                },
            }));
        } finally {
            setTestingMcpServerId('');
        }
    };

    const handleDiscoverActiveMcpServers = async () => {
        setMcpStatus('');
        setIsScanningActiveMcp(true);
        try {
            const discovered = await discoverActiveMcpServers();
            setActiveMcpServers(discovered);
            if (!discovered.length) setMcpStatus(mcpCopy.form.noActiveDiscovered);
        } catch (error) {
            setMcpStatus(error instanceof Error ? error.message : 'MCP active scan failed');
        } finally {
            setIsScanningActiveMcp(false);
        }
    };

    const handleImportDiscoveredMcpServer = async (server: DiscoveredMcpServer) => {
        setMcpStatus('');
        setIsSavingMcp(true);
        try {
            const payload = discoveredMcpServerToInput(server);
            const saved = await createMcpServer(payload);
            setMcpServers((current) => [
                saved,
                ...current.filter((item) => item.id !== saved.id),
            ]);
            void handleTestMcpServer(saved);
            setDiscoveredMcpServers((current) => current.map((item) => (
                item.name === server.name && item.sourcePath === server.sourcePath
                    ? { ...item, exists: true }
                    : item
            )));
        } catch (error) {
            setMcpStatus(error instanceof Error ? error.message : 'MCP server import failed');
        } finally {
            setIsSavingMcp(false);
        }
    };

    const handleImportActiveMcpServer = async (server: ActiveDiscoveredMcpServer) => {
        setMcpStatus('');
        setIsSavingMcp(true);
        try {
            const payload = discoveredMcpServerToInput(server);
            const saved = await createMcpServer(payload);
            setMcpServers((current) => [
                saved,
                ...current.filter((item) => item.id !== saved.id),
            ]);
            setMcpHealthById((current) => ({ ...current, [saved.id]: server.test }));
            setActiveMcpServers((current) => current.map((item) => (
                item.endpoint === server.endpoint
                    ? { ...item, exists: true }
                    : item
            )));
        } catch (error) {
            setMcpStatus(error instanceof Error ? error.message : 'MCP server import failed');
        } finally {
            setIsSavingMcp(false);
        }
    };

    const webSearchKeyField = getWebSearchKeyField(webSearchAdapter);
    const webSearchKeyPreview = webSearchKeyField === 'brave'
        ? braveApiKeyPreview
        : webSearchKeyField === 'exa'
            ? exaApiKeyPreview
            : '';
    const webSearchKeyValue = webSearchKeyField === 'brave'
        ? braveApiKey
        : webSearchKeyField === 'exa'
            ? exaApiKey
            : '';
    const savedPrefix = `${text.savedPrefix}${lang.startsWith('zh') ? '：' : ': '}`;
    const capabilityCopy = getRuntimeCapabilityCopy(lang);
    const mcpCopy = getMcpSettingsCopy(lang);
    const activeTabLabel = activeTab === 'general'
        ? text.settingsGeneral
        : activeTab === 'runtime'
            ? capabilityCopy.title
            : activeTab === 'mcp'
                ? mcpCopy.title
                : text.settingsModel;
    const isSavingCurrentTab = activeTab === 'general'
        ? isSavingWorkspace || isSavingWebTools
        : activeTab === 'runtime'
            ? isSavingRuntimeSettings
        : activeTab === 'mcp'
                ? false
            : isSaving;
    const isSaveDisabled = activeTab === 'general'
        ? isSavingCurrentTab ||
            !workspacePath.trim() ||
            (!!webSearchKeyField && !webSearchKeyValue.trim() && !webSearchKeyPreview)
        : activeTab === 'runtime'
            ? isSavingCurrentTab
        : activeTab === 'mcp'
                ? false
            : isSavingCurrentTab || !balancedModel.trim() || (!selectedModelConfigId && !apiKey.trim());

    const handleSaveSettings = async () => {
        if (activeTab === 'model') {
            const saved = await handleSaveModelConfig();
            if (saved) onClose();
            return;
        }
        if (activeTab === 'runtime') {
            const saved = await handleSaveRuntimeSettings();
            if (saved) onClose();
            return;
        }
        if (activeTab === 'mcp') return;
        const workspaceSaved = handleSaveWorkspace();
        const webToolsSaved = await handleSaveWebTools();
        if (workspaceSaved && webToolsSaved) onClose();
    };

    const updateRuntimeSetting = (key: keyof RuntimeSettingsConfig) => {
        setRuntimeSettings((current) => ({
            ...current,
            [key]: !current[key],
        }));
    };
    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    role="dialog"
                    aria-label={t.settings}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[220] flex items-center justify-center bg-zinc-950/55 p-4 text-zinc-950 backdrop-blur-sm dark:text-white"
                >
                    <motion.div
                        initial={{ opacity: 0, y: 16, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 16, scale: 0.98 }}
                        transition={{ duration: 0.22, ease: 'easeOut' }}
                        onClick={(event) => event.stopPropagation()}
                        data-testid="settings-modal-shell"
                        className="h-[min(620px,calc(100vh-2rem))] w-[min(820px,calc(100vw-2rem))] overflow-hidden rounded-[1.5rem] border border-zinc-800 bg-[#202124] shadow-2xl shadow-black/45"
                    >
                        <div className="flex h-full min-h-0">
                            <aside
                                data-testid="settings-modal-sidebar"
                                className="flex w-44 shrink-0 flex-col border-r border-zinc-700/70 bg-[#222326] p-3"
                            >
                                <div className="mb-4 flex items-center justify-between">
                                    <button
                                        type="button"
                                        aria-label={text.closeSettings}
                                        onClick={onClose}
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-800/80 text-zinc-200 transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                                <div className="space-y-1.5" role="tablist" aria-label={t.systemSettings}>
                                    {[
                                        { id: 'general' as const, label: text.settingsGeneral, icon: Globe },
                                        { id: 'runtime' as const, label: capabilityCopy.title, icon: Cpu },
                                        { id: 'mcp' as const, label: mcpCopy.title, icon: Network },
                                        { id: 'model' as const, label: text.settingsModel, icon: KeyRound },
                                    ].map((tab) => {
                                        const Icon = tab.icon;
                                        const selected = activeTab === tab.id;
                                        return (
                                            <button
                                                key={tab.id}
                                                type="button"
                                                role="tab"
                                                aria-selected={selected}
                                                onClick={() => setActiveTab(tab.id)}
                                                className={`flex h-10 w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 ${selected ? 'bg-zinc-700/70 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100'}`}
                                            >
                                                <Icon className="h-4 w-4" />
                                                {tab.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </aside>

                            <main data-testid="settings-modal-content" className="relative flex min-w-0 flex-1 flex-col">
                                <header className="shrink-0 px-6 pb-3 pt-5">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">
                                                {t.systemSettings}
                                            </div>
                                            <h2 className="mt-3 text-xl font-medium text-zinc-100">{activeTabLabel}</h2>
                                        </div>
                                        {activeTab === 'mcp' ? (
                                            <div className="relative mt-2">
                                                <button
                                                    type="button"
                                                    aria-label={mcpCopy.form.actions}
                                                    aria-haspopup="menu"
                                                    aria-expanded={isMcpActionMenuOpen}
                                                    onClick={(event) => {
                                                        if (!isMcpActionMenuOpen) {
                                                            setMcpFormAnchor(null);
                                                        }
                                                        setIsMcpActionMenuOpen((current) => !current);
                                                        event.currentTarget.dataset.anchor = 'mcp-actions';
                                                    }}
                                                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-700 bg-[#222326] text-zinc-100 shadow-sm shadow-black/20 transition-colors hover:bg-zinc-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60"
                                                >
                                                    <Plus className="h-4 w-4" />
                                                </button>
                                                {isMcpActionMenuOpen ? (
                                                    <>
                                                    <div
                                                        className="fixed inset-0 z-[250]"
                                                        onMouseDown={() => setIsMcpActionMenuOpen(false)}
                                                    />
                                                    <div
                                                        role="menu"
                                                        className="absolute right-0 top-12 z-[260] w-56 overflow-hidden rounded-2xl border border-zinc-700 bg-[#2b2c2f] p-1.5 shadow-2xl shadow-black/40"
                                                        onMouseDown={(event) => event.stopPropagation()}
                                                    >
                                                        <button
                                                            type="button"
                                                            role="menuitem"
                                                            onClick={() => {
                                                                setIsMcpActionMenuOpen(false);
                                                                void handleDiscoverActiveMcpServers();
                                                            }}
                                                            disabled={isScanningActiveMcp}
                                                            className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-bold text-zinc-100 transition-colors hover:bg-zinc-800/80 disabled:cursor-not-allowed disabled:opacity-50"
                                                        >
                                                            <Network className="h-4 w-4 text-orange-300" />
                                                            {isScanningActiveMcp ? mcpCopy.form.scanning : mcpCopy.form.scanActive}
                                                        </button>
                                                        <div className="my-1 h-px bg-zinc-700/70" />
                                                        <button
                                                            type="button"
                                                            role="menuitem"
                                                            onClick={(event) => {
                                                                const anchor = document.querySelector('[data-anchor="mcp-actions"]');
                                                                setMcpForm(createEmptyMcpForm());
                                                                setMcpStatus('');
                                                                setIsMcpActionMenuOpen(false);
                                                                setMcpFormAnchor({
                                                                    kind: 'new',
                                                                    rect: toPopoverAnchorRect((anchor ?? event.currentTarget).getBoundingClientRect()),
                                                                });
                                                            }}
                                                            className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-bold text-zinc-100 transition-colors hover:bg-zinc-800/80"
                                                        >
                                                            <Plus className="h-4 w-4 text-zinc-400" />
                                                            {mcpCopy.newServer}
                                                        </button>
                                                    </div>
                                                    </>
                                                ) : null}
                                                {mcpFormAnchor?.kind === 'new' ? (
                                                    <McpServerFormPopover
                                                        mode="create"
                                                        copy={mcpCopy}
                                                        form={mcpForm}
                                                        status={mcpStatus}
                                                        isSaving={isSavingMcp}
                                                        anchorRect={mcpFormAnchor.rect}
                                                        onChange={setMcpForm}
                                                        onClose={() => {
                                                            setMcpFormAnchor(null);
                                                            setMcpStatus('');
                                                        }}
                                                        onSave={() => void handleSaveMcpServer(mcpForm, { closeAfterSave: true })}
                                                    />
                                                ) : null}
                                            </div>
                                        ) : null}
                                    </div>
                                </header>

                                <div className="mx-6 h-px shrink-0 bg-zinc-700/70" />

                                <div
                                    data-testid="settings-modal-scroll-area"
                                    className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-2 [scrollbar-gutter:stable]"
                                >
                                {activeTab === 'general' ? (
                                    <div className="divide-y divide-zinc-700/60">
                                        <label className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center">
                                            <span className="flex items-center gap-2.5 text-sm font-medium text-zinc-100">
                                                <Globe className="h-4 w-4 text-zinc-400" />
                                                {t.language}
                                            </span>
                                            <select
                                                value={lang}
                                                onChange={(event) => onSetLang(event.target.value as Language)}
                                                className="h-10 w-full rounded-xl border border-zinc-700 bg-[#18191d] px-3 text-sm font-bold text-zinc-100 outline-none transition-colors focus:border-orange-500/70"
                                            >
                                                {LANGUAGE_OPTIONS.map((option) => (
                                                    <option key={option.code} value={option.code}>
                                                        {option.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>

                                        <div className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center">
                                            <span className="flex items-center gap-2.5 text-sm font-medium text-zinc-100">
                                                <FolderOpen className="h-4 w-4 text-zinc-400" />
                                                {text.workspacePath}
                                            </span>
                                            <div className="min-w-0 space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        aria-label={text.workspacePath}
                                                        value={workspacePath}
                                                        onChange={(event) => setWorkspacePath(event.target.value)}
                                                        placeholder="/absolute/path/to/Projects"
                                                        className="h-10 min-w-0 flex-1 rounded-xl border border-zinc-700 bg-[#18191d] px-3 font-mono text-xs text-zinc-100 outline-none focus:border-orange-500/70"
                                                    />
                                                    <button
                                                        type="button"
                                                        aria-label={text.resetDefault}
                                                        title={text.resetDefault}
                                                        onClick={handleResetWorkspace}
                                                        disabled={isSavingWorkspace}
                                                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-700 bg-[#18191d] text-zinc-300 transition-colors hover:bg-[#24252a] disabled:cursor-not-allowed disabled:opacity-50"
                                                    >
                                                        <RotateCcw className="h-4 w-4" />
                                                    </button>
                                                </div>
                                                {workspaceStatus ? (
                                                    <div className="text-xs text-emerald-400">{workspaceStatus}</div>
                                                ) : null}
                                            </div>
                                        </div>

                                        <div className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-start">
                                            <span className="flex items-center gap-2.5 text-sm font-medium text-zinc-100 sm:mt-2.5">
                                                <Search className="h-4 w-4 text-zinc-400" />
                                                {text.webSearch}
                                            </span>
                                            <div className="min-w-0 space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <select
                                                        aria-label={text.searchBackend}
                                                        value={webSearchAdapter}
                                                        onChange={(event) => setWebSearchAdapter(event.target.value as WebSearchAdapter)}
                                                        className="h-10 min-w-0 flex-1 rounded-xl border border-zinc-700 bg-[#18191d] px-3 text-sm text-zinc-100 outline-none focus:border-orange-500/70"
                                                    >
                                                        <option value="tavily">Tavily</option>
                                                        <option value="api">Anthropic API</option>
                                                        <option value="bing">Bing</option>
                                                        <option value="brave">Brave</option>
                                                        <option value="exa">Exa</option>
                                                    </select>
                                                </div>
                                                {webSearchKeyField ? (
                                                    <input
                                                        aria-label={webSearchKeyField === 'brave' ? 'BRAVE_SEARCH_API_KEY' : 'EXA_API_KEY'}
                                                        type="password"
                                                        value={webSearchKeyValue}
                                                        onChange={(event) => {
                                                            if (webSearchKeyField === 'brave') {
                                                                setBraveApiKey(event.target.value);
                                                            } else {
                                                                setExaApiKey(event.target.value);
                                                            }
                                                        }}
                                                        placeholder={webSearchKeyPreview ? `${savedPrefix}${webSearchKeyPreview}` : (webSearchKeyField === 'brave' ? 'BRAVE_SEARCH_API_KEY' : 'EXA_API_KEY')}
                                                        className="h-10 w-full rounded-xl border border-zinc-700 bg-[#18191d] px-3 text-sm text-zinc-100 outline-none focus:border-orange-500/70"
                                                    />
                                                ) : null}
                                                {webToolsStatus ? (
                                                    <div className="text-xs text-emerald-400">{webToolsStatus}</div>
                                                ) : null}
                                            </div>
                                        </div>
                                    </div>
                                ) : null}

                                {activeTab === 'runtime' ? (
                                    <div className="divide-y divide-zinc-700/60">
                                        <CapabilityToggleRow
                                            item={{
                                                key: 'subagents',
                                                label: text.subagents,
                                                description: capabilityCopy.subagents.description,
                                                note: capabilityCopy.subagents.note,
                                                scope: 'newSession',
                                            }}
                                            checked={subagentsEnabled}
                                            onToggle={() => setSubagentsEnabled((value) => !value)}
                                        />
                                        {getRuntimeCapabilityItems(capabilityCopy).map((item) => (
                                            <CapabilityToggleRow
                                                key={item.key}
                                                item={item}
                                                checked={runtimeSettings[item.key]}
                                                onToggle={() => updateRuntimeSetting(item.key)}
                                            />
                                        ))}
                                        {runtimeSettingsStatus ? (
                                            <div className="py-2 text-xs text-amber-300">{runtimeSettingsStatus}</div>
                                        ) : null}
                                    </div>
                                ) : null}

                                {activeTab === 'model' ? (
                                    <>
                                        <div className="divide-y divide-zinc-700/60">
                                            <label className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center">
                                                <span className="text-sm font-medium text-zinc-100">{text.provider}</span>
                                                <select
                                                    aria-label={text.provider}
                                                    value={provider}
                                                    onChange={(event) => setProvider(event.target.value as ModelProviderKind)}
                                                    className="h-10 w-full rounded-xl border border-zinc-700 bg-[#18191d] px-3 text-sm text-zinc-100 outline-none focus:border-orange-500/70"
                                                >
                                                    <option value="openai-compatible">OpenAI Compatible</option>
                                                    <option value="anthropic-compatible">Anthropic API Compatible</option>
                                                    <option value="gemini">Gemini</option>
                                                    <option value="grok">Grok</option>
                                                </select>
                                            </label>

                                            <label className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center">
                                                <span className="text-sm font-medium text-zinc-100">{text.baseUrl}</span>
                                                <input
                                                    aria-label={text.baseUrl}
                                                    value={baseUrl}
                                                    onChange={(event) => setBaseUrl(event.target.value)}
                                                    placeholder="https://api.example.com/v1"
                                                    className="h-10 w-full rounded-xl border border-zinc-700 bg-[#18191d] px-3 text-sm text-zinc-100 outline-none focus:border-orange-500/70"
                                                />
                                            </label>

                                            <label className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center">
                                                <span className="text-sm font-medium text-zinc-100">{text.apiKey}</span>
                                                <input
                                                    aria-label={text.apiKey}
                                                    type="password"
                                                    value={apiKey}
                                                    onChange={(event) => setApiKey(event.target.value)}
                                                    placeholder={apiKeyPreview ? `${savedPrefix}${apiKeyPreview}` : 'sk-...'}
                                                    className="h-10 w-full rounded-xl border border-zinc-700 bg-[#18191d] px-3 text-sm text-zinc-100 outline-none focus:border-orange-500/70"
                                                />
                                            </label>

                                            <div className="grid gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-start">
                                                <span className="text-sm font-medium text-zinc-100 sm:mt-2.5">{text.models}</span>
                                                <div className="grid gap-2">
                                                    <label className="grid gap-2 sm:grid-cols-[6rem_1fr] sm:items-center">
                                                        <span className="text-xs font-black uppercase tracking-[0.12em] text-zinc-500">{text.fast}</span>
                                                        <input
                                                            aria-label={text.fastModel}
                                                            value={fastModel}
                                                            onChange={(event) => setFastModel(event.target.value)}
                                                            placeholder="qwen3.5-flash"
                                                            className="h-10 w-full rounded-xl border border-zinc-700 bg-[#18191d] px-3 text-sm text-zinc-100 outline-none focus:border-orange-500/70"
                                                        />
                                                    </label>
                                                    <label className="grid gap-2 sm:grid-cols-[6rem_1fr] sm:items-center">
                                                        <span className="text-xs font-black uppercase tracking-[0.12em] text-zinc-500">{text.balanced}</span>
                                                        <input
                                                            aria-label={text.balancedModel}
                                                            value={balancedModel}
                                                            onChange={(event) => setBalancedModel(event.target.value)}
                                                            placeholder="qwen3.7-plus"
                                                            className="h-10 w-full rounded-xl border border-zinc-700 bg-[#18191d] px-3 text-sm text-zinc-100 outline-none focus:border-orange-500/70"
                                                        />
                                                    </label>
                                                    <label className="grid gap-2 sm:grid-cols-[6rem_1fr] sm:items-center">
                                                        <span className="text-xs font-black uppercase tracking-[0.12em] text-zinc-500">{text.strong}</span>
                                                        <input
                                                            aria-label={text.strongModel}
                                                            value={strongModel}
                                                            onChange={(event) => setStrongModel(event.target.value)}
                                                            placeholder="qwen3.7-max"
                                                            className="h-10 w-full rounded-xl border border-zinc-700 bg-[#18191d] px-3 text-sm text-zinc-100 outline-none focus:border-orange-500/70"
                                                        />
                                                    </label>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between gap-3">
                                            <span className="text-xs text-emerald-400">{status}</span>
                                        </div>
                                    </>
                                ) : null}
                                {activeTab === 'mcp' ? (
                                    <McpSettingsPanel
                                        copy={mcpCopy}
                                        servers={mcpServers}
                                        status={mcpStatus}
                                        isSaving={isSavingMcp}
                                        discovered={discoveredMcpServers}
                                        activeDiscovered={activeMcpServers}
                                        healthById={mcpHealthById}
                                        testingServerId={testingMcpServerId}
                                        onEdit={(server, rect) => {
                                            setMcpForm(mcpServerToForm(server));
                                            setMcpStatus('');
                                            setMcpFormAnchor({ kind: 'edit', serverId: server.id, rect });
                                        }}
                                        activeEditServerId={mcpFormAnchor?.kind === 'edit' ? mcpFormAnchor.serverId : ''}
                                        activeEditAnchorRect={mcpFormAnchor?.kind === 'edit' ? mcpFormAnchor.rect : null}
                                        form={mcpForm}
                                        onFormChange={handleEditMcpFormChange}
                                        onCloseForm={() => {
                                            if (mcpAutoSaveTimerRef.current !== null) {
                                                window.clearTimeout(mcpAutoSaveTimerRef.current);
                                                mcpAutoSaveTimerRef.current = null;
                                            }
                                            if (isMcpFormSaveable(mcpForm)) {
                                                void handleSaveMcpServer(mcpForm, { closeAfterSave: false, testAfterSave: false });
                                            }
                                            setMcpFormAnchor(null);
                                            setMcpStatus('');
                                        }}
                                        onSaveForm={() => void handleSaveMcpServer(mcpForm, { closeAfterSave: true })}
                                        onTest={(server) => void handleTestMcpServer(server)}
                                        onDelete={(id) => void handleDeleteMcpServer(id)}
                                        onImport={(server) => void handleImportDiscoveredMcpServer(server)}
                                        onImportActive={(server) => void handleImportActiveMcpServer(server)}
                                    />
                                ) : null}
                                </div>
                                {activeTab !== 'mcp' ? (
                                <div className="flex items-center justify-end border-t border-zinc-700/70 px-6 py-4">
                                    <button
                                        type="button"
                                        aria-label={text.saveSettings}
                                        onClick={handleSaveSettings}
                                        disabled={isSaveDisabled}
                                        className="inline-flex h-10 items-center rounded-xl bg-zinc-100 px-5 text-sm font-black text-zinc-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {isSavingCurrentTab ? text.saving : text.saveSettings}
                                    </button>
                                </div>
                                ) : null}
                            </main>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

function getWebSearchKeyField(adapter: WebSearchAdapter): 'brave' | 'exa' | null {
    if (adapter === 'brave') return 'brave';
    if (adapter === 'exa') return 'exa';
    return null;
}

function normalizeRuntimeSettings(config: RuntimeSettingsConfig): Required<RuntimeSettingsConfig> {
    return {
        autoMemoryEnabled: config.autoMemoryEnabled ?? true,
        autoDreamEnabled: config.autoDreamEnabled ?? true,
        skillSearchEnabled: config.skillSearchEnabled ?? false,
        treeSitterBashEnabled: config.treeSitterBashEnabled ?? false,
        webBrowserToolEnabled: config.webBrowserToolEnabled ?? false,
        bashClassifierEnabled: config.bashClassifierEnabled ?? false,
        mcpSkillsEnabled: config.mcpSkillsEnabled ?? false,
    };
}

function createEmptyMcpForm(): McpServerForm {
    return {
        id: '',
        name: '',
        enabled: true,
        transport: 'stdio',
        scope: 'beegame',
        command: '',
        argsText: '',
        url: '',
        cwd: '',
        envText: '',
        autoStart: true,
    };
}

function mcpServerToForm(server: McpServerConfig): McpServerForm {
    return {
        id: server.id,
        name: server.name,
        enabled: server.enabled,
        transport: server.transport,
        scope: server.scope,
        command: server.command || '',
        argsText: (server.args || []).join('\n'),
        url: server.url || '',
        cwd: server.cwd || '',
        envText: (server.env || [])
            .map((item) => `${item.key}=${item.value || ''}`)
            .join('\n'),
        autoStart: server.autoStart !== false,
    };
}

function mcpFormToInput(form: McpServerForm): McpServerInput {
    return {
        ...(form.id ? { id: form.id } : {}),
        name: form.name.trim(),
        enabled: form.enabled,
        transport: form.transport,
        scope: form.scope,
        ...(form.transport === 'stdio'
            ? {
                command: form.command.trim(),
                args: form.argsText
                    .split('\n')
                    .map((item) => item.trim())
                    .filter(Boolean),
            }
            : { url: form.url.trim() }),
        ...(form.cwd.trim() ? { cwd: form.cwd.trim() } : {}),
        env: form.envText
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
                const [key, ...rest] = line.split('=');
                return {
                    key: key.trim(),
                    value: rest.join('=').trim(),
                };
            })
            .filter((item) => item.key),
        autoStart: form.autoStart,
    };
}

function isMcpFormSaveable(form: McpServerForm): boolean {
    return Boolean(form.name.trim()) &&
        (form.transport === 'stdio' ? Boolean(form.command.trim()) : Boolean(form.url.trim()));
}

function mcpServerToInput(server: McpServerConfig): McpServerInput {
    return {
        id: server.id,
        name: server.name,
        enabled: server.enabled,
        transport: server.transport,
        scope: server.scope,
        ...(server.command ? { command: server.command } : {}),
        ...(server.args ? { args: server.args } : {}),
        ...(server.url ? { url: server.url } : {}),
        ...(server.cwd ? { cwd: server.cwd } : {}),
        ...(server.env ? { env: server.env } : {}),
        autoStart: server.autoStart,
    };
}

function discoveredMcpServerToInput(server: DiscoveredMcpServer | ActiveDiscoveredMcpServer): McpServerInput {
    return {
        name: server.name,
        enabled: server.enabled,
        transport: server.transport,
        scope: server.scope,
        ...(server.command ? { command: server.command } : {}),
        ...(server.args ? { args: server.args } : {}),
        ...(server.url ? { url: server.url } : {}),
        ...(server.cwd ? { cwd: server.cwd } : {}),
        ...(server.env ? { env: server.env } : {}),
        autoStart: server.autoStart,
    };
}

type RuntimeCapabilityCopy = {
    title: string;
    subagents: {
        description: string;
        note: string;
    };
    items: Record<keyof RuntimeSettingsConfig, {
        label: string;
        description: string;
        note: string;
        scope: 'immediate' | 'newSession' | 'restart';
    }>;
};

type RuntimeCapabilityItem = {
    key: keyof RuntimeSettingsConfig | 'subagents';
    label: string;
    description: string;
    note: string;
    scope: 'immediate' | 'newSession' | 'restart';
};

type RuntimeSettingsCapabilityItem = RuntimeCapabilityItem & {
    key: keyof RuntimeSettingsConfig;
};

type RuntimeCapabilityTextBundle = {
    title: string;
    subagents: [string, string];
    memory: [string, string];
    dream: [string, string];
    skill: [string, string];
    ast: [string, string];
    web: [string, string];
    bash: [string, string];
    mcp: [string, string];
};

type McpSettingsCopy = {
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

type McpSettingsContentCopy = Omit<McpSettingsCopy, 'configured' | 'newServer' | 'noServers' | 'form'>;

function getMcpHealthLabel(
    copy: McpSettingsCopy,
    health: McpServerTestResult | undefined,
    isTesting: boolean,
): string {
    if (isTesting) return copy.form.testingConnection;
    if (!health) return copy.form.untested;
    return health.ok ? copy.form.available : copy.form.unavailable;
}

function getMcpHealthClass(
    health: McpServerTestResult | undefined,
    isTesting: boolean,
): string {
    if (isTesting) return 'font-bold text-orange-300';
    if (!health) return 'font-bold text-zinc-500';
    return health.ok ? 'font-bold text-emerald-400' : 'font-bold text-red-400';
}

function getRuntimeCapabilityCopy(lang: Language): RuntimeCapabilityCopy {
    if (lang === 'zh-TW') {
        return {
            title: '能力',
            subagents: {
                description: '允許 BeeGame 在需要時委派獨立子任務。',
                note: '適合較複雜的建置與驗證；簡單任務通常會維持單一代理。',
            },
            items: {
                autoMemoryEnabled: {
                    label: 'Auto Memory',
                    description: '記住偏好、專案決策與常用上下文。',
                    note: '會產生少量背景寫入與 token 消耗；敏感專案可關閉。',
                    scope: 'newSession',
                },
                autoDreamEnabled: {
                    label: 'Auto Dream',
                    description: '定期整理長期記憶，減少重複與過期資訊。',
                    note: '達到時間與會話數條件後才會在背景執行。',
                    scope: 'newSession',
                },
                skillSearchEnabled: {
                    label: 'Skill Search',
                    description: '依照任務自動尋找相關技能。',
                    note: '會增加輕量檢索開銷，偶爾可能匹配不夠相關的技能。',
                    scope: 'newSession',
                },
                treeSitterBashEnabled: {
                    label: 'Bash AST 解析',
                    description: '用 AST 理解 Bash 結構與注入風險。',
                    note: '需要 runtime 帶 FEATURE_TREE_SITTER_BASH 啟動；複雜命令會更保守。',
                    scope: 'restart',
                },
                webBrowserToolEnabled: {
                    label: '網頁讀取工具',
                    description: '讓 runtime 讀取網頁 HTML 文字。',
                    note: '適合查文件與頁面標題；不是完整瀏覽器，不能點擊或執行 JS。',
                    scope: 'restart',
                },
                bashClassifierEnabled: {
                    label: 'Bash 命令分類器',
                    description: '用模型輔助判斷 Bash 命令風險。',
                    note: '可減少重複確認，但會增加模型呼叫；分類錯誤會影響權限體驗。',
                    scope: 'restart',
                },
                mcpSkillsEnabled: {
                    label: 'MCP 技能發現',
                    description: '把 MCP 暴露的 skill:// 資源納入技能體系。',
                    note: '效果取決於 MCP server 的資源品質，需要 feature 啟動。',
                    scope: 'restart',
                },
            },
        };
    }
    if (lang === 'zh') {
        return {
            title: '能力',
            subagents: {
                description: '允许 BeeGame 在需要时委派独立子任务。',
                note: '适合较复杂的构建和验证；简单任务通常不会主动使用。',
            },
            items: {
                autoMemoryEnabled: {
                    label: 'Auto Memory',
                    description: '记住偏好、项目决策和常用上下文。',
                    note: '会产生少量后台写入和 token 消耗；敏感项目可关闭。',
                    scope: 'newSession',
                },
                autoDreamEnabled: {
                    label: 'Auto Dream',
                    description: '定期整理长期记忆，减少重复和过期信息。',
                    note: '满足时间和会话数量条件后才会后台运行。',
                    scope: 'newSession',
                },
                skillSearchEnabled: {
                    label: 'Skill Search',
                    description: '根据任务自动查找相关技能。',
                    note: '会增加轻量检索开销，偶尔可能匹配到不够相关的技能。',
                    scope: 'newSession',
                },
                treeSitterBashEnabled: {
                    label: 'Bash AST 解析',
                    description: '用 AST 理解 Bash 结构和注入风险。',
                    note: '需要 runtime 带 FEATURE_TREE_SITTER_BASH 启动；复杂命令会更保守。',
                    scope: 'restart',
                },
                webBrowserToolEnabled: {
                    label: '网页读取工具',
                    description: '让 runtime 读取网页 HTML 文本。',
                    note: '适合查文档和页面标题；不是完整浏览器，不能点击或执行 JS。',
                    scope: 'restart',
                },
                bashClassifierEnabled: {
                    label: 'Bash 命令分类器',
                    description: '用模型辅助判断 Bash 命令风险。',
                    note: '可减少重复确认，但会增加模型调用；分类错误会影响权限体验。',
                    scope: 'restart',
                },
                mcpSkillsEnabled: {
                    label: 'MCP 技能发现',
                    description: '把 MCP 暴露的 skill:// 资源纳入技能体系。',
                    note: '效果取决于 MCP server 的资源质量，需要 feature 启动。',
                    scope: 'restart',
                },
            },
        };
    }
    const localized: Partial<Record<Language, RuntimeCapabilityTextBundle>> = {
        ja: {
            title: '機能',
            subagents: ['必要に応じて BeeGame が独立したサブタスクを委任できます。', '大きな実装や検証向きです。単純な作業は通常単一エージェントのままです。'],
            memory: ['設定、プロジェクト判断、よく使う文脈を記憶します。', '少量のバックグラウンド書き込みと token 消費があります。機密プロジェクトでは無効にできます。'],
            dream: ['長期記憶を整理し、重複や古い情報を減らします。', '時間とセッション数の条件を満たした後にバックグラウンドで実行されます。'],
            skill: ['現在のタスクに合うスキルを自動で探します。', '軽い検索コストがあり、まれに弱い一致を選ぶことがあります。'],
            ast: ['AST で Bash 構造と注入リスクを理解します。', 'FEATURE_TREE_SITTER_BASH 付きで runtime を起動する必要があります。複雑な命令はより保守的になります。'],
            web: ['runtime が Web ページの HTML テキストを読めるようにします。', 'ドキュメント確認向きです。クリック、入力、JS 実行を行う完全なブラウザではありません。'],
            bash: ['モデルで Bash コマンドのリスク判断を補助します。', '承認の繰り返しを減らせますが、モデル呼び出しが増えます。誤分類は権限体験に影響します。'],
            mcp: ['MCP の skill:// リソースをスキル体系に含めます。', '品質は MCP server のリソースに依存し、feature 起動が必要です。'],
        },
        ko: {
            title: '기능',
            subagents: ['필요할 때 BeeGame이 독립 하위 작업을 위임할 수 있습니다.', '큰 구현과 검증에 적합합니다. 단순 작업은 보통 단일 에이전트로 유지됩니다.'],
            memory: ['선호, 프로젝트 결정, 자주 쓰는 맥락을 기억합니다.', '소량의 백그라운드 쓰기와 token 비용이 있습니다. 민감한 프로젝트에서는 끌 수 있습니다.'],
            dream: ['장기 기억을 정리해 중복과 오래된 정보를 줄입니다.', '시간과 세션 수 조건을 만족한 뒤 백그라운드로 실행됩니다.'],
            skill: ['현재 작업에 맞는 스킬을 자동으로 찾습니다.', '가벼운 검색 비용이 있으며 가끔 약한 매칭을 고를 수 있습니다.'],
            ast: ['AST로 Bash 구조와 주입 위험을 이해합니다.', 'runtime을 FEATURE_TREE_SITTER_BASH와 함께 시작해야 합니다. 복잡한 명령은 더 보수적으로 처리됩니다.'],
            web: ['runtime이 웹페이지 HTML 텍스트를 읽을 수 있게 합니다.', '문서와 페이지 확인에 적합합니다. 클릭, 입력, JS 실행이 되는 전체 브라우저는 아닙니다.'],
            bash: ['모델로 Bash 명령 위험 판단을 보조합니다.', '반복 승인을 줄일 수 있지만 모델 호출이 늘어납니다. 잘못된 분류는 권한 흐름에 영향을 줍니다.'],
            mcp: ['MCP의 skill:// 리소스를 스킬 시스템에 포함합니다.', '품질은 MCP server 리소스에 달려 있으며 feature 시작이 필요합니다.'],
        },
        fr: {
            title: 'Capacités',
            subagents: ['Autorise BeeGame à déléguer des sous-tâches indépendantes quand c’est utile.', 'Adapté aux travaux de build et de vérification plus larges. Les tâches simples restent souvent mono-agent.'],
            memory: ['Mémorise les préférences, décisions de projet et contexte utile.', 'Ajoute de petites écritures en arrière-plan et un coût token. À désactiver pour les projets sensibles.'],
            dream: ['Consolide la mémoire longue durée et réduit les doublons obsolètes.', 'S’exécute en arrière-plan après des seuils de temps et de sessions.'],
            skill: ['Trouve automatiquement les skills pertinents pour la tâche.', 'Ajoute une légère recherche et peut parfois choisir une correspondance faible.'],
            ast: ['Comprend la structure Bash et les risques d’injection via AST.', 'Nécessite FEATURE_TREE_SITTER_BASH au démarrage du runtime. Les commandes complexes deviennent plus prudentes.'],
            web: ['Permet au runtime de lire le texte HTML des pages web.', 'Utile pour la documentation. Ce n’est pas un navigateur complet avec clic, saisie ou JS.'],
            bash: ['Utilise un modèle pour classifier le risque des commandes Bash.', 'Peut réduire les validations répétées mais ajoute des appels modèle. Une mauvaise classification affecte les permissions.'],
            mcp: ['Inclut les ressources skill:// MCP dans le système de skills.', 'La qualité dépend des ressources du MCP server et nécessite le feature au démarrage.'],
        },
        de: {
            title: 'Fähigkeiten',
            subagents: ['Erlaubt BeeGame, bei Bedarf unabhängige Teilaufgaben zu delegieren.', 'Gut für größere Builds und Prüfungen. Einfache Aufgaben bleiben meist bei einem Agenten.'],
            memory: ['Merkt sich Präferenzen, Projektentscheidungen und nützlichen Kontext.', 'Verursacht kleine Hintergrundschreibvorgänge und Token-Kosten. Für sensible Projekte abschaltbar.'],
            dream: ['Konsolidiert Langzeitgedächtnis und reduziert veraltete Duplikate.', 'Läuft erst nach Zeit- und Sitzungsschwellen im Hintergrund.'],
            skill: ['Findet automatisch passende Skills für die aktuelle Aufgabe.', 'Fügt leichte Suchkosten hinzu und kann gelegentlich schwache Treffer wählen.'],
            ast: ['Versteht Bash-Struktur und Injection-Risiken mit AST.', 'Benötigt FEATURE_TREE_SITTER_BASH beim Runtime-Start. Komplexe Befehle werden konservativer.'],
            web: ['Lässt die Runtime HTML-Text von Webseiten lesen.', 'Gut für Dokumentation und Seitenprüfungen. Kein vollständiger Browser mit Klick, Eingabe oder JS.'],
            bash: ['Nutzt ein Modell zur Risiko-Klassifizierung von Bash-Befehlen.', 'Kann wiederholte Freigaben reduzieren, erhöht aber Modellaufrufe. Fehlklassifizierung beeinflusst Berechtigungen.'],
            mcp: ['Bindet MCP skill:// Ressourcen in das Skill-System ein.', 'Qualität hängt von MCP-server-Ressourcen ab und benötigt Feature-Start.'],
        },
        es: {
            title: 'Capacidades',
            subagents: ['Permite a BeeGame delegar subtareas independientes cuando conviene.', 'Útil para builds y verificaciones grandes. Las tareas simples suelen quedar en un solo agente.'],
            memory: ['Recuerda preferencias, decisiones del proyecto y contexto útil.', 'Añade pequeñas escrituras en segundo plano y coste de tokens. Desactívalo en proyectos sensibles.'],
            dream: ['Consolida memoria a largo plazo y reduce duplicados obsoletos.', 'Se ejecuta en segundo plano tras umbrales de tiempo y sesiones.'],
            skill: ['Encuentra automáticamente skills relevantes para la tarea.', 'Añade una búsqueda ligera y a veces puede elegir una coincidencia débil.'],
            ast: ['Entiende la estructura Bash y riesgos de inyección con AST.', 'Requiere FEATURE_TREE_SITTER_BASH al iniciar runtime. Los comandos complejos serán más conservadores.'],
            web: ['Permite al runtime leer texto HTML de páginas web.', 'Útil para docs y comprobaciones. No es navegador completo con clic, escritura o JS.'],
            bash: ['Usa un modelo para clasificar el riesgo de comandos Bash.', 'Puede reducir aprobaciones repetidas pero añade llamadas al modelo. Una mala clasificación afecta permisos.'],
            mcp: ['Incluye recursos MCP skill:// en el sistema de skills.', 'La calidad depende del MCP server y requiere iniciar con feature.'],
        },
        it: {
            title: 'Capacità',
            subagents: ['Permette a BeeGame di delegare sotto-attività indipendenti quando serve.', 'Adatto a build e verifiche più ampie. Le attività semplici restano di solito su un solo agente.'],
            memory: ['Ricorda preferenze, decisioni di progetto e contesto utile.', 'Aggiunge piccole scritture in background e costo token. Disattivabile per progetti sensibili.'],
            dream: ['Consolida la memoria a lungo termine e riduce duplicati obsoleti.', 'Parte in background solo dopo soglie di tempo e sessioni.'],
            skill: ['Trova automaticamente skill rilevanti per il task.', 'Aggiunge una ricerca leggera e può scegliere a volte un match debole.'],
            ast: ['Comprende struttura Bash e rischi di injection con AST.', 'Richiede FEATURE_TREE_SITTER_BASH all’avvio runtime. I comandi complessi diventano più prudenti.'],
            web: ['Permette al runtime di leggere testo HTML dalle pagine web.', 'Utile per documenti e controlli pagina. Non è un browser completo con click, input o JS.'],
            bash: ['Usa un modello per classificare il rischio dei comandi Bash.', 'Può ridurre approvazioni ripetute ma aggiunge chiamate modello. Errori influenzano i permessi.'],
            mcp: ['Include risorse MCP skill:// nel sistema skill.', 'La qualità dipende dalle risorse del MCP server e richiede feature all’avvio.'],
        },
        pt: {
            title: 'Capacidades',
            subagents: ['Permite que o BeeGame delegue subtarefas independentes quando útil.', 'Bom para builds e verificações maiores. Tarefas simples geralmente ficam com um agente.'],
            memory: ['Lembra preferências, decisões de projeto e contexto útil.', 'Adiciona pequenas escritas em segundo plano e custo de tokens. Desative em projetos sensíveis.'],
            dream: ['Consolida memória de longo prazo e reduz duplicados antigos.', 'Executa em segundo plano após limites de tempo e sessões.'],
            skill: ['Encontra automaticamente skills relevantes para a tarefa.', 'Adiciona busca leve e pode ocasionalmente escolher um match fraco.'],
            ast: ['Entende estrutura Bash e riscos de injeção com AST.', 'Requer FEATURE_TREE_SITTER_BASH no início do runtime. Comandos complexos ficam mais conservadores.'],
            web: ['Permite ao runtime ler texto HTML de páginas web.', 'Bom para docs e verificações. Não é navegador completo com clique, digitação ou JS.'],
            bash: ['Usa um modelo para classificar risco de comandos Bash.', 'Pode reduzir aprovações repetidas, mas adiciona chamadas ao modelo. Classificação ruim afeta permissões.'],
            mcp: ['Inclui recursos MCP skill:// no sistema de skills.', 'A qualidade depende dos recursos do MCP server e requer feature no início.'],
        },
    };

    const fallbackCopy: RuntimeCapabilityTextBundle = {
        title: 'Capabilities',
        subagents: ['Allow BeeGame to delegate independent sub-tasks when useful.', 'Best for larger build and verification work. Simple tasks usually stay single-agent.'],
        memory: ['Remember preferences, project decisions, and useful context.', 'Adds small background writes and token cost. Disable for sensitive projects.'],
        dream: ['Consolidate long-term memories and reduce stale duplicates.', 'Runs in the background only after time and session thresholds are met.'],
        skill: ['Find relevant skills automatically for the current task.', 'Adds light search overhead and can occasionally pick a weak match.'],
        ast: ['Understand Bash structure and injection risks with an AST.', 'Requires FEATURE_TREE_SITTER_BASH at runtime startup. Complex commands become more conservative.'],
        web: ['Let the runtime read webpage HTML text.', 'Good for docs and page checks. Not a full browser with click, type, or JS.'],
        bash: ['Use a model to classify Bash command risk.', 'Can reduce repeated approvals but adds model calls. Bad classification affects permissions.'],
        mcp: ['Include MCP skill:// resources in the skill system.', 'Quality depends on the MCP server resources and requires feature startup.'],
    };

    return makeRuntimeCapabilityCopy(localized[lang] ?? fallbackCopy, lang);
}

function getMcpSettingsCopy(lang: Language): McpSettingsCopy {
    const copies: Partial<Record<Language, McpSettingsContentCopy>> = {
        zh: {
            title: 'MCP',
            intro: '通过 MCP，BeeGame 可以连接本机正在运行的编辑器、游戏引擎和工具服务。你可以在这里发现本机服务、添加 Server，并确认连接是否可用。',
            rows: [
                {
                    title: 'Server 配置',
                    description: '在 runtime 的 MCP 配置中管理 server。',
                    note: 'dashboard 目前没有后端路由可以安全地读取、写入或重启 MCP server。',
                },
                {
                    title: '项目资源集成',
                    description: 'Unity、Godot、Blender 等项目可在 asset manifest 中声明 mcp 和 mcp_server。',
                    note: '交付物面板会显示这些资源集成信息，但不会假装 editor 已连接。',
                },
                {
                    title: '技能发现',
                    description: '在“能力”页开启 MCP 技能发现后，runtime 可把 skill:// 资源纳入技能体系。',
                    note: '这只影响新启动的 BeeGame turn，并依赖实际可用的 MCP server。',
                },
            ],
        },
        'zh-TW': {
            title: 'MCP',
            intro: '透過 MCP，BeeGame 可以連接本機正在執行的編輯器、遊戲引擎和工具服務。你可以在這裡尋找本機服務、新增 Server，並確認連線是否可用。',
            rows: [
                {
                    title: 'Server 設定',
                    description: '在 runtime 的 MCP 設定中管理 server。',
                    note: 'dashboard 目前沒有後端路由可以安全讀取、寫入或重啟 MCP server。',
                },
                {
                    title: '專案資源整合',
                    description: 'Unity、Godot、Blender 等專案可在 asset manifest 中宣告 mcp 與 mcp_server。',
                    note: '交付物面板會顯示這些資源整合資訊，但不會假裝 editor 已連線。',
                },
                {
                    title: '技能發現',
                    description: '在「能力」頁開啟 MCP 技能發現後，runtime 可把 skill:// 資源納入技能體系。',
                    note: '這只影響新啟動的 BeeGame turn，並依賴實際可用的 MCP server。',
                },
            ],
        },
        en: {
            title: 'MCP',
            intro: 'MCP lets BeeGame connect to local editors, game engines, and tool services. Use this page to find local services, add servers, and confirm that each connection works.',
            rows: [
                {
                    title: 'Server configuration',
                    description: 'Manage MCP servers in the runtime MCP configuration.',
                    note: 'The dashboard does not yet have backend routes to safely read, write, or restart MCP servers.',
                },
                {
                    title: 'Project asset integration',
                    description: 'Unity, Godot, Blender, and similar projects can declare mcp and mcp_server in asset manifests.',
                    note: 'The deliverables panel shows this integration metadata without pretending the editor is connected.',
                },
                {
                    title: 'Skill discovery',
                    description: 'Enable MCP skills in Capabilities to let the runtime include skill:// resources.',
                    note: 'This affects newly started BeeGame turns and depends on the available MCP servers.',
                },
            ],
        },
        ja: {
            title: 'MCP',
            intro: 'MCP は外部エディタ、エンジン、ツールを BeeGame runtime に接続します。現在の dashboard は入口と境界を示し、server 管理は runtime 設定側に残します。',
            rows: [
                {
                    title: 'Server 設定',
                    description: 'MCP server は runtime の MCP 設定で管理します。',
                    note: 'dashboard には MCP server を安全に読み書き、再起動する後端ルートがまだありません。',
                },
                {
                    title: 'プロジェクト資源連携',
                    description: 'Unity、Godot、Blender などのプロジェクトは asset manifest で mcp と mcp_server を宣言できます。',
                    note: '成果物パネルはこの連携情報を表示しますが、editor が接続済みとは扱いません。',
                },
                {
                    title: 'スキル発見',
                    description: '「機能」で MCP skills を有効にすると、runtime は skill:// リソースを含められます。',
                    note: '新しく開始する BeeGame turn にだけ影響し、実際に利用可能な MCP server に依存します。',
                },
            ],
        },
        ko: {
            title: 'MCP',
            intro: 'MCP는 외부 에디터, 엔진, 도구를 BeeGame runtime에 연결합니다. 현재 dashboard는 진입점과 범위를 보여주며 server 관리는 runtime 설정에 남깁니다.',
            rows: [
                {
                    title: 'Server 설정',
                    description: 'MCP server는 runtime MCP 설정에서 관리합니다.',
                    note: 'dashboard에는 아직 MCP server를 안전하게 읽고 쓰거나 재시작하는 백엔드 라우트가 없습니다.',
                },
                {
                    title: '프로젝트 리소스 통합',
                    description: 'Unity, Godot, Blender 같은 프로젝트는 asset manifest에 mcp와 mcp_server를 선언할 수 있습니다.',
                    note: '결과물 패널은 이 통합 정보를 표시하지만 editor가 연결됐다고 가정하지 않습니다.',
                },
                {
                    title: '스킬 발견',
                    description: '기능 탭에서 MCP skills를 켜면 runtime이 skill:// 리소스를 포함할 수 있습니다.',
                    note: '새로 시작하는 BeeGame turn에만 적용되며 실제 사용 가능한 MCP server에 의존합니다.',
                },
            ],
        },
        fr: {
            title: 'MCP',
            intro: 'MCP connecte les éditeurs, moteurs et outils externes au runtime BeeGame. Le dashboard expose aujourd’hui l’entrée et les limites ; la gestion des servers reste dans la configuration runtime.',
            rows: [
                {
                    title: 'Configuration server',
                    description: 'Gérez les MCP servers dans la configuration MCP du runtime.',
                    note: 'Le dashboard n’a pas encore de routes backend pour lire, écrire ou redémarrer les MCP servers en sécurité.',
                },
                {
                    title: 'Intégration des ressources',
                    description: 'Les projets Unity, Godot, Blender, etc. peuvent déclarer mcp et mcp_server dans l’asset manifest.',
                    note: 'Le panneau des livrables affiche ces métadonnées sans prétendre que l’éditeur est connecté.',
                },
                {
                    title: 'Découverte de skills',
                    description: 'Activez MCP skills dans Capacités pour inclure les ressources skill:// dans le runtime.',
                    note: 'Cela ne concerne que les nouveaux tours BeeGame et dépend des MCP servers disponibles.',
                },
            ],
        },
        de: {
            title: 'MCP',
            intro: 'MCP verbindet externe Editoren, Engines und Tools mit der BeeGame Runtime. Das Dashboard zeigt derzeit Einstieg und Grenzen; Server-Verwaltung bleibt in Runtime-Konfiguration.',
            rows: [
                {
                    title: 'Server-Konfiguration',
                    description: 'Verwalte MCP server in der MCP-Konfiguration der Runtime.',
                    note: 'Das Dashboard hat noch keine Backend-Routen zum sicheren Lesen, Schreiben oder Neustarten von MCP servern.',
                },
                {
                    title: 'Projekt-Ressourcen',
                    description: 'Unity-, Godot-, Blender- und ähnliche Projekte können mcp und mcp_server im asset manifest deklarieren.',
                    note: 'Das Ergebnisse-Panel zeigt diese Metadaten, ohne eine verbundene Editor-Sitzung vorzutäuschen.',
                },
                {
                    title: 'Skill-Erkennung',
                    description: 'Aktiviere MCP skills unter Fähigkeiten, damit die Runtime skill:// Ressourcen einbeziehen kann.',
                    note: 'Das wirkt nur für neu gestartete BeeGame turns und hängt von verfügbaren MCP servern ab.',
                },
            ],
        },
        es: {
            title: 'MCP',
            intro: 'MCP conecta editores, motores y herramientas externas al runtime de BeeGame. El dashboard muestra por ahora la entrada y sus límites; la gestión de servers sigue en la configuración del runtime.',
            rows: [
                {
                    title: 'Configuración de server',
                    description: 'Gestiona MCP servers en la configuración MCP del runtime.',
                    note: 'El dashboard todavía no tiene rutas backend para leer, escribir o reiniciar MCP servers con seguridad.',
                },
                {
                    title: 'Integración de recursos',
                    description: 'Proyectos Unity, Godot, Blender y similares pueden declarar mcp y mcp_server en el asset manifest.',
                    note: 'El panel de entregables muestra esos metadatos sin simular que el editor está conectado.',
                },
                {
                    title: 'Descubrimiento de skills',
                    description: 'Activa MCP skills en Capacidades para que el runtime incluya recursos skill://.',
                    note: 'Solo afecta a nuevos turnos de BeeGame y depende de los MCP servers disponibles.',
                },
            ],
        },
        it: {
            title: 'MCP',
            intro: 'MCP collega editor, engine e strumenti esterni al runtime BeeGame. Il dashboard oggi espone l’ingresso e i confini; la gestione dei server resta nella configurazione runtime.',
            rows: [
                {
                    title: 'Configurazione server',
                    description: 'Gestisci MCP server nella configurazione MCP del runtime.',
                    note: 'Il dashboard non ha ancora route backend per leggere, scrivere o riavviare MCP server in sicurezza.',
                },
                {
                    title: 'Integrazione risorse',
                    description: 'Progetti Unity, Godot, Blender e simili possono dichiarare mcp e mcp_server nell’asset manifest.',
                    note: 'Il pannello consegne mostra questi metadati senza fingere che l’editor sia connesso.',
                },
                {
                    title: 'Scoperta skill',
                    description: 'Attiva MCP skills in Capacità per includere risorse skill:// nel runtime.',
                    note: 'Vale solo per nuovi turn BeeGame e dipende dagli MCP server disponibili.',
                },
            ],
        },
        pt: {
            title: 'MCP',
            intro: 'MCP conecta editores, engines e ferramentas externas ao runtime do BeeGame. O dashboard hoje mostra a entrada e os limites; a gestão de servers continua na configuração do runtime.',
            rows: [
                {
                    title: 'Configuração de server',
                    description: 'Gerencie MCP servers na configuração MCP do runtime.',
                    note: 'O dashboard ainda não tem rotas backend para ler, gravar ou reiniciar MCP servers com segurança.',
                },
                {
                    title: 'Integração de recursos',
                    description: 'Projetos Unity, Godot, Blender e similares podem declarar mcp e mcp_server no asset manifest.',
                    note: 'O painel de entregáveis mostra esses metadados sem fingir que o editor está conectado.',
                },
                {
                    title: 'Descoberta de skills',
                    description: 'Ative MCP skills em Capacidades para o runtime incluir recursos skill://.',
                    note: 'Isso afeta apenas novos turnos BeeGame e depende dos MCP servers disponíveis.',
                },
            ],
        },
    };
    return {
        ...(copies[lang] ?? copies.en!),
        ...getMcpSettingsChromeCopy(lang),
    };
}

function getMcpSettingsChromeCopy(lang: Language): Pick<McpSettingsCopy, 'configured' | 'newServer' | 'noServers' | 'form'> {
    if (lang === 'zh') {
        return {
            configured: '已配置',
            newServer: '新增 Server',
            noServers: '暂无 MCP server',
            form: {
                name: '名称',
                enabled: '启用',
                transport: '传输',
                scope: '作用域',
                command: '命令',
                args: '参数',
                url: 'URL',
                cwd: '工作目录',
                env: '环境变量',
                argsHint: '每行一个参数',
                envHint: '每行一个 KEY=value；已保存的密钥留空会继续保留',
                stdio: 'stdio',
                sse: 'SSE',
                http: 'HTTP',
                beegame: 'BeeGame',
                global: '全局',
                project: '项目',
                edit: '编辑',
                delete: '删除',
                cancel: '取消',
                save: '保存 Server',
                saving: '保存中',
                scanLocal: '导入配置',
                scanActive: '发现本机服务',
                scanning: '扫描中',
                discovered: '可导入配置',
                activeDiscovered: '本机服务',
                noDiscovered: '没有发现可导入的 MCP server',
                noActiveDiscovered: '没有发现运行中的 MCP server',
                importServer: '导入',
                existing: '已存在',
                source: '来源',
                testConnection: '测试连接',
                testingConnection: '测试中',
                available: '可用',
                unavailable: '不可用',
                untested: '未测试',
                advanced: '高级',
                actions: '操作',
            },
        };
    }
    if (lang === 'zh-TW') {
        return {
            configured: '已設定',
            newServer: '新增 Server',
            noServers: '暫無 MCP server',
            form: {
                name: '名稱',
                enabled: '啟用',
                transport: '傳輸',
                scope: '作用域',
                command: '命令',
                args: '參數',
                url: 'URL',
                cwd: '工作目錄',
                env: '環境變數',
                argsHint: '每行一個參數',
                envHint: '每行一個 KEY=value；已儲存的密鑰留空會繼續保留',
                stdio: 'stdio',
                sse: 'SSE',
                http: 'HTTP',
                beegame: 'BeeGame',
                global: '全域',
                project: '專案',
                edit: '編輯',
                delete: '刪除',
                cancel: '取消',
                save: '儲存 Server',
                saving: '儲存中',
                scanLocal: '匯入設定',
                scanActive: '尋找本機服務',
                scanning: '掃描中',
                discovered: '可匯入設定',
                activeDiscovered: '本機服務',
                noDiscovered: '沒有發現可匯入的 MCP server',
                noActiveDiscovered: '沒有發現執行中的 MCP server',
                importServer: '匯入',
                existing: '已存在',
                source: '來源',
                testConnection: '測試連線',
                testingConnection: '測試中',
                available: '可用',
                unavailable: '不可用',
                untested: '未測試',
                advanced: '進階',
                actions: '操作',
            },
        };
    }
    return {
        configured: 'Configured',
        newServer: 'New server',
        noServers: 'No MCP servers yet',
        form: {
            name: 'Name',
            enabled: 'Enabled',
            transport: 'Transport',
            scope: 'Scope',
            command: 'Command',
            args: 'Arguments',
            url: 'URL',
            cwd: 'Working directory',
            env: 'Environment',
            argsHint: 'One argument per line',
            envHint: 'One KEY=value per line. Leave saved secrets blank to keep them.',
            stdio: 'stdio',
            sse: 'SSE',
            http: 'HTTP',
            beegame: 'BeeGame',
            global: 'Global',
            project: 'Project',
            edit: 'Edit',
            delete: 'Delete',
            cancel: 'Cancel',
            save: 'Save server',
            saving: 'Saving',
            scanLocal: 'Import config',
            scanActive: 'Find local services',
            scanning: 'Scanning',
            discovered: 'Importable config',
            activeDiscovered: 'Local services',
            noDiscovered: 'No importable MCP servers found',
            noActiveDiscovered: 'No running MCP servers found',
            importServer: 'Import',
            existing: 'Exists',
            source: 'Source',
            testConnection: 'Test',
            testingConnection: 'Testing',
            available: 'Available',
            unavailable: 'Unavailable',
            untested: 'Untested',
            advanced: 'Advanced',
            actions: 'Actions',
        },
    };
}

function Switch({
    checked,
    label,
    onClick,
}: {
    checked: boolean;
    label: string;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-label={label}
            aria-checked={checked}
            onClick={onClick}
            className={`relative h-7 w-12 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 ${checked ? 'border-orange-500/70 bg-orange-500' : 'border-zinc-700 bg-zinc-800'}`}
        >
            <span
                className={`absolute left-1 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-zinc-50 shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`}
            />
        </button>
    );
}

function McpSettingsPanel({
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
            <p className="max-w-2xl text-sm leading-6 text-zinc-400">{copy.intro}</p>

            <div className="divide-y divide-zinc-700/60 border-y border-zinc-700/60">
                <div className="py-3 text-xs font-black uppercase tracking-[0.14em] text-zinc-500">
                    {copy.configured}
                </div>
                {servers.length ? servers.map((server) => (
                    <div key={server.id} className="flex items-center justify-between gap-3 py-3">
                        <button
                            type="button"
                            onClick={(event) => onEdit(server, toPopoverAnchorRect(event.currentTarget.getBoundingClientRect()))}
                            className="min-w-0 flex-1 rounded-lg px-2 py-1 text-left transition-colors hover:bg-zinc-800/60"
                        >
                            <div className="flex items-center gap-2">
                                <span className={`h-2 w-2 shrink-0 rounded-full ${server.enabled ? 'bg-orange-500' : 'bg-zinc-600'}`} />
                                <span className="truncate text-sm font-bold text-zinc-100">{server.name}</span>
                            </div>
                            <div className="mt-1 truncate pl-4 text-xs text-zinc-500">
                                {server.transport} · {server.scope}
                            </div>
                            <div className="mt-1 flex items-center gap-2 pl-4 text-xs">
                                <span className={getMcpHealthClass(healthById[server.id], testingServerId === server.id)}>
                                    {getMcpHealthLabel(copy, healthById[server.id], testingServerId === server.id)}
                                </span>
                                {healthById[server.id]?.message ? (
                                    <span className="truncate text-zinc-500">{healthById[server.id].message}</span>
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
                                onClick={() => setActiveServerMenuId((current) => current === server.id ? '' : server.id)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 transition-colors hover:bg-zinc-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60"
                            >
                                <MoreHorizontal className="h-4 w-4" />
                            </button>
                            {activeServerMenuId === server.id ? (
                                <>
                                    <div
                                        className="fixed inset-0 z-[250]"
                                        onMouseDown={() => setActiveServerMenuId('')}
                                    />
                                    <div
                                        role="menu"
                                        className="absolute right-0 top-10 z-[260] w-44 overflow-hidden rounded-2xl border border-zinc-700 bg-[#2b2c2f] p-1.5 shadow-2xl shadow-black/40"
                                        onMouseDown={(event) => event.stopPropagation()}
                                    >
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => {
                                                setActiveServerMenuId('');
                                                onTest(server);
                                            }}
                                            disabled={isSaving || testingServerId === server.id}
                                            className="flex h-9 w-full items-center gap-3 rounded-xl px-3 text-left text-xs font-bold text-zinc-100 transition-colors hover:bg-zinc-800/80 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            <Network className="h-3.5 w-3.5 text-orange-300" />
                                            {testingServerId === server.id ? copy.form.testingConnection : copy.form.testConnection}
                                        </button>
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={(event) => {
                                                const anchor = Array.from(document.querySelectorAll('[data-mcp-row-action]'))
                                                    .find((element) => element.getAttribute('data-mcp-row-action') === server.id);
                                                setActiveServerMenuId('');
                                                onEdit(server, toPopoverAnchorRect((anchor ?? event.currentTarget).getBoundingClientRect()));
                                            }}
                                            className="flex h-9 w-full items-center gap-3 rounded-xl px-3 text-left text-xs font-bold text-zinc-100 transition-colors hover:bg-zinc-800/80"
                                        >
                                            <FolderOpen className="h-3.5 w-3.5 text-zinc-400" />
                                            {copy.form.edit}
                                        </button>
                                        <div className="my-1 h-px bg-zinc-700/70" />
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => {
                                                setActiveServerMenuId('');
                                                onDelete(server.id);
                                            }}
                                            disabled={isSaving}
                                            className="flex h-9 w-full items-center gap-3 rounded-xl px-3 text-left text-xs font-bold text-red-200 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
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
                )) : (
                    <div className="py-4 text-sm text-zinc-500">{copy.noServers}</div>
                )}
            </div>

            {activeDiscovered.length ? (
                <div className="divide-y divide-zinc-700/60 border-y border-zinc-700/60">
                    <div className="py-3 text-xs font-black uppercase tracking-[0.14em] text-zinc-500">
                        {copy.form.activeDiscovered}
                    </div>
                    {activeDiscovered.map((server) => (
                        <div key={`${server.endpoint}:${server.name}`} className="flex items-center justify-between gap-3 py-3">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                                    <span className="truncate text-sm font-bold text-zinc-100">{server.name}</span>
                                    <span className="text-xs font-bold text-emerald-400">{copy.form.available}</span>
                                </div>
                                <div className="mt-1 truncate pl-4 text-xs text-zinc-500">
                                    {server.transport} · {server.endpoint}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => onImportActive(server)}
                                disabled={isSaving || server.exists}
                                className="h-8 shrink-0 rounded-lg border border-zinc-700 px-3 text-xs font-bold text-zinc-300 transition-colors hover:bg-zinc-800/70 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {server.exists ? copy.form.existing : copy.form.importServer}
                            </button>
                        </div>
                    ))}
                </div>
            ) : null}

            {discovered.length ? (
                <div className="divide-y divide-zinc-700/60 border-y border-zinc-700/60">
                    <div className="py-3 text-xs font-black uppercase tracking-[0.14em] text-zinc-500">
                        {copy.form.discovered}
                    </div>
                    {discovered.map((server) => (
                        <div key={`${server.sourcePath}:${server.name}`} className="flex items-center justify-between gap-3 py-3">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className={`h-2 w-2 shrink-0 rounded-full ${server.exists ? 'bg-zinc-600' : 'bg-orange-500'}`} />
                                    <span className="truncate text-sm font-bold text-zinc-100">{server.name}</span>
                                </div>
                                <div className="mt-1 truncate pl-4 text-xs text-zinc-500">
                                    {server.transport} · {copy.form.source}: {server.sourcePath}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => onImport(server)}
                                disabled={isSaving || server.exists}
                                className="h-8 shrink-0 rounded-lg border border-zinc-700 px-3 text-xs font-bold text-zinc-300 transition-colors hover:bg-zinc-800/70 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {server.exists ? copy.form.existing : copy.form.importServer}
                            </button>
                        </div>
                    ))}
                </div>
            ) : null}

            {status ? <div className="text-xs text-amber-300">{status}</div> : null}
        </div>
    );
}

function McpServerFormPopover({
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
        <div
            className="fixed inset-0 z-[350]"
            onMouseDown={onClose}
        >
            <div
                className="fixed z-[360]"
                style={{ left: placement.left, top: placement.top }}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
            >
                <div
                    className="absolute -top-2 h-4 w-4 rotate-45 border-l border-t border-zinc-700 bg-[#2b2c2f]"
                    style={{ left: placement.arrowLeft }}
                />
                <div className="relative flex max-h-[min(480px,calc(100vh-8rem))] w-[min(360px,calc(100vw-3rem))] flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-[#2b2c2f] shadow-2xl shadow-black/50">
                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2 [scrollbar-gutter:stable]">
                        <div className="divide-y divide-zinc-700/60">
                            <label className="grid gap-2 py-3">
                                <span className="text-xs font-bold text-zinc-400">{copy.form.name}</span>
                                <input
                                    aria-label={copy.form.name}
                                    value={form.name}
                                    onChange={(event) => update({ name: event.target.value })}
                                    className="h-9 w-full rounded-xl border border-zinc-700 bg-[#18191d] px-3 text-sm text-zinc-100 outline-none focus:border-orange-500/70"
                                />
                            </label>

                            <div className="flex items-center justify-between gap-3 py-3">
                                <span className="text-sm font-medium text-zinc-100">{copy.form.enabled}</span>
                                <Switch checked={form.enabled} label={copy.form.enabled} onClick={() => update({ enabled: !form.enabled })} />
                            </div>

                            <label className="grid gap-2 py-3">
                                <span className="text-xs font-bold text-zinc-400">{copy.form.transport}</span>
                                <select
                                    aria-label={copy.form.transport}
                                    value={form.transport}
                                    onChange={(event) => update({ transport: event.target.value as McpServerTransport })}
                                    className="h-9 w-full rounded-xl border border-zinc-700 bg-[#18191d] px-3 text-sm text-zinc-100 outline-none focus:border-orange-500/70"
                                >
                                    <option value="stdio">{copy.form.stdio}</option>
                                    <option value="sse">{copy.form.sse}</option>
                                    <option value="http">{copy.form.http}</option>
                                </select>
                            </label>

                            {form.transport !== 'stdio' ? (
                                <label className="grid gap-2 py-3">
                                    <span className="text-xs font-bold text-zinc-400">{copy.form.url}</span>
                                    <input
                                        aria-label={copy.form.url}
                                        value={form.url}
                                        onChange={(event) => update({ url: event.target.value })}
                                        placeholder="http://127.0.0.1:3000/mcp"
                                        className="h-9 w-full rounded-xl border border-zinc-700 bg-[#18191d] px-3 text-sm text-zinc-100 outline-none focus:border-orange-500/70"
                                    />
                                </label>
                            ) : null}

                            <div className="py-2">
                                <button
                                    type="button"
                                    aria-expanded={advancedOpen}
                                    onClick={() => setAdvancedOpen((current) => !current)}
                                    className="flex h-9 w-full items-center justify-between rounded-xl px-1 text-left text-sm font-bold text-zinc-200 transition-colors hover:bg-zinc-800/50"
                                >
                                    <span>{copy.form.advanced}</span>
                                    <span className={`text-zinc-500 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}>⌄</span>
                                </button>
                                {advancedOpen ? (
                                    <div className="mt-1 divide-y divide-zinc-700/60">
                                        {form.transport === 'stdio' ? (
                                            <>
                                                <label className="grid gap-2 py-3">
                                                    <span className="text-xs font-bold text-zinc-400">{copy.form.command}</span>
                                                    <input
                                                        aria-label={copy.form.command}
                                                        value={form.command}
                                                        onChange={(event) => update({ command: event.target.value })}
                                                        placeholder="npx"
                                                        className="h-9 w-full rounded-xl border border-zinc-700 bg-[#18191d] px-3 font-mono text-sm text-zinc-100 outline-none focus:border-orange-500/70"
                                                    />
                                                </label>
                                                <label className="grid gap-2 py-3">
                                                    <span className="text-xs font-bold text-zinc-400">{copy.form.args}</span>
                                                    <div className="space-y-1">
                                                        <textarea
                                                            aria-label={copy.form.args}
                                                            value={form.argsText}
                                                            onChange={(event) => update({ argsText: event.target.value })}
                                                            rows={3}
                                                            className="w-full resize-none rounded-xl border border-zinc-700 bg-[#18191d] px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-orange-500/70"
                                                        />
                                                        <div className="text-xs text-zinc-500">{copy.form.argsHint}</div>
                                                    </div>
                                                </label>
                                            </>
                                        ) : null}
                                        <label className="grid gap-2 py-3">
                                            <span className="text-xs font-bold text-zinc-400">{copy.form.scope}</span>
                                            <select
                                                aria-label={copy.form.scope}
                                                value={form.scope}
                                                onChange={(event) => update({ scope: event.target.value as McpServerScope })}
                                                className="h-9 w-full rounded-xl border border-zinc-700 bg-[#18191d] px-3 text-sm text-zinc-100 outline-none focus:border-orange-500/70"
                                            >
                                                <option value="beegame">{copy.form.beegame}</option>
                                                <option value="project">{copy.form.project}</option>
                                                <option value="global">{copy.form.global}</option>
                                            </select>
                                        </label>

                                        <label className="grid gap-2 py-3">
                                            <span className="text-xs font-bold text-zinc-400">{copy.form.cwd}</span>
                                            <input
                                                aria-label={copy.form.cwd}
                                                value={form.cwd}
                                                onChange={(event) => update({ cwd: event.target.value })}
                                                className="h-9 w-full rounded-xl border border-zinc-700 bg-[#18191d] px-3 font-mono text-sm text-zinc-100 outline-none focus:border-orange-500/70"
                                            />
                                        </label>

                                        <label className="grid gap-2 py-3">
                                            <span className="text-xs font-bold text-zinc-400">{copy.form.env}</span>
                                            <div className="space-y-1">
                                                <textarea
                                                    aria-label={copy.form.env}
                                                    value={form.envText}
                                                    onChange={(event) => update({ envText: event.target.value })}
                                                    rows={3}
                                                    className="w-full resize-none rounded-xl border border-zinc-700 bg-[#18191d] px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-orange-500/70"
                                                />
                                                <div className="text-xs text-zinc-500">{copy.form.envHint}</div>
                                            </div>
                                        </label>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                        {status ? <div className="py-2 text-xs text-amber-300">{status}</div> : null}
                    </div>

                    {mode === 'create' ? (
                        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-zinc-700/70 px-4 py-3">
                            <button
                                type="button"
                                onClick={onClose}
                                className="h-9 rounded-xl border border-zinc-700 px-3 text-sm font-bold text-zinc-200 transition-colors hover:bg-zinc-800/70"
                            >
                                {copy.form.cancel}
                            </button>
                            <button
                                type="button"
                                onClick={onSave}
                                disabled={saveDisabled}
                                className="h-9 rounded-xl bg-zinc-100 px-4 text-sm font-black text-zinc-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {isSaving ? copy.form.saving : copy.form.save}
                            </button>
                        </footer>
                    ) : null}
                </div>
            </div>
        </div>,
        document.body,
    );
}

function toPopoverAnchorRect(rect: DOMRect): PopoverAnchorRect {
    return {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
    };
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
    const left = Math.min(
        Math.max(margin, preferredLeft),
        Math.max(margin, viewportWidth - popoverWidth - margin),
    );
    const anchorCenter = anchorRect.left + anchorRect.width / 2;
    return {
        left,
        top: anchorRect.bottom + 12,
        arrowLeft: Math.min(
            Math.max(18, anchorCenter - left - 8),
            popoverWidth - 34,
        ),
    };
}

function makeRuntimeCapabilityCopy(copy: RuntimeCapabilityTextBundle, lang: Language): RuntimeCapabilityCopy {
    const useChineseLabels = lang.startsWith('zh');
    return {
        title: copy.title,
        subagents: {
            description: copy.subagents[0],
            note: copy.subagents[1],
        },
        items: {
            autoMemoryEnabled: {
                label: 'Auto Memory',
                description: copy.memory[0],
                note: copy.memory[1],
                scope: 'newSession',
            },
            autoDreamEnabled: {
                label: 'Auto Dream',
                description: copy.dream[0],
                note: copy.dream[1],
                scope: 'newSession',
            },
            skillSearchEnabled: {
                label: 'Skill Search',
                description: copy.skill[0],
                note: copy.skill[1],
                scope: 'newSession',
            },
            treeSitterBashEnabled: {
                label: useChineseLabels ? 'Bash AST 解析' : 'Bash AST parser',
                description: copy.ast[0],
                note: copy.ast[1],
                scope: 'restart',
            },
            webBrowserToolEnabled: {
                label: useChineseLabels ? (lang === 'zh-TW' ? '網頁讀取工具' : '网页读取工具') : 'Browser fetch tool',
                description: copy.web[0],
                note: copy.web[1],
                scope: 'restart',
            },
            bashClassifierEnabled: {
                label: useChineseLabels ? (lang === 'zh-TW' ? 'Bash 命令分類器' : 'Bash 命令分类器') : 'Bash classifier',
                description: copy.bash[0],
                note: copy.bash[1],
                scope: 'restart',
            },
            mcpSkillsEnabled: {
                label: useChineseLabels ? (lang === 'zh-TW' ? 'MCP 技能發現' : 'MCP 技能发现') : 'MCP skills',
                description: copy.mcp[0],
                note: copy.mcp[1],
                scope: 'restart',
            },
        },
    };
}

function getRuntimeCapabilityItems(copy: RuntimeCapabilityCopy): RuntimeSettingsCapabilityItem[] {
    return [
        'autoMemoryEnabled',
        'autoDreamEnabled',
        'skillSearchEnabled',
        'treeSitterBashEnabled',
        'webBrowserToolEnabled',
        'bashClassifierEnabled',
        'mcpSkillsEnabled',
    ].map((key) => ({
        key: key as keyof RuntimeSettingsConfig,
        ...copy.items[key as keyof RuntimeSettingsConfig],
    }));
}

function CapabilityToggleRow({
    item,
    checked,
    onToggle,
}: {
    item: RuntimeCapabilityItem;
    checked: boolean;
    onToggle: () => void;
}) {
    const Icon = item.scope === 'restart' ? ShieldCheck : item.key === 'autoDreamEnabled' ? Brain : Bot;
    return (
        <div className="grid min-h-16 gap-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                    <Icon className="h-4 w-4 text-zinc-500" />
                    <span className="text-sm font-bold text-zinc-100">{item.label}</span>
                </div>
                <div className="mt-1 space-y-0.5 text-xs leading-5 text-zinc-500">
                    <div className="text-zinc-400">{item.description}</div>
                    <div>{item.note}</div>
                </div>
            </div>
            <button
                type="button"
                role="switch"
                aria-label={item.label}
                aria-checked={checked}
                onClick={onToggle}
                className={`relative h-7 w-12 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 ${checked ? 'border-orange-500/70 bg-orange-500' : 'border-zinc-700 bg-zinc-800'}`}
            >
                <span
                    className={`absolute left-1 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-zinc-50 shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`}
                />
            </button>
        </div>
    );
}
