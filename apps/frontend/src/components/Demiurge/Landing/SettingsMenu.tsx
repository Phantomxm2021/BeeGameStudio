import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import { Bot, Brain, BookOpenText, Cpu, FolderOpen, Globe, KeyRound, MoreHorizontal, Network, Plus, Plus as FaPlus, ReceiptText, Search, ShieldCheck, Ticket, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LANGUAGE_OPTIONS, type Language } from '../AgentsConfig';
import { Switch } from '../../ui/switch';
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
    deleteUserSkill,
    importUserSkillPackage,
    listUserSkills,
    updateUserSkillEnabled,
    type UserSkill,
} from '../../../services/userSkillsApi';
import {
    createInvitation,
    deleteInvitation,
    getInvitationPublicSettings,
    listInvitations,
    saveInvitationSettings,
    updateInvitation,
    type InvitationRecord,
} from '../../../services/invitationApi';
import {
    getBillingCreditPacks,
    getBillingEvents,
    getCreditAuditLedger,
    upsertBillingCreditPack,
    type BeeGameBillingCreditPack,
    type BeeGameBillingEvent,
    type BeeGameCreditAuditLedger,
    type BeeGameCreditLedgerEntry,
} from '../../../services/creditsApi';
import {
    getProjectLifecycleOverview,
    planProjectRetention,
    runProjectRetention,
    type BeeGameProjectLifecycleDeletion,
    type BeeGameProjectLifecycleOverview,
    type BeeGameProjectLifecycleProject,
    type BeeGameProjectRetentionResult,
} from '../../../services/projectLifecycleApi';
import { useSystemStore } from '../../../store/systemStore';
import { useToastContext } from '../../../contexts/ToastContext';
interface SettingsMenuProps {
    isOpen: boolean;
    lang: Language;
    onClose: () => void;
    onSetLang: (lang: Language) => void;
    canManageWorkspace?: boolean;
    canManageSecrets?: boolean;
    canManageRuntimeSettings?: boolean;
    canManageMcp?: boolean;
    canManageSkills?: boolean;
    canManageModelConfig?: boolean;
    canManageInvitations?: boolean;
    canReadAudit?: boolean;
}

type SettingsSection = 'personal' | 'skills' | 'platform';
type SettingsTab = 'general' | 'runtime' | 'mcp' | 'skills' | 'model' | 'invitations' | 'projects' | 'credit';
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

type BillingPackFormState = {
    priceId: string;
    credits: string;
    displayName: string;
    sortOrder: string;
    enabled: boolean;
};

