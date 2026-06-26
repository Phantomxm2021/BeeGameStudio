import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, FolderOpen, Globe, KeyRound, RotateCcw, Search, X } from 'lucide-react';
import { LANGUAGE_OPTIONS, translations, type Language } from '../AgentsConfig';
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

interface SettingsMenuProps {
    isOpen: boolean;
    lang: Language;
    onClose: () => void;
    onSetLang: (lang: Language) => void;
}

type SettingsTab = 'general' | 'model';

export function SettingsMenu({ isOpen, lang, onClose, onSetLang }: SettingsMenuProps) {
    const t = translations[lang];
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
    const [activeTab, setActiveTab] = useState<SettingsTab>('general');
    const [subagentsEnabled, setSubagentsEnabled] = useState(true);

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
                    setWorkspaceStatus(error instanceof Error ? error.message : '工作路径读取失败');
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
                    setWebToolsStatus(error instanceof Error ? error.message : '网页工具配置读取失败');
                }
            });
        return () => {
            cancelled = true;
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
            setStatus(error instanceof Error ? error.message : '模型配置保存失败');
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
            setBeeGameSubagentsEnabled(subagentsEnabled);
            return true;
        } catch (error) {
            setWorkspaceStatus(error instanceof Error ? error.message : '工作路径保存失败');
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
            setWorkspaceStatus(error instanceof Error ? error.message : '恢复默认工作路径失败');
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
            setWebToolsStatus(error instanceof Error ? error.message : '网页搜索配置保存失败');
            return false;
        } finally {
            setIsSavingWebTools(false);
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
    const activeTabLabel = activeTab === 'general' ? '通用' : '模型';
    const isSavingCurrentTab = activeTab === 'general'
        ? isSavingWorkspace || isSavingWebTools
        : isSaving;
    const isSaveDisabled = activeTab === 'general'
        ? isSavingCurrentTab ||
            !workspacePath.trim() ||
            (!!webSearchKeyField && !webSearchKeyValue.trim() && !webSearchKeyPreview)
        : isSavingCurrentTab || !balancedModel.trim() || (!selectedModelConfigId && !apiKey.trim());

    const handleSaveSettings = async () => {
        if (activeTab === 'model') {
            const saved = await handleSaveModelConfig();
            if (saved) onClose();
            return;
        }
        const workspaceSaved = handleSaveWorkspace();
        const webToolsSaved = await handleSaveWebTools();
        if (workspaceSaved && webToolsSaved) onClose();
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
                                        aria-label="关闭设置"
                                        onClick={onClose}
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-800/80 text-zinc-200 transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                                <div className="space-y-1.5" role="tablist" aria-label={t.systemSettings}>
                                    {[
                                        { id: 'general' as const, label: '通用', icon: Globe },
                                        { id: 'model' as const, label: '模型', icon: KeyRound },
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

                            <main data-testid="settings-modal-content" className="flex min-w-0 flex-1 flex-col">
                                <header className="shrink-0 px-6 pb-3 pt-5">
                                    <div className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">
                                        {t.systemSettings}
                                    </div>
                                    <h2 className="mt-3 text-xl font-medium text-zinc-100">{activeTabLabel}</h2>
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
                                                工作路径
                                            </span>
                                            <div className="min-w-0 space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        aria-label="工作路径"
                                                        value={workspacePath}
                                                        onChange={(event) => setWorkspacePath(event.target.value)}
                                                        placeholder="/absolute/path/to/Projects"
                                                        className="h-10 min-w-0 flex-1 rounded-xl border border-zinc-700 bg-[#18191d] px-3 font-mono text-xs text-zinc-100 outline-none focus:border-orange-500/70"
                                                    />
                                                    <button
                                                        type="button"
                                                        aria-label="恢复默认"
                                                        title="恢复默认"
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
                                                Web Search
                                            </span>
                                            <div className="min-w-0 space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <select
                                                        aria-label="Search Backend"
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
                                                        placeholder={webSearchKeyPreview ? `已保存：${webSearchKeyPreview}` : (webSearchKeyField === 'brave' ? 'BRAVE_SEARCH_API_KEY' : 'EXA_API_KEY')}
                                                        className="h-10 w-full rounded-xl border border-zinc-700 bg-[#18191d] px-3 text-sm text-zinc-100 outline-none focus:border-orange-500/70"
                                                    />
                                                ) : null}
                                                {webToolsStatus ? (
                                                    <div className="text-xs text-emerald-400">{webToolsStatus}</div>
                                                ) : null}
                                            </div>
                                        </div>
                                        <label className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center">
                                            <span className="flex items-center gap-2.5 text-sm font-medium text-zinc-100">
                                                <Bot className="h-4 w-4 text-zinc-400" />
                                                Enable subagents
                                            </span>
                                            <span className="flex items-center justify-end">
                                                <input
                                                    aria-label="Enable subagents"
                                                    type="checkbox"
                                                    checked={subagentsEnabled}
                                                    onChange={(event) => setSubagentsEnabled(event.target.checked)}
                                                    className="h-5 w-5 accent-orange-500"
                                                />
                                            </span>
                                        </label>
                                    </div>
                                ) : null}

                                {activeTab === 'model' ? (
                                    <>
                                        <div className="divide-y divide-zinc-700/60">
                                            <label className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center">
                                                <span className="text-sm font-medium text-zinc-100">Provider</span>
                                                <select
                                                    aria-label="Provider"
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
                                                <span className="text-sm font-medium text-zinc-100">Base URL</span>
                                                <input
                                                    aria-label="Base URL"
                                                    value={baseUrl}
                                                    onChange={(event) => setBaseUrl(event.target.value)}
                                                    placeholder="https://api.example.com/v1"
                                                    className="h-10 w-full rounded-xl border border-zinc-700 bg-[#18191d] px-3 text-sm text-zinc-100 outline-none focus:border-orange-500/70"
                                                />
                                            </label>

                                            <label className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center">
                                                <span className="text-sm font-medium text-zinc-100">API Key</span>
                                                <input
                                                    aria-label="API Key"
                                                    type="password"
                                                    value={apiKey}
                                                    onChange={(event) => setApiKey(event.target.value)}
                                                    placeholder={apiKeyPreview ? `已保存：${apiKeyPreview}` : 'sk-...'}
                                                    className="h-10 w-full rounded-xl border border-zinc-700 bg-[#18191d] px-3 text-sm text-zinc-100 outline-none focus:border-orange-500/70"
                                                />
                                            </label>

                                            <div className="grid gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-start">
                                                <span className="text-sm font-medium text-zinc-100 sm:mt-2.5">Models</span>
                                                <div className="grid gap-2">
                                                    <label className="grid gap-2 sm:grid-cols-[6rem_1fr] sm:items-center">
                                                        <span className="text-xs font-black uppercase tracking-[0.12em] text-zinc-500">Fast</span>
                                                        <input
                                                            aria-label="Fast Model"
                                                            value={fastModel}
                                                            onChange={(event) => setFastModel(event.target.value)}
                                                            placeholder="qwen3.5-flash"
                                                            className="h-10 w-full rounded-xl border border-zinc-700 bg-[#18191d] px-3 text-sm text-zinc-100 outline-none focus:border-orange-500/70"
                                                        />
                                                    </label>
                                                    <label className="grid gap-2 sm:grid-cols-[6rem_1fr] sm:items-center">
                                                        <span className="text-xs font-black uppercase tracking-[0.12em] text-zinc-500">Balanced</span>
                                                        <input
                                                            aria-label="Balanced Model"
                                                            value={balancedModel}
                                                            onChange={(event) => setBalancedModel(event.target.value)}
                                                            placeholder="qwen3.7-plus"
                                                            className="h-10 w-full rounded-xl border border-zinc-700 bg-[#18191d] px-3 text-sm text-zinc-100 outline-none focus:border-orange-500/70"
                                                        />
                                                    </label>
                                                    <label className="grid gap-2 sm:grid-cols-[6rem_1fr] sm:items-center">
                                                        <span className="text-xs font-black uppercase tracking-[0.12em] text-zinc-500">Strong</span>
                                                        <input
                                                            aria-label="Strong Model"
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
                                </div>
                                <div className="flex items-center justify-end border-t border-zinc-700/70 px-6 py-4">
                                <button
                                    type="button"
                                    aria-label="保存设置"
                                    onClick={handleSaveSettings}
                                    disabled={isSaveDisabled}
                                    className="inline-flex h-10 items-center rounded-xl bg-zinc-100 px-5 text-sm font-black text-zinc-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {isSavingCurrentTab ? '保存中' : '保存设置'}
                                </button>
                            </div>
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
