import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, CheckCircle2, FolderOpen, FolderSearch, Globe, KeyRound, Moon, RotateCcw, Save, Sun } from 'lucide-react';
import { LANGUAGE_OPTIONS, translations, type Language } from '../AgentsConfig';
import {
    getBeeGameWorkspaceSettings,
    getBeeGameSubagentsEnabled,
    resetBeeGameWorkspaceRoot,
    setBeeGameSubagentsEnabled,
    setBeeGameWorkspaceRoot,
} from '../../../services/beeGameAdapter';
import {
    createModelConfig,
    listModelConfigs,
    type ModelConfig,
    type ModelProviderKind,
} from '../../../services/modelConfigApi';

interface SettingsMenuProps {
    isOpen: boolean;
    lang: Language;
    isDark: boolean;
    onClose: () => void;
    onToggleTheme: () => void;
    onSetLang: (lang: Language) => void;
}

type BeeGameDesktopBridge = {
    chooseWorkspacePath?: () => Promise<string | undefined> | string | undefined;
};

type WindowWithBeeGameDesktop = Window & {
    BeeGameDesktop?: BeeGameDesktopBridge;
};

export function SettingsMenu({ isOpen, lang, isDark, onClose, onToggleTheme, onSetLang }: SettingsMenuProps) {
    const t = translations[lang];
    const [existingConfigs, setExistingConfigs] = useState<ModelConfig[]>([]);
    const [name, setName] = useState('');
    const [provider, setProvider] = useState<ModelProviderKind>('openai-compatible');
    const [baseUrl, setBaseUrl] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [fastModel, setFastModel] = useState('');
    const [balancedModel, setBalancedModel] = useState('');
    const [strongModel, setStrongModel] = useState('');
    const [isDefault, setIsDefault] = useState(true);
    const [status, setStatus] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [workspacePath, setWorkspacePath] = useState('');
    const [isDefaultWorkspace, setIsDefaultWorkspace] = useState(true);
    const [workspaceStatus, setWorkspaceStatus] = useState('');
    const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
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
                setName(defaultConfig.name);
                setProvider(defaultConfig.provider);
                setBaseUrl(defaultConfig.baseUrl || '');
                setFastModel(defaultConfig.models.fast || '');
                setBalancedModel(defaultConfig.models.balanced || '');
                setStrongModel(defaultConfig.models.strong || '');
                setIsDefault(defaultConfig.isDefault);
            })
            .catch(() => {
                if (!cancelled) setExistingConfigs([]);
            });
        void getBeeGameWorkspaceSettings()
            .then((settings) => {
                if (cancelled) return;
                setWorkspacePath(settings.workspacePath);
                setIsDefaultWorkspace(settings.isDefault);
                setWorkspaceStatus('');
            })
            .catch((error) => {
                if (!cancelled) {
                    setWorkspaceStatus(error instanceof Error ? error.message : '工作路径读取失败');
                }
            });
        setSubagentsEnabled(getBeeGameSubagentsEnabled());
        return () => {
            cancelled = true;
        };
    }, [isOpen]);

    const currentConfigLabel = useMemo(() => {
        const current = existingConfigs.find((config) => config.isDefault) || existingConfigs[0];
        if (!current) return '未配置模型';
        return `${current.name} · ${current.provider} · ${current.apiKeyPreview}`;
    }, [existingConfigs]);

    const handleSaveModelConfig = async (event: React.FormEvent) => {
        event.preventDefault();
        setStatus('');
        setIsSaving(true);
        try {
            const models = {
                ...(fastModel.trim() ? { fast: fastModel.trim() } : {}),
                ...(balancedModel.trim() ? { balanced: balancedModel.trim() } : {}),
                ...(strongModel.trim() ? { strong: strongModel.trim() } : {}),
            };
            const saved = await createModelConfig({
                name: name.trim() || 'BeeGame LLM',
                provider,
                ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
                apiKey: apiKey.trim(),
                models,
                isDefault,
            });
            setExistingConfigs([saved, ...existingConfigs.filter((config) => config.id !== saved.id)]);
            setApiKey('');
            setStatus('模型配置已保存');
        } catch (error) {
            setStatus(error instanceof Error ? error.message : '模型配置保存失败');
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveWorkspace = (event: React.FormEvent) => {
        event.preventDefault();
        setWorkspaceStatus('');
        setIsSavingWorkspace(true);
        try {
            const saved = setBeeGameWorkspaceRoot(workspacePath);
            setWorkspacePath(saved.workspacePath);
            setIsDefaultWorkspace(saved.isDefault);
            setWorkspaceStatus('工作路径已保存');
        } catch (error) {
            setWorkspaceStatus(error instanceof Error ? error.message : '工作路径保存失败');
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
            setIsDefaultWorkspace(next.isDefault);
            setWorkspaceStatus('已恢复默认工作路径');
        } catch (error) {
            setWorkspaceStatus(error instanceof Error ? error.message : '恢复默认工作路径失败');
        } finally {
            setIsSavingWorkspace(false);
        }
    };

    const handleChooseWorkspace = async () => {
        setWorkspaceStatus('');
        try {
            const chooseWorkspacePath = (window as WindowWithBeeGameDesktop).BeeGameDesktop?.chooseWorkspacePath;
            if (!chooseWorkspacePath) {
                setWorkspaceStatus('当前环境无法打开路径选择器，请粘贴绝对路径。');
                return;
            }
            const selectedPath = await chooseWorkspacePath();
            if (!selectedPath?.trim()) return;
            setWorkspacePath(selectedPath.trim());
            setWorkspaceStatus('已选择工作路径，保存后生效。');
        } catch (error) {
            setWorkspaceStatus(error instanceof Error ? error.message : '选择工作路径失败');
        }
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
                    onClick={onClose}
                    className="fixed inset-0 z-[60] bg-transparent text-zinc-950 dark:text-white"
                >
                    <motion.div
                        initial={{ opacity: 0, y: -12, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -12, scale: 0.98 }}
                        transition={{ duration: 0.22, ease: 'easeOut' }}
                        onClick={(event) => event.stopPropagation()}
                        className="absolute right-4 top-20 max-h-[calc(100vh-6rem)] w-[min(520px,calc(100vw-2rem))] overflow-y-auto rounded-[1.75rem] border border-zinc-200 bg-white p-4 shadow-2xl dark:border-white/10 dark:bg-zinc-900"
                    >
                        <div className="space-y-2">
                            <div className="px-3 pb-1 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-400">
                                {t.systemSettings}
                            </div>

                            <button
                                type="button"
                                onClick={onToggleTheme}
                                className="flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/20 dark:hover:bg-white/10 dark:focus-visible:ring-white/30"
                            >
                                <span className="flex items-center gap-3 text-sm font-semibold">
                                    {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                                    {t.darkMode}
                                </span>
                                <span className={`h-5 w-9 rounded-full border p-0.5 transition-colors ${isDark ? 'border-white/20 bg-white/20' : 'border-zinc-300 bg-zinc-200'}`}>
                                    <motion.span
                                        animate={{ x: isDark ? 16 : 0 }}
                                        className={`block h-3.5 w-3.5 rounded-full shadow-sm ${isDark ? 'bg-white' : 'bg-white'}`}
                                    />
                                </span>
                            </button>

                            <label className="block rounded-2xl px-3 py-3 transition-colors hover:bg-zinc-100 dark:hover:bg-white/10">
                                <span className="mb-2 flex items-center gap-3 text-sm font-semibold">
                                    <Globe className="h-4 w-4" />
                                    {t.language}
                                </span>
                                <select
                                    value={lang}
                                    onChange={(event) => onSetLang(event.target.value as Language)}
                                    className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm font-medium text-zinc-950 outline-none transition-colors focus:border-zinc-400 dark:border-white/10 dark:bg-zinc-950 dark:text-white dark:focus:border-white/30"
                                >
                                    {LANGUAGE_OPTIONS.map((option) => (
                                        <option key={option.code} value={option.code}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <form
                                onSubmit={handleSaveWorkspace}
                                className="space-y-3 rounded-2xl border border-zinc-200 px-3 py-3 dark:border-white/10"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <span className="flex items-center gap-3 text-sm font-semibold">
                                        <FolderOpen className="h-4 w-4" />
                                        工作路径
                                    </span>
                                    <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                        {isDefaultWorkspace ? '默认 Projects' : '自定义'}
                                    </span>
                                </div>

                                <label className="space-y-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                                    <span>工作路径</span>
                                    <div className="flex items-center gap-2">
                                        <input
                                            aria-label="工作路径"
                                            value={workspacePath}
                                            onChange={(event) => setWorkspacePath(event.target.value)}
                                            placeholder="/absolute/path/to/Projects"
                                            className="h-11 min-w-0 flex-1 rounded-xl border border-zinc-200 bg-zinc-50 px-3 font-mono text-xs text-zinc-950 outline-none focus:border-zinc-400 dark:border-white/10 dark:bg-zinc-950 dark:text-white"
                                        />
                                        <button
                                            type="button"
                                            aria-label="选择工作路径"
                                            title="选择工作路径"
                                            onClick={handleChooseWorkspace}
                                            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/20 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-white/10 dark:focus-visible:ring-white/30"
                                        >
                                            <FolderSearch className="h-4 w-4" />
                                        </button>
                                    </div>
                                </label>

                                <div className="flex items-center justify-between gap-3">
                                    <span className="min-w-0 text-xs text-zinc-500 dark:text-zinc-400">
                                        {workspaceStatus || '新项目会创建在这个目录下；留空不保存。'}
                                    </span>
                                    <div className="flex shrink-0 items-center gap-2">
                                        <button
                                            type="button"
                                            aria-label="恢复默认"
                                            title="恢复默认"
                                            onClick={handleResetWorkspace}
                                            disabled={isSavingWorkspace}
                                            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-zinc-200 dark:hover:bg-white/10"
                                        >
                                            <RotateCcw className="h-4 w-4" />
                                        </button>
                                        <button
                                            type="submit"
                                            aria-label="保存工作路径"
                                            title="保存工作路径"
                                            disabled={isSavingWorkspace || !workspacePath.trim()}
                                            className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-950 text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                                        >
                                            <Save className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            </form>

                            <label className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 px-3 py-3 dark:border-white/10">
                                <span className="min-w-0">
                                    <span className="flex items-center gap-3 text-sm font-semibold">
                                        <Bot className="h-4 w-4" />
                                        Enable subagents
                                    </span>
                                    <span className="mt-1 block text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                                        Let the runtime decide when delegation is useful. BeeGame will not force it.
                                    </span>
                                </span>
                                <input
                                    aria-label="Enable subagents"
                                    type="checkbox"
                                    checked={subagentsEnabled}
                                    onChange={(event) => {
                                        const enabled = setBeeGameSubagentsEnabled(event.target.checked);
                                        setSubagentsEnabled(enabled);
                                    }}
                                    className="h-4 w-4 shrink-0 accent-zinc-900 dark:accent-white"
                                />
                            </label>

                            <form
                                onSubmit={handleSaveModelConfig}
                                className="space-y-3 rounded-2xl border border-zinc-200 px-3 py-3 dark:border-white/10"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <span className="flex items-center gap-3 text-sm font-semibold">
                                        <KeyRound className="h-4 w-4" />
                                        BeeGame LLM
                                    </span>
                                    <span className="min-w-0 truncate text-right text-[11px] text-zinc-500 dark:text-zinc-400">
                                        {currentConfigLabel}
                                    </span>
                                </div>

                                <div className="grid gap-3 sm:grid-cols-2">
                                    <label className="space-y-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                                        <span>配置名称</span>
                                        <input
                                            aria-label="配置名称"
                                            value={name}
                                            onChange={(event) => setName(event.target.value)}
                                            className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 outline-none focus:border-zinc-400 dark:border-white/10 dark:bg-zinc-950 dark:text-white"
                                        />
                                    </label>

                                    <label className="space-y-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                                        <span>Provider</span>
                                        <select
                                            aria-label="Provider"
                                            value={provider}
                                            onChange={(event) => setProvider(event.target.value as ModelProviderKind)}
                                            className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 outline-none focus:border-zinc-400 dark:border-white/10 dark:bg-zinc-950 dark:text-white"
                                        >
                                            <option value="openai-compatible">OpenAI Compatible</option>
                                            <option value="anthropic-compatible">Anthropic API Compatible</option>
                                            <option value="gemini">Gemini</option>
                                            <option value="grok">Grok</option>
                                        </select>
                                    </label>
                                </div>

                                <label className="space-y-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                                    <span>Base URL</span>
                                    <input
                                        aria-label="Base URL"
                                        value={baseUrl}
                                        onChange={(event) => setBaseUrl(event.target.value)}
                                        placeholder="https://api.example.com/v1"
                                        className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 outline-none focus:border-zinc-400 dark:border-white/10 dark:bg-zinc-950 dark:text-white"
                                    />
                                </label>

                                <label className="space-y-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                                    <span>API Key</span>
                                    <input
                                        aria-label="API Key"
                                        type="password"
                                        value={apiKey}
                                        onChange={(event) => setApiKey(event.target.value)}
                                        className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 outline-none focus:border-zinc-400 dark:border-white/10 dark:bg-zinc-950 dark:text-white"
                                    />
                                </label>

                                <div className="grid gap-3 sm:grid-cols-3">
                                    <label className="space-y-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                                        <span>Fast Model</span>
                                        <input
                                            aria-label="Fast Model"
                                            value={fastModel}
                                            onChange={(event) => setFastModel(event.target.value)}
                                            className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 outline-none focus:border-zinc-400 dark:border-white/10 dark:bg-zinc-950 dark:text-white"
                                        />
                                    </label>
                                    <label className="space-y-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                                        <span>Balanced Model</span>
                                        <input
                                            aria-label="Balanced Model"
                                            value={balancedModel}
                                            onChange={(event) => setBalancedModel(event.target.value)}
                                            className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 outline-none focus:border-zinc-400 dark:border-white/10 dark:bg-zinc-950 dark:text-white"
                                        />
                                    </label>
                                    <label className="space-y-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                                        <span>Strong Model</span>
                                        <input
                                            aria-label="Strong Model"
                                            value={strongModel}
                                            onChange={(event) => setStrongModel(event.target.value)}
                                            className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 outline-none focus:border-zinc-400 dark:border-white/10 dark:bg-zinc-950 dark:text-white"
                                        />
                                    </label>
                                </div>

                                <label className="flex items-center justify-between rounded-xl bg-zinc-50 px-3 py-2 text-sm font-semibold dark:bg-zinc-950">
                                    <span className="flex items-center gap-2">
                                        <CheckCircle2 className="h-4 w-4" />
                                        设为默认模型
                                    </span>
                                    <input
                                        aria-label="设为默认模型"
                                        type="checkbox"
                                        checked={isDefault}
                                        onChange={(event) => setIsDefault(event.target.checked)}
                                        className="h-4 w-4 accent-zinc-900 dark:accent-white"
                                    />
                                </label>

                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-xs text-emerald-600 dark:text-emerald-400">{status}</span>
                                    <button
                                        type="submit"
                                        disabled={isSaving || !apiKey.trim() || !balancedModel.trim()}
                                        className="inline-flex h-10 items-center gap-2 rounded-xl bg-zinc-950 px-4 text-sm font-bold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                                    >
                                        <Save className="h-4 w-4" />
                                        {isSaving ? '保存中' : '保存模型配置'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
