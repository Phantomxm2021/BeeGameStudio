import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot, Brain, Cpu, FolderOpen, Globe, KeyRound, MoreHorizontal, Network, Plus, Search, ShieldCheck, Ticket, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LANGUAGE_OPTIONS, type Language } from '../AgentsConfig';
import { normalizeI18nLanguage, useBeeGameText, useCommonText } from '../../../i18n/useBeeGameTranslations';
import {
    getBeeGameSubagentsEnabled,
    getBeeGameWorkspaceSettings,
    setBeeGameSubagentsEnabled,
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
import {
    createInvitation,
    deleteInvitation,
    getInvitationPublicSettings,
    listInvitations,
    saveInvitationSettings,
    updateInvitation,
    type InvitationRecord,
} from '../../../services/invitationApi';
interface SettingsMenuProps {
    isOpen: boolean;
    lang: Language;
    onClose: () => void;
    onSetLang: (lang: Language) => void;
    canManageWorkspace?: boolean;
    canManageSecrets?: boolean;
    canManageRuntimeSettings?: boolean;
    canManageMcp?: boolean;
    canManageModelConfig?: boolean;
    canManageInvitations?: boolean;
}

type SettingsSection = 'personal' | 'platform';
type SettingsTab = 'general' | 'runtime' | 'mcp' | 'model' | 'invitations';
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

export function SettingsMenu({
    isOpen,
    lang,
    onClose,
    onSetLang,
    canManageWorkspace = false,
    canManageSecrets = false,
    canManageRuntimeSettings = false,
    canManageMcp = false,
    canManageModelConfig = false,
    canManageInvitations = false,
}: SettingsMenuProps) {
    const { i18n } = useTranslation('settings');
    const fixedSettingsTranslation = i18n.getFixedT(normalizeI18nLanguage(lang), 'settings');
    const translateSettings = (key: string, options?: Record<string, unknown>): string => (
        fixedSettingsTranslation(key, options)
    );
    const settingsObject = <T,>(key: string): T => (
        fixedSettingsTranslation(key, { returnObjects: true }) as T
    );
    const t = useCommonText(lang);
    const text = useBeeGameText(lang);
    const effectiveCanManageWorkspace = canManageWorkspace;
    const effectiveCanManageSecrets = canManageSecrets;
    const effectiveCanManageRuntimeSettings = canManageRuntimeSettings;
    const effectiveCanManageMcp = canManageMcp;
    const effectiveCanManageModelConfig = canManageModelConfig;
    const effectiveCanManageInvitations = canManageInvitations;
    const hasPlatformSettings = effectiveCanManageWorkspace ||
        effectiveCanManageSecrets ||
        effectiveCanManageRuntimeSettings ||
        effectiveCanManageMcp ||
        effectiveCanManageModelConfig ||
        effectiveCanManageInvitations;
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
    const [activeSection, setActiveSection] = useState<SettingsSection>('personal');
    const [subagentsEnabled, setSubagentsEnabled] = useState(true);
    const [invitationRequired, setInvitationRequired] = useState(false);
    const [invitations, setInvitations] = useState<InvitationRecord[]>([]);
    const [newInvitationCode, setNewInvitationCode] = useState('');
    const [newInvitationLabel, setNewInvitationLabel] = useState('');
    const [newInvitationMaxUses, setNewInvitationMaxUses] = useState('');
    const [invitationStatus, setInvitationStatus] = useState('');
    const [isSavingInvitations, setIsSavingInvitations] = useState(false);
    const mcpAutoSaveTimerRef = useRef<number | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        if (effectiveCanManageModelConfig) {
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
        }
        if (effectiveCanManageWorkspace) {
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
        }
        setSubagentsEnabled(getBeeGameSubagentsEnabled());
        if (effectiveCanManageSecrets) {
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
        }
        if (effectiveCanManageRuntimeSettings) {
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
        }
        if (effectiveCanManageInvitations) {
            void Promise.all([getInvitationPublicSettings(), listInvitations()])
                .then(([settings, records]) => {
                    if (cancelled) return;
                    setInvitationRequired(settings.required);
                    setInvitations(records);
                    setNewInvitationCode('');
                    setNewInvitationLabel('');
                    setNewInvitationMaxUses('');
                    setInvitationStatus('');
                })
                .catch((error) => {
                    if (!cancelled) {
                        setInvitationStatus(error instanceof Error ? error.message : 'Invitation settings unavailable');
                    }
                });
        }
        if (effectiveCanManageMcp) {
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
        }
        return () => {
            cancelled = true;
            if (mcpAutoSaveTimerRef.current !== null) {
                window.clearTimeout(mcpAutoSaveTimerRef.current);
                mcpAutoSaveTimerRef.current = null;
            }
        };
    }, [
        effectiveCanManageMcp,
        effectiveCanManageModelConfig,
        effectiveCanManageInvitations,
        effectiveCanManageRuntimeSettings,
        effectiveCanManageSecrets,
        effectiveCanManageWorkspace,
        isOpen,
        text.webToolsReadFailed,
        text.workspaceReadFailed,
    ]);

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

    const handleSaveInvitationSettings = async () => {
        setInvitationStatus('');
        setIsSavingInvitations(true);
        try {
            const saved = await saveInvitationSettings(invitationRequired);
            setInvitationRequired(saved.required);
            setInvitationStatus(saved.required ? '邀请码已开启。' : '邀请码已关闭。');
            return true;
        } catch (error) {
            setInvitationStatus(error instanceof Error ? error.message : 'Invitation settings save failed');
            return false;
        } finally {
            setIsSavingInvitations(false);
        }
    };

    const handleCreateInvitation = async () => {
        const code = newInvitationCode.trim();
        if (!code) {
            setInvitationStatus('请输入邀请码。');
            return;
        }
        const maxUses = parsePositiveInteger(newInvitationMaxUses);
        if (newInvitationMaxUses.trim() && maxUses === null) {
            setInvitationStatus('使用次数必须是正整数。');
            return;
        }
        setInvitationStatus('');
        setIsSavingInvitations(true);
        try {
            const created = await createInvitation({
                code,
                label: newInvitationLabel.trim() || undefined,
                maxUses,
            });
            setInvitations((current) => [created, ...current.filter((item) => item.id !== created.id)]);
            setNewInvitationCode('');
            setNewInvitationLabel('');
            setNewInvitationMaxUses('');
        } catch (error) {
            setInvitationStatus(error instanceof Error ? error.message : 'Invitation create failed');
        } finally {
            setIsSavingInvitations(false);
        }
    };

    const handleToggleInvitation = async (invitation: InvitationRecord) => {
        setInvitationStatus('');
        setIsSavingInvitations(true);
        try {
            const updated = await updateInvitation({ id: invitation.id, enabled: !invitation.enabled });
            setInvitations((current) => current.map((item) => item.id === updated.id ? updated : item));
        } catch (error) {
            setInvitationStatus(error instanceof Error ? error.message : 'Invitation update failed');
        } finally {
            setIsSavingInvitations(false);
        }
    };

    const handleDeleteInvitation = async (id: string) => {
        setInvitationStatus('');
        setIsSavingInvitations(true);
        try {
            await deleteInvitation(id);
            setInvitations((current) => current.filter((item) => item.id !== id));
        } catch (error) {
            setInvitationStatus(error instanceof Error ? error.message : 'Invitation delete failed');
        } finally {
            setIsSavingInvitations(false);
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
    const savedPrefix = `${text.savedPrefix}${text.savedPrefixSeparator}`;
    const capabilityCopy = settingsObject<RuntimeCapabilityCopy>('runtimeCapabilities');
    const mcpCopy = settingsObject<McpSettingsCopy>('mcp');
    const adminCopy = getAdminSettingsCopy(translateSettings);
    const sectionTabs = useMemo(() => [
        { id: 'personal' as const, label: text.settingsGeneral, icon: Globe },
        ...(hasPlatformSettings ? [{ id: 'platform' as const, label: adminCopy.platform, icon: ShieldCheck }] : []),
    ], [
        adminCopy.platform,
        hasPlatformSettings,
        text.settingsGeneral,
    ]);
    const platformTabs = useMemo(() => {
        return [
            { id: 'general' as const, label: adminCopy.deployment, icon: ShieldCheck },
            ...(effectiveCanManageInvitations ? [{ id: 'invitations' as const, label: '邀请码', icon: Ticket }] : []),
            ...(effectiveCanManageRuntimeSettings ? [{ id: 'runtime' as const, label: capabilityCopy.title, icon: Cpu }] : []),
            ...(effectiveCanManageMcp ? [{ id: 'mcp' as const, label: mcpCopy.title, icon: Network }] : []),
            ...(effectiveCanManageModelConfig ? [{ id: 'model' as const, label: text.settingsModel, icon: KeyRound }] : []),
        ];
    }, [
        effectiveCanManageWorkspace,
        effectiveCanManageSecrets,
        effectiveCanManageMcp,
        effectiveCanManageModelConfig,
        effectiveCanManageInvitations,
        effectiveCanManageRuntimeSettings,
        adminCopy.deployment,
        capabilityCopy.title,
        mcpCopy.title,
        text.settingsModel,
    ]);
    const activeTabLabel = activeSection === 'personal'
        ? text.settingsGeneral
        : activeTab === 'general'
        ? adminCopy.deployment
        : activeTab === 'runtime'
            ? capabilityCopy.title
            : activeTab === 'mcp'
                ? mcpCopy.title
                : activeTab === 'invitations'
                    ? '邀请码'
                    : text.settingsModel;
    const isSavingCurrentTab = activeSection === 'platform' && activeTab === 'general'
        ? (effectiveCanManageSecrets && isSavingWebTools)
        : activeTab === 'runtime'
            ? isSavingRuntimeSettings
        : activeTab === 'mcp'
                ? false
            : activeTab === 'invitations'
                    ? isSavingInvitations
                    : isSaving;
    const hasGeneralSaveAction = activeSection === 'platform' && effectiveCanManageSecrets;
    const isSaveDisabled = activeSection === 'platform' && activeTab === 'general'
        ? !hasGeneralSaveAction ||
            isSavingCurrentTab ||
            (effectiveCanManageSecrets && !!webSearchKeyField && !webSearchKeyValue.trim() && !webSearchKeyPreview)
        : activeTab === 'runtime'
            ? isSavingCurrentTab
        : activeTab === 'mcp'
                ? false
            : activeTab === 'invitations'
                    ? isSavingCurrentTab
                    : isSavingCurrentTab || !balancedModel.trim() || (!selectedModelConfigId && !apiKey.trim());

    const handleSaveSettings = async () => {
        if (activeSection === 'personal') return;
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
        if (activeTab === 'invitations') {
            const saved = await handleSaveInvitationSettings();
            if (saved) onClose();
            return;
        }
        if (activeTab === 'mcp') return;
        const webToolsSaved = effectiveCanManageSecrets ? await handleSaveWebTools() : true;
        if (webToolsSaved) onClose();
    };

    const updateRuntimeSetting = (key: keyof RuntimeSettingsConfig) => {
        setRuntimeSettings((current) => ({
            ...current,
            [key]: !current[key],
        }));
    };
    useEffect(() => {
        if (!hasPlatformSettings && activeSection === 'platform') {
            setActiveSection('personal');
            setActiveTab('general');
            return;
        }
        if (activeSection === 'platform' && !platformTabs.some((tab) => tab.id === activeTab)) {
            setActiveTab(platformTabs[0]?.id ?? 'general');
        }
    }, [activeSection, activeTab, hasPlatformSettings, platformTabs]);

    if (!isOpen) return null;

    return (
                <div
                    role="dialog"
                    aria-label={t.settings}
                    className="fixed inset-0 z-[220] flex items-center justify-center bg-zinc-950/55 p-4 text-zinc-950 backdrop-blur-sm dark:text-white"
                >
                    <div
                        onClick={(event) => event.stopPropagation()}
                        data-surface="frosted-glass"
                        data-style-source="pixelfork"
                        data-glass-density="reinforced"
                        data-testid="settings-modal-shell"
                        className="input-surface glass-panel h-[min(620px,calc(100vh-2rem))] w-[min(820px,calc(100vw-2rem))] overflow-hidden rounded-[32px] text-zinc-100"
                    >
                        <div className="relative z-10 flex h-full min-h-0">
                            <aside
                                data-testid="settings-modal-sidebar"
                                className="flex w-44 shrink-0 flex-col border-r border-white/10 bg-white/[0.025] p-3 backdrop-blur-xl"
                            >
                                <div className="mb-4 flex items-center justify-between">
                                    <button
                                        type="button"
                                        aria-label={text.closeSettings}
                                        onClick={onClose}
	                                        className="glass-icon-button inline-flex h-10 w-10 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                                <div className="space-y-1.5" role="tablist" aria-label={t.systemSettings}>
                                    {sectionTabs.map((tab) => {
                                        const Icon = tab.icon;
                                        const selected = activeSection === tab.id;
                                        return (
                                            <button
                                                key={tab.id}
                                                type="button"
                                                role="tab"
                                                aria-selected={selected}
                                                onClick={() => {
                                                    setActiveSection(tab.id);
                                                    setActiveTab('general');
                                                }}
                                                className={`type-button flex h-10 w-full items-center gap-2.5 rounded-2xl px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 ${selected ? 'bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'}`}
                                            >
                                                <Icon className="h-4 w-4" />
                                                {tab.label}
                                            </button>
                                        );
                                    })}
                                </div>
                                {activeSection === 'platform' ? (
                                    <div className="mt-4 border-t border-white/10 pt-3">
                                        <div className="type-caption-1 mb-2 px-3 text-zinc-500">
                                            {adminCopy.platform}
                                        </div>
                                        <div className="space-y-1.5" role="tablist" aria-label={adminCopy.platform}>
                                            {platformTabs.map((tab) => {
                                                const Icon = tab.icon;
                                                const selected = activeTab === tab.id;
                                                return (
                                                    <button
                                                        key={tab.id}
                                                        type="button"
                                                        role="tab"
                                                        aria-selected={selected}
                                                        onClick={() => setActiveTab(tab.id)}
                                                        className={`type-button flex h-10 w-full items-center gap-2.5 rounded-2xl px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 ${selected ? 'bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'}`}
                                                    >
                                                        <Icon className="h-4 w-4" />
                                                        {tab.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ) : null}
                            </aside>

                            <main data-testid="settings-modal-content" className="relative flex min-w-0 flex-1 flex-col">
                                <header className="shrink-0 px-6 pb-3 pt-5">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <div className="type-caption-1 text-zinc-500">
                                                {activeSection === 'platform' ? adminCopy.platform : t.systemSettings}
                                            </div>
                                            <h2 className="type-title-3 mt-3 text-zinc-100">{activeTabLabel}</h2>
                                        </div>
                                        {activeSection === 'platform' && activeTab === 'mcp' && effectiveCanManageMcp ? (
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
                                                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/5 text-zinc-100 shadow-sm shadow-black/20 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
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
                                                        className="input-surface absolute right-0 top-12 z-[260] w-56 overflow-hidden rounded-3xl border border-white/15 p-1.5 shadow-2xl shadow-black/40"
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
                                                            className="type-button flex h-10 w-full items-center gap-3 rounded-2xl px-3 text-left text-zinc-100 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                                                        >
                                                            <Network className="h-4 w-4 text-orange-300" />
                                                            {isScanningActiveMcp ? mcpCopy.form.scanning : mcpCopy.form.scanActive}
                                                        </button>
                                                        <div className="my-1 h-px bg-white/10" />
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
                                                            className="type-button flex h-10 w-full items-center gap-3 rounded-2xl px-3 text-left text-zinc-100 transition-colors hover:bg-white/10"
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

                                <div className="mx-6 h-px shrink-0 bg-white/10" />

                                <div
                                    data-testid="settings-modal-scroll-area"
                                    className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-2 [scrollbar-gutter:stable]"
                                >
                                {activeSection === 'personal' && activeTab === 'general' ? (
                                    <div className="divide-y divide-white/10">
                                        <label className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center">
                                            <span className="type-subheadline flex items-center gap-2.5 text-zinc-100">
                                                <Globe className="h-4 w-4 text-zinc-400" />
                                                {t.language}
                                            </span>
                                            <select
                                                value={lang}
                                                onChange={(event) => onSetLang(event.target.value as Language)}
                                                className="glass-control type-input h-11 w-full rounded-2xl px-3"
                                            >
                                                {LANGUAGE_OPTIONS.map((option) => (
                                                    <option key={option.code} value={option.code}>
                                                        {option.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                    </div>
                                ) : null}

                                {activeSection === 'platform' && activeTab === 'general' ? (
                                    <div className="divide-y divide-white/10">
                                        {effectiveCanManageWorkspace ? (
                                        <div className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center">
                                            <span className="type-subheadline flex items-center gap-2.5 text-zinc-100">
                                                <FolderOpen className="h-4 w-4 text-zinc-400" />
                                                {text.workspacePath}
                                            </span>
                                            <div className="min-w-0 space-y-2">
	                                                <div className="type-code-sm rounded-2xl border border-white/15 bg-white/[0.04] px-3 py-3 text-zinc-100">
                                                    {workspacePath || adminCopy.workspaceManaged}
                                                </div>
                                                <div className="type-footnote text-zinc-500">
                                                    {adminCopy.workspaceNote}
                                                </div>
                                                {workspaceStatus ? (
                                                    <div className="type-footnote text-emerald-400">{workspaceStatus}</div>
                                                ) : null}
                                            </div>
                                        </div>
                                        ) : null}

                                        {effectiveCanManageSecrets ? (
                                        <div className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-start">
                                            <span className="type-subheadline flex items-center gap-2.5 text-zinc-100 sm:mt-2.5">
                                                <Search className="h-4 w-4 text-zinc-400" />
                                                {text.webSearch}
                                            </span>
                                            <div className="min-w-0 space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <select
                                                        aria-label={text.searchBackend}
                                                        value={webSearchAdapter}
                                                        onChange={(event) => setWebSearchAdapter(event.target.value as WebSearchAdapter)}
                                                        className="type-input h-11 min-w-0 flex-1 rounded-2xl border border-white/15 bg-white/[0.04] px-3 text-zinc-100 outline-none transition-colors focus:border-white/35 focus:bg-white/[0.06]"
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
                                                        className="type-input h-11 w-full rounded-2xl border border-white/15 bg-white/[0.04] px-3 text-zinc-100 outline-none transition-colors focus:border-white/35 focus:bg-white/[0.06]"
                                                    />
                                                ) : null}
                                                {webToolsStatus ? (
                                                    <div className="type-footnote text-emerald-400">{webToolsStatus}</div>
                                                ) : null}
                                            </div>
                                        </div>
                                        ) : null}
                                    </div>
                                ) : null}

                                {activeSection === 'platform' && activeTab === 'invitations' && effectiveCanManageInvitations ? (
                                    <InvitationSettingsPanel
                                        required={invitationRequired}
                                        invitations={invitations}
                                        newCode={newInvitationCode}
                                        newLabel={newInvitationLabel}
                                        newMaxUses={newInvitationMaxUses}
                                        status={invitationStatus}
                                        isSaving={isSavingInvitations}
                                        onToggleRequired={() => setInvitationRequired((value) => !value)}
                                        onNewCodeChange={setNewInvitationCode}
                                        onNewLabelChange={setNewInvitationLabel}
                                        onNewMaxUsesChange={setNewInvitationMaxUses}
                                        onCreate={() => void handleCreateInvitation()}
                                        onToggleInvitation={(invitation) => void handleToggleInvitation(invitation)}
                                        onDeleteInvitation={(id) => void handleDeleteInvitation(id)}
                                    />
                                ) : null}

                                {activeSection === 'platform' && activeTab === 'runtime' && effectiveCanManageRuntimeSettings ? (
                                    <div className="divide-y divide-white/10">
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
                                            <div className="type-footnote py-2 text-amber-300">{runtimeSettingsStatus}</div>
                                        ) : null}
                                    </div>
                                ) : null}

                                {activeSection === 'platform' && activeTab === 'model' && effectiveCanManageModelConfig ? (
                                    <>
                                        <form
                                            className="divide-y divide-white/10"
                                            autoComplete="off"
                                            onSubmit={(event) => {
                                                event.preventDefault();
                                                if (!isSaveDisabled) void handleSaveSettings();
                                            }}
                                        >
                                            <label className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center">
                                                <span className="type-subheadline text-zinc-100">{text.provider}</span>
                                                <select
                                                    aria-label={text.provider}
                                                    value={provider}
                                                    onChange={(event) => setProvider(event.target.value as ModelProviderKind)}
                                                    className="type-input h-11 w-full rounded-2xl border border-white/15 bg-white/[0.04] px-3 text-zinc-100 outline-none transition-colors focus:border-white/35 focus:bg-white/[0.06]"
                                                >
                                                    <option value="openai-compatible">OpenAI Compatible</option>
                                                    <option value="anthropic-compatible">Anthropic API Compatible</option>
                                                    <option value="gemini">Gemini</option>
                                                    <option value="grok">Grok</option>
                                                </select>
                                            </label>

                                            <label className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center">
                                                <span className="type-subheadline text-zinc-100">{text.baseUrl}</span>
                                                <input
                                                    aria-label={text.baseUrl}
                                                    value={baseUrl}
                                                    onChange={(event) => setBaseUrl(event.target.value)}
                                                    placeholder="https://api.example.com/v1"
                                                    className="type-input h-11 w-full rounded-2xl border border-white/15 bg-white/[0.04] px-3 text-zinc-100 outline-none transition-colors focus:border-white/35 focus:bg-white/[0.06]"
                                                />
                                            </label>

                                            <label className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center">
                                                <span className="type-subheadline text-zinc-100">{text.apiKey}</span>
                                                <input
                                                    aria-label={text.apiKey}
                                                    type="password"
                                                    autoComplete="new-password"
                                                    value={apiKey}
                                                    onChange={(event) => setApiKey(event.target.value)}
                                                    placeholder={apiKeyPreview ? `${savedPrefix}${apiKeyPreview}` : 'sk-...'}
                                                    className="type-input h-11 w-full rounded-2xl border border-white/15 bg-white/[0.04] px-3 text-zinc-100 outline-none transition-colors focus:border-white/35 focus:bg-white/[0.06]"
                                                />
                                            </label>

                                            <div className="grid gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-start">
                                                <span className="type-subheadline text-zinc-100 sm:mt-2.5">{text.models}</span>
                                                <div className="grid gap-2">
                                                    <label className="grid gap-2 sm:grid-cols-[6rem_1fr] sm:items-center">
                                                        <span className="type-caption-1 text-zinc-500">{text.fast}</span>
                                                        <input
                                                            aria-label={text.fastModel}
                                                            value={fastModel}
                                                            onChange={(event) => setFastModel(event.target.value)}
                                                            placeholder="qwen3.5-flash"
                                                            className="type-input h-11 w-full rounded-2xl border border-white/15 bg-white/[0.04] px-3 text-zinc-100 outline-none transition-colors focus:border-white/35 focus:bg-white/[0.06]"
                                                        />
                                                    </label>
                                                    <label className="grid gap-2 sm:grid-cols-[6rem_1fr] sm:items-center">
                                                        <span className="type-caption-1 text-zinc-500">{text.balanced}</span>
                                                        <input
                                                            aria-label={text.balancedModel}
                                                            value={balancedModel}
                                                            onChange={(event) => setBalancedModel(event.target.value)}
                                                            placeholder="qwen3.7-plus"
                                                            className="type-input h-11 w-full rounded-2xl border border-white/15 bg-white/[0.04] px-3 text-zinc-100 outline-none transition-colors focus:border-white/35 focus:bg-white/[0.06]"
                                                        />
                                                    </label>
                                                    <label className="grid gap-2 sm:grid-cols-[6rem_1fr] sm:items-center">
                                                        <span className="type-caption-1 text-zinc-500">{text.strong}</span>
                                                        <input
                                                            aria-label={text.strongModel}
                                                            value={strongModel}
                                                            onChange={(event) => setStrongModel(event.target.value)}
                                                            placeholder="qwen3.7-max"
                                                            className="type-input h-11 w-full rounded-2xl border border-white/15 bg-white/[0.04] px-3 text-zinc-100 outline-none transition-colors focus:border-white/35 focus:bg-white/[0.06]"
                                                        />
                                                    </label>
                                                </div>
                                            </div>
                                        </form>

                                        <div className="flex items-center justify-between gap-3">
                                            <span className="type-footnote text-emerald-400">{status}</span>
                                        </div>
                                    </>
                                ) : null}
                                {activeSection === 'platform' && activeTab === 'mcp' && effectiveCanManageMcp ? (
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
                                {activeSection === 'platform' && activeTab !== 'mcp' && (activeTab !== 'general' || hasGeneralSaveAction) ? (
                                <div className="flex items-center justify-end border-t border-white/10 bg-white/[0.02] px-6 py-4">
                                    <button
                                        type="button"
                                        aria-label={text.saveSettings}
                                        onClick={handleSaveSettings}
                                        disabled={isSaveDisabled}
                                        className="primary-pill inline-flex h-11 items-center px-6 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {isSavingCurrentTab ? text.saving : text.saveSettings}
                                    </button>
                                </div>
                                ) : null}
                            </main>
                        </div>
                    </div>
                </div>
    );
}

function getWebSearchKeyField(adapter: WebSearchAdapter): 'brave' | 'exa' | null {
    if (adapter === 'brave') return 'brave';
    if (adapter === 'exa') return 'exa';
    return null;
}

type SettingsTranslate = (key: string, options?: Record<string, unknown>) => string;

function getAdminSettingsCopy(translate: SettingsTranslate) {
    return {
        title: translate('admin.title'),
        platform: translate('admin.platform'),
        deployment: translate('admin.deployment'),
        workspaceManaged: translate('admin.workspaceManaged'),
        workspaceNote: translate('admin.workspaceNote'),
    };
}

function parsePositiveInteger(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== trimmed) return null;
    return parsed;
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
	    if (isTesting) return 'text-orange-300';
	    if (!health) return 'text-zinc-500';
	    return health.ok ? 'text-emerald-400' : 'text-red-400';
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
            className={`relative h-7 w-12 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 ${checked ? 'border-emerald-300/60 bg-emerald-400' : 'border-white/15 bg-white/[0.04]'}`}
        >
            <span
                className={`absolute left-1 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-zinc-50 shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`}
            />
        </button>
    );
}

function InvitationSettingsPanel({
    required,
    invitations,
    newCode,
    newLabel,
    newMaxUses,
    status,
    isSaving,
    onToggleRequired,
    onNewCodeChange,
    onNewLabelChange,
    onNewMaxUsesChange,
    onCreate,
    onToggleInvitation,
    onDeleteInvitation,
}: {
    required: boolean;
    invitations: InvitationRecord[];
    newCode: string;
    newLabel: string;
    newMaxUses: string;
    status: string;
    isSaving: boolean;
    onToggleRequired: () => void;
    onNewCodeChange: (value: string) => void;
    onNewLabelChange: (value: string) => void;
    onNewMaxUsesChange: (value: string) => void;
    onCreate: () => void;
    onToggleInvitation: (invitation: InvitationRecord) => void;
    onDeleteInvitation: (id: string) => void;
}) {
    return (
        <div className="space-y-5 py-2">
            <div className="divide-y divide-white/10 border-y border-white/10">
                <div className="flex min-h-16 items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                        <div className="type-subheadline flex items-center gap-2.5 text-zinc-100">
                            <Ticket className="h-4 w-4 text-zinc-400" />
                            注册邀请码
                        </div>
                        <div className="type-footnote mt-1 text-zinc-500">
                            开启后，邮箱注册必须先提供可用邀请码。
                        </div>
                    </div>
                    <Switch checked={required} label="注册邀请码" onClick={onToggleRequired} />
                </div>

                <div className="grid gap-3 py-3 sm:grid-cols-[10.5rem_1fr]">
                    <span className="type-subheadline text-zinc-100 sm:mt-2.5">新增邀请码</span>
                    <div className="grid gap-2">
                        <input
                            aria-label="邀请码"
                            value={newCode}
                            onChange={(event) => onNewCodeChange(event.target.value)}
                            placeholder="例如 BEE-ALPHA"
                            className="type-input h-11 w-full rounded-2xl border border-white/15 bg-white/[0.04] px-3 text-zinc-100 outline-none transition-colors focus:border-white/35 focus:bg-white/[0.06]"
                        />
                        <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
                            <input
                                aria-label="邀请码备注"
                                value={newLabel}
                                onChange={(event) => onNewLabelChange(event.target.value)}
                                placeholder="备注，可选"
                                className="type-input h-11 w-full rounded-2xl border border-white/15 bg-white/[0.04] px-3 text-zinc-100 outline-none transition-colors focus:border-white/35 focus:bg-white/[0.06]"
                            />
                            <input
                                aria-label="最大使用次数"
                                inputMode="numeric"
                                value={newMaxUses}
                                onChange={(event) => onNewMaxUsesChange(event.target.value)}
                                placeholder="次数"
                                className="type-input h-11 w-full rounded-2xl border border-white/15 bg-white/[0.04] px-3 text-zinc-100 outline-none transition-colors focus:border-white/35 focus:bg-white/[0.06]"
                            />
                        </div>
                        <div className="flex justify-end">
                            <button
                                type="button"
                                onClick={onCreate}
                                disabled={isSaving || !newCode.trim()}
                                className="primary-pill inline-flex h-10 items-center px-5 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                创建邀请码
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-2">
                <div className="type-caption-1 text-zinc-500">邀请码列表</div>
                {invitations.length ? (
                    <div className="divide-y divide-white/10 overflow-hidden rounded-3xl border border-white/10">
                        {invitations.map((invitation) => (
                            <div key={invitation.id} className="flex items-center justify-between gap-3 px-4 py-3">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className={`h-2 w-2 shrink-0 rounded-full ${invitation.enabled ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                                        <span className="type-footnote truncate text-zinc-100">
                                            {invitation.code || invitation.label || '未命名邀请码'}
                                        </span>
                                    </div>
                                    {invitation.label && invitation.label !== invitation.code ? (
                                        <div className="type-footnote mt-1 truncate pl-4 text-zinc-400">{invitation.label}</div>
                                    ) : null}
                                    <div className="type-footnote mt-1 truncate pl-4 text-zinc-500">
                                        已用 {invitation.usedCount}{invitation.maxUses ? ` / ${invitation.maxUses}` : ''}
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => onToggleInvitation(invitation)}
                                        disabled={isSaving}
                                        className="type-button h-9 rounded-full border border-white/15 px-3 text-zinc-100 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {invitation.enabled ? '禁用' : '启用'}
                                    </button>
                                    <button
                                        type="button"
                                        aria-label="删除邀请码"
                                        onClick={() => onDeleteInvitation(invitation.id)}
                                        disabled={isSaving || invitation.usedCount > 0}
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-zinc-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="type-footnote rounded-3xl border border-white/10 px-4 py-4 text-zinc-500">
                        还没有邀请码。
                    </div>
                )}
                {status ? (
                    <div className="type-footnote text-amber-300">{status}</div>
                ) : null}
            </div>
        </div>
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
            <p className="type-callout max-w-2xl text-zinc-400">{copy.intro}</p>

            <div className="divide-y divide-white/10 border-y border-white/10">
                <div className="type-caption-1 py-3 text-zinc-500">
                    {copy.configured}
                </div>
                {servers.length ? servers.map((server) => (
                    <div key={server.id} className="flex items-center justify-between gap-3 py-3">
                        <button
                            type="button"
                            onClick={(event) => onEdit(server, toPopoverAnchorRect(event.currentTarget.getBoundingClientRect()))}
                            className="min-w-0 flex-1 rounded-2xl px-2 py-1 text-left transition-colors hover:bg-white/5"
                        >
                            <div className="flex items-center gap-2">
                                <span className={`h-2 w-2 shrink-0 rounded-full ${server.enabled ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                                <span className="type-footnote truncate text-zinc-100">{server.name}</span>
                            </div>
                            <div className="type-footnote mt-1 truncate pl-4 text-zinc-500">
                                {server.transport} · {server.scope}
                            </div>
                            <div className="type-footnote mt-1 flex items-center gap-2 pl-4">
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
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/15 text-zinc-300 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
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
                                        className="input-surface absolute right-0 top-10 z-[260] w-44 overflow-hidden rounded-3xl border border-white/15 p-1.5 shadow-2xl shadow-black/40"
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
                                            className="type-button flex h-9 w-full items-center gap-3 rounded-2xl px-3 text-left text-zinc-100 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
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
                                            className="type-button flex h-9 w-full items-center gap-3 rounded-2xl px-3 text-left text-zinc-100 transition-colors hover:bg-white/10"
                                        >
                                            <FolderOpen className="h-3.5 w-3.5 text-zinc-400" />
                                            {copy.form.edit}
                                        </button>
                                        <div className="my-1 h-px bg-white/10" />
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => {
                                                setActiveServerMenuId('');
                                                onDelete(server.id);
                                            }}
                                            disabled={isSaving}
                                            className="type-button flex h-9 w-full items-center gap-3 rounded-2xl px-3 text-left text-red-200 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
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
                    <div className="type-callout py-4 text-zinc-500">{copy.noServers}</div>
                )}
            </div>

            {activeDiscovered.length ? (
                <div className="divide-y divide-white/10 border-y border-white/10">
                    <div className="type-caption-1 py-3 text-zinc-500">
                        {copy.form.activeDiscovered}
                    </div>
                    {activeDiscovered.map((server) => (
                        <div key={`${server.endpoint}:${server.name}`} className="flex items-center justify-between gap-3 py-3">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                                    <span className="type-footnote truncate text-zinc-100">{server.name}</span>
                                    <span className="type-footnote text-emerald-400">{copy.form.available}</span>
                                </div>
                                <div className="type-footnote mt-1 truncate pl-4 text-zinc-500">
                                    {server.transport} · {server.endpoint}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => onImportActive(server)}
                                disabled={isSaving || server.exists}
                                className="type-button h-8 shrink-0 rounded-full border border-white/15 px-3 text-zinc-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {server.exists ? copy.form.existing : copy.form.importServer}
                            </button>
                        </div>
                    ))}
                </div>
            ) : null}

            {discovered.length ? (
                <div className="divide-y divide-white/10 border-y border-white/10">
                    <div className="type-caption-1 py-3 text-zinc-500">
                        {copy.form.discovered}
                    </div>
                    {discovered.map((server) => (
                        <div key={`${server.sourcePath}:${server.name}`} className="flex items-center justify-between gap-3 py-3">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className={`h-2 w-2 shrink-0 rounded-full ${server.exists ? 'bg-zinc-600' : 'bg-emerald-400'}`} />
                                    <span className="type-footnote truncate text-zinc-100">{server.name}</span>
                                </div>
                                <div className="type-footnote mt-1 truncate pl-4 text-zinc-500">
                                    {server.transport} · {copy.form.source}: {server.sourcePath}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => onImport(server)}
                                disabled={isSaving || server.exists}
                                className="type-button h-8 shrink-0 rounded-full border border-white/15 px-3 text-zinc-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {server.exists ? copy.form.existing : copy.form.importServer}
                            </button>
                        </div>
                    ))}
                </div>
            ) : null}

            {status ? <div className="type-footnote text-amber-300">{status}</div> : null}
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
                    className="absolute -top-2 h-4 w-4 rotate-45 border-l border-t border-white/15 bg-zinc-950/80"
                    style={{ left: placement.arrowLeft }}
                />
                <div className="input-surface relative flex max-h-[min(480px,calc(100vh-8rem))] w-[min(360px,calc(100vw-3rem))] flex-col overflow-hidden rounded-3xl border border-white/15 shadow-2xl shadow-black/50">
                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2 [scrollbar-gutter:stable]">
                        <div className="relative z-10 divide-y divide-white/10">
                            <label className="grid gap-2 py-3">
                                <span className="type-caption-1 text-zinc-500">{copy.form.name}</span>
                                <input
                                    aria-label={copy.form.name}
                                    value={form.name}
                                    onChange={(event) => update({ name: event.target.value })}
                                    className="type-input h-10 w-full rounded-2xl border border-white/15 bg-white/[0.04] px-3 text-zinc-100 outline-none transition-colors focus:border-white/35 focus:bg-white/[0.06]"
                                />
                            </label>

                            <div className="flex items-center justify-between gap-3 py-3">
                                <span className="type-footnote text-zinc-100">{copy.form.enabled}</span>
                                <Switch checked={form.enabled} label={copy.form.enabled} onClick={() => update({ enabled: !form.enabled })} />
                            </div>

                            <label className="grid gap-2 py-3">
                                <span className="type-caption-1 text-zinc-500">{copy.form.transport}</span>
                                <select
                                    aria-label={copy.form.transport}
                                    value={form.transport}
                                    onChange={(event) => update({ transport: event.target.value as McpServerTransport })}
                                    className="type-input h-10 w-full rounded-2xl border border-white/15 bg-white/[0.04] px-3 text-zinc-100 outline-none transition-colors focus:border-white/35 focus:bg-white/[0.06]"
                                >
                                    <option value="stdio">{copy.form.stdio}</option>
                                    <option value="sse">{copy.form.sse}</option>
                                    <option value="http">{copy.form.http}</option>
                                </select>
                            </label>

                            {form.transport !== 'stdio' ? (
                                <label className="grid gap-2 py-3">
                                    <span className="type-caption-1 text-zinc-500">{copy.form.url}</span>
                                    <input
                                        aria-label={copy.form.url}
                                        value={form.url}
                                        onChange={(event) => update({ url: event.target.value })}
                                        placeholder="http://127.0.0.1:3000/mcp"
                                        className="type-input h-10 w-full rounded-2xl border border-white/15 bg-white/[0.04] px-3 text-zinc-100 outline-none transition-colors focus:border-white/35 focus:bg-white/[0.06]"
                                    />
                                </label>
                            ) : null}

                            <div className="py-2">
                                <button
                                    type="button"
                                    aria-expanded={advancedOpen}
                                    onClick={() => setAdvancedOpen((current) => !current)}
                                    className="type-button flex h-9 w-full items-center justify-between rounded-2xl px-2 text-left text-zinc-200 transition-colors hover:bg-white/5"
                                >
                                    <span>{copy.form.advanced}</span>
                                    <span className={`text-zinc-500 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}>⌄</span>
                                </button>
                                {advancedOpen ? (
                                    <div className="mt-1 divide-y divide-white/10">
                                        {form.transport === 'stdio' ? (
                                            <>
                                                <label className="grid gap-2 py-3">
                                                    <span className="type-caption-1 text-zinc-500">{copy.form.command}</span>
                                                    <input
                                                        aria-label={copy.form.command}
                                                        value={form.command}
                                                        onChange={(event) => update({ command: event.target.value })}
                                                        placeholder="npx"
	                                                        className="type-code h-10 w-full rounded-2xl border border-white/15 bg-white/[0.04] px-3 text-zinc-100 outline-none transition-colors focus:border-white/35 focus:bg-white/[0.06]"
                                                    />
                                                </label>
                                                <label className="grid gap-2 py-3">
                                                    <span className="type-caption-1 text-zinc-500">{copy.form.args}</span>
                                                    <div className="space-y-1">
                                                        <textarea
                                                            aria-label={copy.form.args}
                                                            value={form.argsText}
                                                            onChange={(event) => update({ argsText: event.target.value })}
                                                            rows={3}
	                                                            className="type-code w-full resize-none rounded-2xl border border-white/15 bg-white/[0.04] px-3 py-2 text-zinc-100 outline-none transition-colors focus:border-white/35 focus:bg-white/[0.06]"
                                                        />
                                                        <div className="type-footnote text-zinc-500">{copy.form.argsHint}</div>
                                                    </div>
                                                </label>
                                            </>
                                        ) : null}
                                        <label className="grid gap-2 py-3">
                                            <span className="type-caption-1 text-zinc-500">{copy.form.scope}</span>
                                            <select
                                                aria-label={copy.form.scope}
                                                value={form.scope}
                                                onChange={(event) => update({ scope: event.target.value as McpServerScope })}
                                                className="type-input h-10 w-full rounded-2xl border border-white/15 bg-white/[0.04] px-3 text-zinc-100 outline-none transition-colors focus:border-white/35 focus:bg-white/[0.06]"
                                            >
                                                <option value="beegame">{copy.form.beegame}</option>
                                                <option value="project">{copy.form.project}</option>
                                                <option value="global">{copy.form.global}</option>
                                            </select>
                                        </label>

                                        <label className="grid gap-2 py-3">
                                            <span className="type-caption-1 text-zinc-500">{copy.form.cwd}</span>
                                            <input
                                                aria-label={copy.form.cwd}
                                                value={form.cwd}
                                                onChange={(event) => update({ cwd: event.target.value })}
	                                                className="type-code h-10 w-full rounded-2xl border border-white/15 bg-white/[0.04] px-3 text-zinc-100 outline-none transition-colors focus:border-white/35 focus:bg-white/[0.06]"
                                            />
                                        </label>

                                        <label className="grid gap-2 py-3">
                                            <span className="type-caption-1 text-zinc-500">{copy.form.env}</span>
                                            <div className="space-y-1">
                                                <textarea
                                                    aria-label={copy.form.env}
                                                    value={form.envText}
                                                    onChange={(event) => update({ envText: event.target.value })}
                                                    rows={3}
	                                                    className="type-code w-full resize-none rounded-2xl border border-white/15 bg-white/[0.04] px-3 py-2 text-zinc-100 outline-none transition-colors focus:border-white/35 focus:bg-white/[0.06]"
                                                />
                                                <div className="type-footnote text-zinc-500">{copy.form.envHint}</div>
                                            </div>
                                        </label>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                        {status ? <div className="type-footnote py-2 text-amber-300">{status}</div> : null}
                    </div>

                    {mode === 'create' ? (
                        <footer className="relative z-10 flex shrink-0 items-center justify-end gap-2 border-t border-white/10 bg-white/[0.02] px-4 py-3">
                            <button
                                type="button"
                                onClick={onClose}
	                                className="secondary-pill type-button h-9 px-4 text-zinc-200"
                            >
                                {copy.form.cancel}
                            </button>
                            <button
                                type="button"
                                onClick={onSave}
                                disabled={saveDisabled}
                                className="primary-pill h-9 px-4 disabled:cursor-not-allowed disabled:opacity-50"
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
                    <span className="type-footnote text-zinc-100">{item.label}</span>
                </div>
                <div className="type-footnote mt-1 space-y-0.5 text-zinc-500">
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
                className={`relative h-7 w-12 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 ${checked ? 'border-emerald-300/60 bg-emerald-400' : 'border-white/15 bg-white/[0.04]'}`}
            >
                <span
                    className={`absolute left-1 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-zinc-50 shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`}
                />
            </button>
        </div>
    );
}