export function SettingsMenu({
    isOpen,
    lang,
    onClose,
    onSetLang,
    canManageWorkspace,
    canManageSecrets,
    canManageRuntimeSettings,
    canManageMcp,
    canManageSkills,
    canManageModelConfig,
    canManageInvitations,
    canReadAudit,
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
    const billingCopy = getBillingSettingsCopy(translateSettings);
    const projectLifecycleCopy = getProjectLifecycleSettingsCopy(translateSettings);
    const userSkillsCopy = getUserSkillsSettingsCopy(translateSettings);
    const { showError, showSuccess } = useToastContext();
    const currentUser = useSystemStore(state => state.currentUser);
    const hasPermission = useSystemStore(state => state.hasPermission);
    const canOpenPlatformSettings = currentUser?.role === 'owner';
    const effectiveCanManageWorkspace = canManageWorkspace ?? (canOpenPlatformSettings && hasPermission('workspace.manage'));
    const effectiveCanManageSecrets = canManageSecrets ?? (canOpenPlatformSettings && hasPermission('secrets.manage'));
    const effectiveCanManageRuntimeSettings = canManageRuntimeSettings ?? (canOpenPlatformSettings && hasPermission('runtime_settings.manage'));
    const effectiveCanManageMcp = canManageMcp ?? (canOpenPlatformSettings && hasPermission('mcp.manage'));
    const effectiveCanManageSkills = canManageSkills ?? Boolean(currentUser);
    const effectiveCanManageModelConfig = canManageModelConfig ?? (canOpenPlatformSettings && hasPermission('model_config.manage'));
    const effectiveCanManageInvitations = canManageInvitations ?? canOpenPlatformSettings;
    const effectiveCanReadAudit = canReadAudit ?? (canOpenPlatformSettings && hasPermission('audit.read'));
    const hasPlatformSettings = effectiveCanManageWorkspace ||
        effectiveCanManageSecrets ||
        effectiveCanManageRuntimeSettings ||
        effectiveCanManageMcp ||
        effectiveCanManageModelConfig ||
        effectiveCanManageInvitations ||
        effectiveCanReadAudit;
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
    const [userSkills, setUserSkills] = useState<UserSkill[]>([]);
    const [isSavingUserSkill, setIsSavingUserSkill] = useState(false);
    const [activeTab, setActiveTab] = useState<SettingsTab>('general');
    const [activeSection, setActiveSection] = useState<SettingsSection>('personal');
    const userSkillImportInputRef = useRef<HTMLInputElement | null>(null);
    const [subagentsEnabled, setSubagentsEnabled] = useState(true);
    const [invitationRequired, setInvitationRequired] = useState(false);
    const [invitations, setInvitations] = useState<InvitationRecord[]>([]);
    const [newInvitationCode, setNewInvitationCode] = useState('');
    const [newInvitationLabel, setNewInvitationLabel] = useState('');
    const [newInvitationMaxUses, setNewInvitationMaxUses] = useState('');
    const [invitationStatus, setInvitationStatus] = useState('');
    const [isSavingInvitations, setIsSavingInvitations] = useState(false);
    const [projectLifecycleOverview, setProjectLifecycleOverview] = useState<BeeGameProjectLifecycleOverview | null>(null);
    const [projectLifecycleStatus, setProjectLifecycleStatus] = useState('');
    const [projectRetentionResult, setProjectRetentionResult] = useState<BeeGameProjectRetentionResult | null>(null);
    const [isProjectRetentionRunning, setIsProjectRetentionRunning] = useState(false);
    const [creditAuditLedger, setCreditAuditLedger] = useState<BeeGameCreditAuditLedger | null>(null);
    const [creditAuditStatus, setCreditAuditStatus] = useState('');
    const [billingCreditPacks, setBillingCreditPacks] = useState<BeeGameBillingCreditPack[]>([]);
    const [billingEvents, setBillingEvents] = useState<BeeGameBillingEvent[]>([]);
    const [billingPackForm, setBillingPackForm] = useState(createEmptyBillingPackForm());
    const [isSavingBillingPack, setIsSavingBillingPack] = useState(false);
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
                        setInvitationStatus(error instanceof Error ? error.message : adminCopy.invitation.unavailable);
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
        if (effectiveCanManageSkills) {
            void listUserSkills()
                .then((skills) => {
                    if (cancelled) return;
                    setUserSkills(uniqueUserSkills(skills));
                })
                .catch((error) => {
                    if (!cancelled) {
                        setUserSkills([]);
                        showError(error instanceof Error ? error.message : userSkillsCopy.unavailable);
                    }
                });
        }
        if (effectiveCanReadAudit) {
            void getProjectLifecycleOverview()
                .then((overview) => {
                    if (cancelled) return;
                    setProjectLifecycleOverview(overview);
                    setProjectLifecycleStatus('');
                })
                .catch((error) => {
                    if (!cancelled) {
                        setProjectLifecycleOverview(null);
                        setProjectLifecycleStatus(error instanceof Error ? error.message : projectLifecycleCopy.unavailable);
                    }
                });
            void getCreditAuditLedger()
                .then((ledger) => {
                    if (cancelled) return;
                    setCreditAuditLedger(ledger);
                    setCreditAuditStatus('');
                })
                .catch((error) => {
                    if (!cancelled) {
                        setCreditAuditLedger(null);
                        setCreditAuditStatus(error instanceof Error ? error.message : billingCopy.auditUnavailable);
                    }
                });
            void Promise.all([getBillingCreditPacks(), getBillingEvents()])
                .then(([packs, events]) => {
                    if (cancelled) return;
                    setBillingCreditPacks(packs.packs);
                    setBillingEvents(events.events);
                    setBillingPackForm(createEmptyBillingPackForm());
                })
                .catch((error) => {
                    if (!cancelled) {
                        setBillingCreditPacks([]);
                        setBillingEvents([]);
                        setCreditAuditStatus(error instanceof Error ? error.message : billingCopy.billingUnavailable);
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
        effectiveCanManageSkills,
        effectiveCanManageModelConfig,
        effectiveCanManageInvitations,
        effectiveCanManageRuntimeSettings,
        effectiveCanManageSecrets,
        effectiveCanManageWorkspace,
        effectiveCanReadAudit,
        isOpen,
        billingCopy.auditUnavailable,
        billingCopy.billingUnavailable,
        projectLifecycleCopy.unavailable,
        showError,
        text.webToolsReadFailed,
        text.workspaceReadFailed,
        userSkillsCopy.unavailable,
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
            setInvitationStatus(saved.required ? adminCopy.invitation.enabledStatus : adminCopy.invitation.disabledStatus);
            return true;
        } catch (error) {
            setInvitationStatus(error instanceof Error ? error.message : adminCopy.invitation.saveFailed);
            return false;
        } finally {
            setIsSavingInvitations(false);
        }
    };

    const handleCreateInvitation = async () => {
        const code = newInvitationCode.trim();
        if (!code) {
            setInvitationStatus(adminCopy.invitation.codeRequired);
            return;
        }
        const maxUses = parsePositiveInteger(newInvitationMaxUses);
        if (newInvitationMaxUses.trim() && maxUses === null) {
            setInvitationStatus(adminCopy.invitation.maxUsesInvalid);
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
            setInvitationStatus(error instanceof Error ? error.message : adminCopy.invitation.createFailed);
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
            setInvitationStatus(error instanceof Error ? error.message : adminCopy.invitation.updateFailed);
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
            setInvitationStatus(error instanceof Error ? error.message : adminCopy.invitation.deleteFailed);
        } finally {
            setIsSavingInvitations(false);
        }
    };

    const refreshProjectLifecycleOverview = async () => {
        const overview = await getProjectLifecycleOverview();
        setProjectLifecycleOverview(overview);
        return overview;
    };

    const handlePlanProjectRetention = async () => {
        setProjectLifecycleStatus('');
        setIsProjectRetentionRunning(true);
        try {
            const result = await planProjectRetention();
            setProjectRetentionResult(result);
            setProjectLifecycleStatus(projectLifecycleCopy.dryRunStatus(result.summary.deploymentRecordsPlannedForDeletion));
        } catch (error) {
            setProjectLifecycleStatus(error instanceof Error ? error.message : projectLifecycleCopy.dryRunFailed);
        } finally {
            setIsProjectRetentionRunning(false);
        }
    };

    const handleRunProjectRetention = async () => {
        setProjectLifecycleStatus('');
        setIsProjectRetentionRunning(true);
        try {
            const result = await runProjectRetention();
            setProjectRetentionResult(result);
            setProjectLifecycleStatus(projectLifecycleCopy.runStatus(result.summary.deploymentRecordsDeleted));
            await refreshProjectLifecycleOverview();
        } catch (error) {
            setProjectLifecycleStatus(error instanceof Error ? error.message : projectLifecycleCopy.runFailed);
        } finally {
            setIsProjectRetentionRunning(false);
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

    const handleImportUserSkill = async (file: File) => {
        if (!file.name.toLowerCase().endsWith('.zip')) {
            showError(userSkillsCopy.importFailed);
            return;
        }
        setIsSavingUserSkill(true);
        try {
            const saved = await importUserSkillPackage(file);
            setUserSkills((current) => uniqueUserSkills([
                saved,
                ...current.filter((skill) => skill.id !== saved.id),
            ]));
            showSuccess(userSkillsCopy.imported(file.name));
        } catch (error) {
            showError(error instanceof Error ? error.message : userSkillsCopy.importFailed);
        } finally {
            setIsSavingUserSkill(false);
        }
    };

    const handleImportUserSkillInputChange = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) void handleImportUserSkill(file);
    };

    const handleToggleUserSkill = async (skill: UserSkill) => {
        setIsSavingUserSkill(true);
        try {
            const saved = await updateUserSkillEnabled(skill.id, !skill.enabled);
            setUserSkills((current) => uniqueUserSkills(current.map((item) => item.id === saved.id ? saved : item)));
        } catch (error) {
            showError(error instanceof Error ? error.message : userSkillsCopy.saveFailed);
        } finally {
            setIsSavingUserSkill(false);
        }
    };

    const handleDeleteUserSkill = async (skill: UserSkill) => {
        setIsSavingUserSkill(true);
        try {
            await deleteUserSkill(skill.id);
            setUserSkills((current) => current.filter((item) => item.id !== skill.id));
            showSuccess(userSkillsCopy.deleted);
        } catch (error) {
            showError(error instanceof Error ? error.message : userSkillsCopy.deleteFailed);
        } finally {
            setIsSavingUserSkill(false);
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
        ...(effectiveCanManageSkills ? [{ id: 'skills' as const, label: userSkillsCopy.tab, icon: BookOpenText }] : []),
        ...(hasPlatformSettings ? [{ id: 'platform' as const, label: adminCopy.platform, icon: ShieldCheck }] : []),
    ], [
        adminCopy.platform,
        effectiveCanManageSkills,
        hasPlatformSettings,
        text.settingsGeneral,
        userSkillsCopy.tab,
    ]);
    const platformTabs = useMemo(() => {
        return [
            { id: 'general' as const, label: adminCopy.deployment, icon: ShieldCheck },
            ...(effectiveCanManageInvitations ? [{ id: 'invitations' as const, label: adminCopy.invitation.tab, icon: Ticket }] : []),
            ...(effectiveCanManageRuntimeSettings ? [{ id: 'runtime' as const, label: capabilityCopy.title, icon: Cpu }] : []),
            ...(effectiveCanManageMcp ? [{ id: 'mcp' as const, label: mcpCopy.title, icon: Network }] : []),
            ...(effectiveCanManageModelConfig ? [{ id: 'model' as const, label: text.settingsModel, icon: KeyRound }] : []),
            ...(effectiveCanReadAudit ? [{ id: 'projects' as const, label: projectLifecycleCopy.tab, icon: FolderOpen }] : []),
            ...(effectiveCanReadAudit ? [{ id: 'credit' as const, label: billingCopy.tab, icon: ReceiptText }] : []),
        ];
    }, [
        effectiveCanManageWorkspace,
        effectiveCanManageSecrets,
        effectiveCanManageMcp,
        effectiveCanManageModelConfig,
        effectiveCanManageInvitations,
        effectiveCanManageRuntimeSettings,
        effectiveCanReadAudit,
        adminCopy.deployment,
        billingCopy.tab,
        capabilityCopy.title,
        mcpCopy.title,
        projectLifecycleCopy.tab,
        text.settingsModel,
    ]);
    const activeTabLabel = activeSection === 'personal'
        ? text.settingsGeneral
        : activeSection === 'skills'
        ? userSkillsCopy.title
        : activeTab === 'general'
        ? adminCopy.deployment
        : activeTab === 'runtime'
            ? capabilityCopy.title
        : activeTab === 'mcp'
                ? mcpCopy.title
            : activeTab === 'skills'
                ? userSkillsCopy.title
            : activeTab === 'invitations'
                    ? adminCopy.invitation.tab
                    : activeTab === 'projects'
                        ? projectLifecycleCopy.title
                    : activeTab === 'credit'
                        ? billingCopy.title
                    : text.settingsModel;
    const isSavingCurrentTab = activeSection === 'platform' && activeTab === 'general'
        ? (effectiveCanManageSecrets && isSavingWebTools)
        : activeTab === 'runtime'
            ? isSavingRuntimeSettings
        : activeTab === 'mcp'
                ? false
            : activeTab === 'skills'
                ? false
            : activeTab === 'invitations'
                    ? isSavingInvitations
                    : activeTab === 'projects'
                        ? false
                    : activeTab === 'credit'
                        ? false
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
            : activeTab === 'skills'
                ? true
            : activeTab === 'invitations'
                    ? isSavingCurrentTab
                    : activeTab === 'projects'
                        ? true
                    : activeTab === 'credit'
                        ? true
                    : isSavingCurrentTab || !balancedModel.trim() || (!selectedModelConfigId && !apiKey.trim());

    const handleSaveSettings = async () => {
        if (activeSection !== 'platform') return;
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
        if (activeTab === 'skills') return;
        if (activeTab === 'projects') return;
        if (activeTab === 'credit') return;
        const webToolsSaved = effectiveCanManageSecrets ? await handleSaveWebTools() : true;
        if (webToolsSaved) onClose();
    };

    const updateRuntimeSetting = (key: keyof RuntimeSettingsConfig) => {
        setRuntimeSettings((current) => ({
            ...current,
            [key]: !current[key],
        }));
    };

    const handleSaveBillingPack = async () => {
        const priceId = billingPackForm.priceId.trim();
        const credits = Number(billingPackForm.credits);
        if (!priceId || !Number.isFinite(credits) || credits <= 0) {
            setCreditAuditStatus(billingCopy.positiveCreditsRequired);
            return;
        }
        setIsSavingBillingPack(true);
        try {
            const result = await upsertBillingCreditPack({
                priceId,
                credits,
                displayName: billingPackForm.displayName.trim() || undefined,
                enabled: billingPackForm.enabled,
                sortOrder: Number(billingPackForm.sortOrder) || 0,
            });
            setBillingCreditPacks((current) => [
                ...current.filter((pack) => pack.priceId !== result.pack.priceId),
                result.pack,
            ].sort((left, right) => left.sortOrder - right.sortOrder || left.credits - right.credits));
            setBillingPackForm(createEmptyBillingPackForm());
            setCreditAuditStatus(billingCopy.packSaved);
        } catch (error) {
            setCreditAuditStatus(error instanceof Error ? error.message : billingCopy.packSaveFailed);
        } finally {
            setIsSavingBillingPack(false);
        }
    };
    useEffect(() => {
        if (!hasPlatformSettings && activeSection === 'platform') {
            setActiveSection('personal');
            setActiveTab('general');
            return;
        }
        if (!effectiveCanManageSkills && activeSection === 'skills') {
            setActiveSection('personal');
            setActiveTab('general');
            return;
        }
        if (activeSection === 'platform' && !platformTabs.some((tab) => tab.id === activeTab)) {
            setActiveTab(platformTabs[0]?.id ?? 'general');
        }
    }, [activeSection, activeTab, effectiveCanManageSkills, hasPlatformSettings, platformTabs]);

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
                                                {activeSection === 'platform'
                                                    ? adminCopy.platform
                                                    : activeSection === 'skills'
                                                        ? userSkillsCopy.tab
                                                        : t.systemSettings}
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
                                        {activeSection === 'skills' && effectiveCanManageSkills ? (
                                            <div>
                                                <input
                                                    ref={userSkillImportInputRef}
                                                    aria-label={userSkillsCopy.importFileLabel}
                                                    type="file"
                                                    accept=".zip,application/zip,application/x-zip-compressed"
                                                    className="sr-only"
                                                    onChange={handleImportUserSkillInputChange}
                                                />
                                                <button
                                                    type="button"
                                                    aria-label={userSkillsCopy.importSkill}
                                                    title={userSkillsCopy.importFileLabel}
                                                    onClick={() => userSkillImportInputRef.current?.click()}
                                                    disabled={isSavingUserSkill}
                                                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/5 text-zinc-100 shadow-sm shadow-black/20 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    <FaPlus className="h-4 w-4" />
                                                </button>
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
	                                                <div className="type-code-sm max-w-full whitespace-normal break-all rounded-2xl border border-white/15 bg-white/[0.04] px-3 py-3 text-zinc-100">
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
                                        copy={adminCopy.invitation}
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

                                {activeSection === 'platform' && activeTab === 'projects' && effectiveCanReadAudit ? (
                                    <ProjectLifecyclePanel
                                        overview={projectLifecycleOverview}
                                        status={projectLifecycleStatus}
                                        retentionResult={projectRetentionResult}
                                        copy={projectLifecycleCopy}
                                        isRetentionRunning={isProjectRetentionRunning}
                                        onPlanRetention={() => void handlePlanProjectRetention()}
                                        onRunRetention={() => void handleRunProjectRetention()}
                                    />
                                ) : null}

                                {activeSection === 'platform' && activeTab === 'credit' && effectiveCanReadAudit ? (
                                    <CreditAuditPanel
                                        ledger={creditAuditLedger}
                                        status={creditAuditStatus}
                                        billingCreditPacks={billingCreditPacks}
                                        billingEvents={billingEvents}
                                        packForm={billingPackForm}
                                        copy={billingCopy}
                                        isSavingPack={isSavingBillingPack}
                                        onPackFormChange={setBillingPackForm}
                                        onSavePack={() => void handleSaveBillingPack()}
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
                                {activeSection === 'skills' && effectiveCanManageSkills ? (
                                    <UserSkillsSettingsPanel
                                        copy={userSkillsCopy}
                                        skills={userSkills}
                                        isSaving={isSavingUserSkill}
                                        onImport={(file) => void handleImportUserSkill(file)}
                                        onToggle={(skill) => void handleToggleUserSkill(skill)}
                                        onDelete={(skill) => void handleDeleteUserSkill(skill)}
                                    />
                                ) : null}
                                </div>
                                {activeSection === 'platform' && activeTab !== 'mcp' && activeTab !== 'projects' && activeTab !== 'credit' && (activeTab !== 'general' || hasGeneralSaveAction) ? (
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
        invitation: {
            tab: translate('admin.invitation.tab'),
            title: translate('admin.invitation.title'),
            description: translate('admin.invitation.description'),
            newCode: translate('admin.invitation.newCode'),
            codeAria: translate('admin.invitation.codeAria'),
            codePlaceholder: translate('admin.invitation.codePlaceholder'),
            labelAria: translate('admin.invitation.labelAria'),
            labelPlaceholder: translate('admin.invitation.labelPlaceholder'),
            maxUsesAria: translate('admin.invitation.maxUsesAria'),
            maxUsesPlaceholder: translate('admin.invitation.maxUsesPlaceholder'),
            create: translate('admin.invitation.create'),
            list: translate('admin.invitation.list'),
            unnamed: translate('admin.invitation.unnamed'),
            codeValue: (code: string) => translate('admin.invitation.codeValue', { code }),
            usedCount: (usedCount: number, maxUses?: number | null) => (
                maxUses
                    ? translate('admin.invitation.usedCountLimited', { usedCount, maxUses })
                    : translate('admin.invitation.usedCountUnlimited', { usedCount })
            ),
            enable: translate('admin.invitation.enable'),
            disable: translate('admin.invitation.disable'),
            deleteAria: translate('admin.invitation.deleteAria'),
            empty: translate('admin.invitation.empty'),
            unavailable: translate('admin.invitation.unavailable'),
            enabledStatus: translate('admin.invitation.enabledStatus'),
            disabledStatus: translate('admin.invitation.disabledStatus'),
            saveFailed: translate('admin.invitation.saveFailed'),
            codeRequired: translate('admin.invitation.codeRequired'),
            maxUsesInvalid: translate('admin.invitation.maxUsesInvalid'),
            createFailed: translate('admin.invitation.createFailed'),
            updateFailed: translate('admin.invitation.updateFailed'),
            deleteFailed: translate('admin.invitation.deleteFailed'),
        },
    };
}

function getBillingSettingsCopy(translate: SettingsTranslate): BillingSettingsCopy {
    return {
        tab: translate('billing.tab'),
        title: translate('billing.title'),
        description: translate('billing.description'),
        packsTitle: translate('billing.packsTitle'),
        packsDescription: translate('billing.packsDescription'),
        savePack: translate('billing.savePack'),
        saving: translate('billing.saving'),
        priceId: translate('billing.priceId'),
        credits: translate('billing.credits'),
        displayName: translate('billing.displayName'),
        sortOrder: translate('billing.sortOrder'),
        enabled: translate('billing.enabled'),
        disabled: translate('billing.disabled'),
        edit: translate('billing.edit'),
        noPacks: translate('billing.noPacks'),
        noEvents: translate('billing.noEvents'),
        noLedger: translate('billing.noLedger'),
        noReference: translate('billing.noReference'),
        positiveCreditsRequired: translate('billing.positiveCreditsRequired'),
        packSaved: translate('billing.packSaved'),
        packSaveFailed: translate('billing.packSaveFailed'),
        auditUnavailable: translate('billing.auditUnavailable'),
        billingUnavailable: translate('billing.billingUnavailable'),
        metrics: {
            outstandingReserved: translate('billing.metrics.outstandingReserved'),
            settled: translate('billing.metrics.settled'),
            refunded: translate('billing.metrics.refunded'),
            weightedTokens: translate('billing.metrics.weightedTokens'),
        },
    };
}

function getProjectLifecycleSettingsCopy(translate: SettingsTranslate): ProjectLifecycleSettingsCopy {
    return {
        tab: translate('projectLifecycle.tab'),
        title: translate('projectLifecycle.title'),
        description: translate('projectLifecycle.description'),
        quotaUsage: translate('projectLifecycle.quotaUsage'),
        quotaRemaining: translate('projectLifecycle.quotaRemaining'),
        storageCleanup: translate('projectLifecycle.storageCleanup'),
        projectsValue: (count: number) => translate('projectLifecycle.projectsValue', { count }),
        projectsLimitValue: (used: number, limit: number) => translate('projectLifecycle.projectsLimitValue', { used, limit }),
        unlimited: translate('projectLifecycle.unlimited'),
        remainingValue: (count: number) => translate('projectLifecycle.remainingValue', { count }),
        supabaseEnabled: translate('projectLifecycle.supabaseEnabled'),
        localOnly: translate('projectLifecycle.localOnly'),
        retentionTitle: translate('projectLifecycle.retentionTitle'),
        retentionDescription: translate('projectLifecycle.retentionDescription'),
        dryRun: translate('projectLifecycle.dryRun'),
        runRetention: translate('projectLifecycle.runRetention'),
        retentionSummary: (planned: number, deleted: number, retained: number) => (
            translate('projectLifecycle.retentionSummary', { planned, deleted, retained })
        ),
        lastRetentionRun: translate('projectLifecycle.lastRetentionRun'),
        dryRunLabel: translate('projectLifecycle.dryRunLabel'),
        deletedRunLabel: (count: number) => translate('projectLifecycle.deletedRunLabel', { count }),
        activeProjects: translate('projectLifecycle.activeProjects'),
        recentCleanup: translate('projectLifecycle.recentCleanup'),
        noActiveProjects: translate('projectLifecycle.noActiveProjects'),
        noRecentCleanup: translate('projectLifecycle.noRecentCleanup'),
        noWorkspacePath: translate('projectLifecycle.noWorkspacePath'),
        snapshotSaved: translate('projectLifecycle.snapshotSaved'),
        noSnapshot: translate('projectLifecycle.noSnapshot'),
        dryRunStatus: (count: number) => translate('projectLifecycle.dryRunStatus', { count }),
        runStatus: (count: number) => translate('projectLifecycle.runStatus', { count }),
        dryRunFailed: translate('projectLifecycle.dryRunFailed'),
        runFailed: translate('projectLifecycle.runFailed'),
        unavailable: translate('projectLifecycle.unavailable'),
    };
}

function getUserSkillsSettingsCopy(translate: SettingsTranslate): UserSkillsSettingsCopy {
    return {
        tab: translate('userSkills.tab'),
        title: translate('userSkills.title'),
        description: translate('userSkills.description'),
        importSkill: translate('userSkills.importSkill'),
        importFileLabel: translate('userSkills.importFileLabel'),
        importFailed: translate('userSkills.importFailed'),
        imported: (name: string) => translate('userSkills.imported', { name }),
        enabled: translate('userSkills.enabled'),
        disabled: translate('userSkills.disabled'),
        delete: translate('userSkills.delete'),
        empty: translate('userSkills.empty'),
        emptyDescription: translate('userSkills.emptyDescription'),
        saveFailed: translate('userSkills.saveFailed'),
        deleteFailed: translate('userSkills.deleteFailed'),
        deleted: translate('userSkills.deleted'),
        unavailable: translate('userSkills.unavailable'),
        runtimeNote: translate('userSkills.runtimeNote'),
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

function createEmptyBillingPackForm(): BillingPackFormState {
    return {
        priceId: '',
        credits: '',
        displayName: '',
        sortOrder: '0',
        enabled: true,
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

type BillingSettingsCopy = {
    tab: string;
    title: string;
    description: string;
    packsTitle: string;
    packsDescription: string;
    savePack: string;
    saving: string;
    priceId: string;
    credits: string;
    displayName: string;
    sortOrder: string;
    enabled: string;
    disabled: string;
    edit: string;
    noPacks: string;
    noEvents: string;
    noLedger: string;
    noReference: string;
    positiveCreditsRequired: string;
    packSaved: string;
    packSaveFailed: string;
    auditUnavailable: string;
    billingUnavailable: string;
    metrics: {
        outstandingReserved: string;
        settled: string;
        refunded: string;
        weightedTokens: string;
    };
};

type ProjectLifecycleSettingsCopy = {
    tab: string;
    title: string;
    description: string;
    quotaUsage: string;
    quotaRemaining: string;
    storageCleanup: string;
    projectsValue: (count: number) => string;
    projectsLimitValue: (used: number, limit: number) => string;
    unlimited: string;
    remainingValue: (count: number) => string;
    supabaseEnabled: string;
    localOnly: string;
    retentionTitle: string;
    retentionDescription: string;
    dryRun: string;
    runRetention: string;
    retentionSummary: (planned: number, deleted: number, retained: number) => string;
    lastRetentionRun: string;
    dryRunLabel: string;
    deletedRunLabel: (count: number) => string;
    activeProjects: string;
    recentCleanup: string;
    noActiveProjects: string;
    noRecentCleanup: string;
    noWorkspacePath: string;
    snapshotSaved: string;
    noSnapshot: string;
    dryRunStatus: (count: number) => string;
    runStatus: (count: number) => string;
    dryRunFailed: string;
    runFailed: string;
    unavailable: string;
};

type UserSkillsSettingsCopy = {
    tab: string;
    title: string;
    description: string;
    importSkill: string;
    importFileLabel: string;
    importFailed: string;
    imported: (name: string) => string;
    enabled: string;
    disabled: string;
    delete: string;
    empty: string;
    emptyDescription: string;
    saveFailed: string;
    deleteFailed: string;
    deleted: string;
    unavailable: string;
    runtimeNote: string;
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

function InvitationSettingsPanel({
    copy,
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
    copy: ReturnType<typeof getAdminSettingsCopy>['invitation'];
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
                            {copy.title}
                        </div>
                        <div className="type-footnote mt-1 text-zinc-500">
                            {copy.description}
                        </div>
                    </div>
                    <Switch checked={required} aria-label={copy.title} onCheckedChange={onToggleRequired} />
                </div>

                <div className="grid gap-3 py-3 sm:grid-cols-[10.5rem_1fr]">
                    <span className="type-subheadline text-zinc-100 sm:mt-2.5">{copy.newCode}</span>
                    <div className="grid gap-2">
                        <input
                            aria-label={copy.codeAria}
                            value={newCode}
                            onChange={(event) => onNewCodeChange(event.target.value)}
                            placeholder={copy.codePlaceholder}
                            className="type-input h-11 w-full rounded-2xl border border-white/15 bg-white/[0.04] px-3 text-zinc-100 outline-none transition-colors focus:border-white/35 focus:bg-white/[0.06]"
                        />
                        <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
                            <input
                                aria-label={copy.labelAria}
                                value={newLabel}
                                onChange={(event) => onNewLabelChange(event.target.value)}
                                placeholder={copy.labelPlaceholder}
                                className="type-input h-11 w-full rounded-2xl border border-white/15 bg-white/[0.04] px-3 text-zinc-100 outline-none transition-colors focus:border-white/35 focus:bg-white/[0.06]"
                            />
                            <input
                                aria-label={copy.maxUsesAria}
                                inputMode="numeric"
                                value={newMaxUses}
                                onChange={(event) => onNewMaxUsesChange(event.target.value)}
                                placeholder={copy.maxUsesPlaceholder}
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
                                {copy.create}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-2">
                <div className="type-caption-1 text-zinc-500">{copy.list}</div>
                {invitations.length ? (
                    <div className="divide-y divide-white/10 overflow-hidden rounded-3xl border border-white/10">
                        {invitations.map((invitation) => {
                            const invitationCode = String(invitation.code || '').trim();
                            const primaryLabel = invitation.label || invitationCode || copy.unnamed;
                            return (
                                <div key={invitation.id} className="flex items-center justify-between gap-3 px-4 py-3">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className={`h-2 w-2 shrink-0 rounded-full ${invitation.enabled ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                                            <span className="type-footnote truncate text-zinc-100">
                                                {primaryLabel}
                                            </span>
                                        </div>
                                        {invitationCode ? (
                                            <div className="type-footnote mt-1 truncate pl-4 font-mono text-zinc-300">{copy.codeValue(invitationCode)}</div>
                                        ) : null}
                                        <div className="type-footnote mt-1 truncate pl-4 text-zinc-500">
                                            {copy.usedCount(invitation.usedCount, invitation.maxUses)}
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => onToggleInvitation(invitation)}
                                            disabled={isSaving}
                                            className="type-button h-9 rounded-full border border-white/15 px-3 text-zinc-100 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {invitation.enabled ? copy.disable : copy.enable}
                                        </button>
                                        <button
                                            type="button"
                                            aria-label={copy.deleteAria}
                                            onClick={() => onDeleteInvitation(invitation.id)}
                                            disabled={isSaving || invitation.usedCount > 0}
                                            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-zinc-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="type-footnote rounded-3xl border border-white/10 px-4 py-4 text-zinc-500">
                        {copy.empty}
                    </div>
                )}
                {status ? (
                    <div className="type-footnote text-amber-300">{status}</div>
                ) : null}
            </div>
        </div>
    );
}

function UserSkillsSettingsPanel({
    copy,
    skills,
    isSaving,
    onImport,
    onToggle,
    onDelete,
}: {
    copy: UserSkillsSettingsCopy;
    skills: UserSkill[];
    isSaving: boolean;
    onImport: (file: File) => void;
    onToggle: (skill: UserSkill) => void;
    onDelete: (skill: UserSkill) => void;
}) {
    const [isDragActive, setIsDragActive] = useState(false);
    const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setIsDragActive(true);
    };
    const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
            return;
        }
        setIsDragActive(false);
    };
    const handleDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragActive(false);
        const file = event.dataTransfer.files.item?.(0) ?? event.dataTransfer.files[0];
        if (file) onImport(file);
    };
    return (
        <div className="space-y-4 py-2">
            <section
                data-testid="user-skills-drop-zone"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`rounded-3xl transition-colors ${isDragActive ? 'bg-white/[0.045] ring-2 ring-white/25' : ''}`}
            >
                {skills.length ? (
                    <div className="max-h-[240px] overflow-y-auto rounded-3xl border border-white/10 [scrollbar-gutter:stable]">
                        <div className="divide-y divide-white/10">
                            {skills.map((skill) => (
                                <div key={skill.id} className="flex items-center justify-between gap-3 px-4 py-3">
                                    <div className="min-w-0 flex-1 px-2 py-1">
                                        <div className="flex items-center gap-2">
                                            <span className={`h-2 w-2 shrink-0 rounded-full ${skill.enabled ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                                            <span className="type-footnote truncate text-zinc-100">{skill.name}</span>
                                            <span className="type-caption-1 text-zinc-500">
                                                {skill.enabled ? copy.enabled : copy.disabled}
                                            </span>
                                        </div>
                                        <div className="type-footnote mt-1 truncate pl-4 text-zinc-500">
                                            {skill.description}
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        <Switch
                                            checked={skill.enabled}
                                            aria-label={skill.enabled ? copy.disabled : copy.enabled}
                                            disabled={isSaving}
                                            onCheckedChange={() => onToggle(skill)}
                                        />
                                        <button
                                            type="button"
                                            aria-label={copy.delete}
                                            title={copy.delete}
                                            onClick={() => onDelete(skill)}
                                            disabled={isSaving}
                                            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/15 text-zinc-300 transition-colors hover:bg-red-500/10 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="flex min-h-[190px] flex-col items-center justify-center rounded-3xl border border-dashed border-white/20 bg-white/[0.025] px-6 py-8 text-center">
                        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/20 text-zinc-400">
                            <BookOpenText className="h-5 w-5" />
                        </div>
                        <div className="type-callout text-zinc-100">{copy.empty}</div>
                        <p className="type-footnote mt-3 max-w-md text-zinc-500">{copy.emptyDescription}</p>
                    </div>
                )}
            </section>
        </div>
    );
}

function uniqueUserSkills(skills: UserSkill[]): UserSkill[] {
    const seen = new Set<string>();
    const unique: UserSkill[] = [];
    for (const skill of skills) {
        const key = skill.slug || skill.name;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(skill);
    }
    return unique.sort((left, right) => left.name.localeCompare(right.name));
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
                                <Switch checked={form.enabled} aria-label={copy.form.enabled} onCheckedChange={() => update({ enabled: !form.enabled })} />
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

function ProjectLifecyclePanel({
    overview,
    status,
    retentionResult,
    copy,
    isRetentionRunning,
    onPlanRetention,
    onRunRetention,
}: {
    overview: BeeGameProjectLifecycleOverview | null;
    status: string;
    retentionResult: BeeGameProjectRetentionResult | null;
    copy: ProjectLifecycleSettingsCopy;
    isRetentionRunning: boolean;
    onPlanRetention: () => void;
    onRunRetention: () => void;
}) {
    const quota = overview?.quota;
    const projectLimit = quota?.limit ?? null;
    const quotaValue = projectLimit === null
        ? copy.projectsValue(quota?.used ?? 0)
        : copy.projectsLimitValue(quota?.used ?? 0, projectLimit);
    const remainingValue = projectLimit === null
        ? copy.unlimited
        : copy.remainingValue(quota?.remaining ?? 0);
    const projects = overview?.projects ?? [];
    const deletions = overview?.recentDeletions ?? [];
    const retentionRuns = overview?.recentRetentionRuns ?? [];
    return (
        <div className="space-y-4 py-3">
            <div>
                <h3 className="type-subheadline text-zinc-100">{copy.title}</h3>
                <p className="type-footnote mt-1 text-zinc-500">
                    {copy.description}
                </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
                <CreditMetric label={copy.quotaUsage} value={quotaValue} />
                <CreditMetric label={copy.quotaRemaining} value={remainingValue} />
                <CreditMetric
                    label={copy.storageCleanup}
                    value={overview?.storage.supabaseStorageConfigured ? copy.supabaseEnabled : copy.localOnly}
                />
            </div>
            {status ? (
                <div className="type-footnote rounded-2xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-amber-200">
                    {status}
                </div>
            ) : null}
            <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                        <div className="type-caption-1 text-zinc-500">{copy.retentionTitle}</div>
                        <div className="type-footnote text-zinc-300">{copy.retentionDescription}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            disabled={isRetentionRunning}
                            onClick={onPlanRetention}
                            className="glass-control type-button h-9 rounded-full px-3 text-zinc-100 disabled:opacity-60"
                        >
                            {copy.dryRun}
                        </button>
                        <button
                            type="button"
                            disabled={isRetentionRunning}
                            onClick={onRunRetention}
                            className="glass-control type-button h-9 rounded-full px-3 text-zinc-100 disabled:opacity-60"
                        >
                            {copy.runRetention}
                        </button>
                    </div>
                </div>
                {retentionResult ? (
                    <div className="type-caption-1 text-zinc-500">
                        {copy.retentionSummary(
                            retentionResult.summary.deploymentRecordsPlannedForDeletion,
                            retentionResult.summary.deploymentRecordsDeleted,
                            retentionResult.summary.deploymentRecordsRetained,
                        )}
                    </div>
                ) : null}
                {retentionRuns.length ? (
                    <div className="space-y-1">
                        <div className="type-caption-1 text-zinc-500">{copy.lastRetentionRun}</div>
                        <div className="max-h-24 space-y-1 overflow-y-auto pr-1">
                            {retentionRuns.map((run) => (
                                <div key={`${run.ranAt}-${run.deploymentRecordsDeleted}`} className="type-footnote text-zinc-300">
                                    {run.dryRun ? copy.dryRunLabel : copy.deletedRunLabel(run.deploymentRecordsDeleted)}
                                </div>
                            ))}
                        </div>
                    </div>
                ) : null}
            </div>
            <div className="space-y-2">
                <div className="type-caption-1 text-zinc-500">{copy.activeProjects}</div>
                <div className="overflow-hidden rounded-2xl border border-white/10">
                    {projects.length ? (
                        <div className="max-h-80 divide-y divide-white/10 overflow-y-auto">
                            {projects.map((project) => (
                                <ProjectLifecycleRow key={project.id} project={project} copy={copy} />
                            ))}
                        </div>
                    ) : (
                        <div className="type-footnote px-3 py-4 text-zinc-500">{copy.noActiveProjects}</div>
                    )}
                </div>
            </div>
            <div className="space-y-2">
                <div className="type-caption-1 text-zinc-500">{copy.recentCleanup}</div>
                <div className="overflow-hidden rounded-2xl border border-white/10">
                    {deletions.length ? (
                        <div className="max-h-64 divide-y divide-white/10 overflow-y-auto">
                            {deletions.map((deletion) => (
                                <ProjectLifecycleDeletionRow
                                    key={`${deletion.projectId}-${deletion.deletedAt}`}
                                    deletion={deletion}
                                    copy={copy}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="type-footnote px-3 py-4 text-zinc-500">{copy.noRecentCleanup}</div>
                    )}
                </div>
            </div>
        </div>
    );
}

function ProjectLifecycleRow({
    project,
    copy,
}: {
    project: BeeGameProjectLifecycleProject;
    copy: ProjectLifecycleSettingsCopy;
}) {
    return (
        <div className="grid gap-2 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
                <div className="type-footnote break-all text-zinc-100">{project.name}</div>
                <div className="type-caption-1 break-all text-zinc-500">{project.rootPath || copy.noWorkspacePath}</div>
            </div>
            <div className="type-caption-1 max-w-full break-all text-zinc-500 sm:max-w-48 sm:text-right">
                {project.lifecycle.phaseName || (project.lifecycle.hasRuntimeSnapshot ? copy.snapshotSaved : copy.noSnapshot)}
            </div>
        </div>
    );
}

function ProjectLifecycleDeletionRow({
    deletion,
    copy,
}: {
    deletion: BeeGameProjectLifecycleDeletion;
    copy: ProjectLifecycleSettingsCopy;
}) {
    return (
        <div className="grid gap-2 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
                <div className="type-footnote break-all text-zinc-100">{deletion.projectId}</div>
                <div className="type-caption-1 break-all text-zinc-500">
                    {deletion.deletedWorkspacePath || copy.noWorkspacePath}
                </div>
            </div>
            <div className="type-caption-1 max-w-full break-all text-zinc-500 sm:max-w-48 sm:text-right">
                {deletion.cleanupOutcome}
            </div>
        </div>
    );
}

function CreditAuditPanel({
    ledger,
    status,
    billingCreditPacks,
    billingEvents,
    packForm,
    copy,
    isSavingPack,
    onPackFormChange,
    onSavePack,
}: {
    ledger: BeeGameCreditAuditLedger | null;
    status: string;
    billingCreditPacks: BeeGameBillingCreditPack[];
    billingEvents: BeeGameBillingEvent[];
    packForm: BillingPackFormState;
    copy: BillingSettingsCopy;
    isSavingPack: boolean;
    onPackFormChange: (form: BillingPackFormState) => void;
    onSavePack: () => void;
}) {
    const summary = ledger?.summary;
    const entries = ledger?.entries.slice(0, 8) ?? [];
    const recentBillingEvents = billingEvents.slice(0, 8);
    return (
        <div className="space-y-4 py-3">
            <div>
                <h3 className="type-subheadline text-zinc-100">{copy.title}</h3>
                <p className="type-footnote mt-1 text-zinc-500">
                    {copy.description}
                </p>
            </div>
            <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.025] p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h4 className="type-footnote text-zinc-100">{copy.packsTitle}</h4>
                        <p className="type-caption-1 mt-1 text-zinc-500">{copy.packsDescription}</p>
                    </div>
                    <button
                        type="button"
                        className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-200 hover:border-amber-300/40 hover:text-amber-100 disabled:opacity-50"
                        disabled={isSavingPack}
                        onClick={onSavePack}
                    >
                        {isSavingPack ? copy.saving : copy.savePack}
                    </button>
                </div>
                <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(7rem,.7fr)_minmax(0,1fr)]">
                    <input
                        className="min-w-0 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-300/50"
                        placeholder={copy.priceId}
                        value={packForm.priceId}
                        onChange={(event) => onPackFormChange({ ...packForm, priceId: event.target.value })}
                    />
                    <input
                        className="min-w-0 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-300/50"
                        placeholder={copy.credits}
                        inputMode="numeric"
                        value={packForm.credits}
                        onChange={(event) => onPackFormChange({ ...packForm, credits: event.target.value })}
                    />
                    <input
                        className="min-w-0 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-300/50 sm:col-span-2 xl:col-span-1"
                        placeholder={copy.displayName}
                        value={packForm.displayName}
                        onChange={(event) => onPackFormChange({ ...packForm, displayName: event.target.value })}
                    />
                </div>
                <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(7rem,10rem)_auto] sm:items-center">
                    <input
                        className="min-w-0 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-300/50"
                        placeholder={copy.sortOrder}
                        inputMode="numeric"
                        value={packForm.sortOrder}
                        onChange={(event) => onPackFormChange({ ...packForm, sortOrder: event.target.value })}
                    />
                    <label className="flex min-w-0 items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-zinc-300">
                        <input
                            type="checkbox"
                            checked={packForm.enabled}
                            onChange={(event) => onPackFormChange({ ...packForm, enabled: event.target.checked })}
                        />
                        {copy.enabled}
                    </label>
                </div>
                <div className="overflow-hidden rounded-2xl border border-white/10">
                    {billingCreditPacks.length ? (
                        <div className="max-h-64 divide-y divide-white/10 overflow-y-auto">
                            {billingCreditPacks.map((pack) => (
                                <BillingCreditPackRow
                                    key={pack.priceId}
                                    pack={pack}
                                    copy={copy}
                                    onEdit={() => onPackFormChange({
                                        priceId: pack.priceId,
                                        credits: String(pack.credits),
                                        displayName: pack.displayName ?? '',
                                        sortOrder: String(pack.sortOrder),
                                        enabled: pack.enabled,
                                    })}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="type-footnote px-3 py-4 text-zinc-500">{copy.noPacks}</div>
                    )}
                </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
                <CreditMetric label={copy.metrics.outstandingReserved} value={`${summary?.outstandingReservedCredits ?? 0} credits`} />
                <CreditMetric label={copy.metrics.settled} value={`${summary?.settledCredits ?? 0} credits`} />
                <CreditMetric label={copy.metrics.refunded} value={`${summary?.refundedCredits ?? 0} credits`} />
                <CreditMetric label={copy.metrics.weightedTokens} value={String(summary?.weightedTokens ?? 0)} />
            </div>
            {status ? (
                <div className="type-footnote rounded-2xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-amber-200">
                    {status}
                </div>
            ) : null}
            <div className="overflow-hidden rounded-2xl border border-white/10">
                {entries.length ? (
                    <div className="max-h-64 divide-y divide-white/10 overflow-y-auto">
                        {entries.map((entry) => (
                            <CreditAuditEntryRow key={entry.id} entry={entry} copy={copy} />
                        ))}
                    </div>
                ) : (
                    <div className="type-footnote px-3 py-4 text-zinc-500">
                        {copy.noLedger}
                    </div>
                )}
            </div>
            <div className="overflow-hidden rounded-2xl border border-white/10">
                {recentBillingEvents.length ? (
                    <div className="max-h-64 divide-y divide-white/10 overflow-y-auto">
                        {recentBillingEvents.map((event, index) => (
                            <BillingEventRow key={event.id ?? `${event.eventType}-${index}`} event={event} copy={copy} />
                        ))}
                    </div>
                ) : (
                    <div className="type-footnote px-3 py-4 text-zinc-500">
                        {copy.noEvents}
                    </div>
                )}
            </div>
        </div>
    );
}

function BillingCreditPackRow({
    pack,
    copy,
    onEdit,
}: {
    pack: BeeGameBillingCreditPack;
    copy: BillingSettingsCopy;
    onEdit: () => void;
}) {
    return (
        <div className="grid min-w-0 gap-2 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
            <div className="min-w-0">
                <div className="type-footnote truncate text-zinc-100">{pack.displayName || `${pack.credits} credits`}</div>
                <div className="type-caption-1 break-all text-zinc-500">{pack.priceId}</div>
            </div>
            <div className="type-caption-1 text-zinc-400">{pack.enabled ? copy.enabled : copy.disabled}</div>
            <button
                type="button"
                className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-200 hover:border-amber-300/40 hover:text-amber-100"
                onClick={onEdit}
            >
                {copy.edit}
            </button>
        </div>
    );
}

function BillingEventRow({
    event,
    copy,
}: {
    event: BeeGameBillingEvent;
    copy: BillingSettingsCopy;
}) {
    return (
        <div className="grid min-w-0 gap-2 px-3 py-3 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-center">
            <div>
                <div className="type-footnote text-zinc-100">{event.status}</div>
                <div className="type-caption-1 text-zinc-500">{event.credits ?? 0} credits</div>
            </div>
            <div className="min-w-0">
                <div className="type-footnote truncate text-zinc-300">{event.eventType}</div>
                <div className="type-caption-1 break-all text-zinc-500">
                    {event.priceId || event.providerEventId || event.errorMessage || copy.noReference}
                </div>
            </div>
            <div className="type-caption-1 text-zinc-500">{event.createdAt ? formatCreditAuditTime(event.createdAt) : ''}</div>
        </div>
    );
}

function CreditMetric({
    label,
    value,
}: {
    label: string;
    value: string;
}) {
    return (
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2">
            <div className="type-caption-1 text-zinc-500">{label}</div>
            <div className="type-subheadline mt-1 text-zinc-100">{value}</div>
        </div>
    );
}

function CreditAuditEntryRow({
    entry,
    copy,
}: {
    entry: BeeGameCreditLedgerEntry;
    copy: BillingSettingsCopy;
}) {
    return (
        <div className="grid min-w-0 gap-2 px-3 py-3 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-center">
            <div>
                <div className="type-footnote text-zinc-100">{entry.kind}</div>
                <div className="type-caption-1 text-zinc-500">{entry.credits} credits</div>
            </div>
            <div className="min-w-0">
                <div className="type-footnote break-all text-zinc-300">{entry.userId}</div>
                <div className="type-caption-1 break-all text-zinc-500">
                    {entry.projectId || entry.reservationId || copy.noReference}
                </div>
            </div>
            <div className="type-caption-1 text-zinc-500">
                {formatCreditAuditTime(entry.createdAt)}
            </div>
        </div>
    );
}

function formatCreditAuditTime(value: string): string {
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return value;
    return new Date(time).toLocaleString();
}
