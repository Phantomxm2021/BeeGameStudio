import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  BookOpenText,
  Cpu,
  FolderOpen,
  Globe,
  KeyRound,
  Network,
  Plus,
  Plus as FaPlus,
  ReceiptText,
  ShieldCheck,
  Ticket,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LANGUAGE_OPTIONS, type Language } from '../AgentsConfig';
import { Switch } from '../../ui/switch';
import { normalizeI18nLanguage, useBeeGameText, useCommonText } from '../../../i18n/useBeeGameTranslations';
import { getBeeGameWorkspaceSettings } from '../../../services/beeGameAdapter';
import {
  createModelConfig,
  listModelConfigs,
  updateModelConfig,
  type ModelConfig,
  type ModelProviderKind,
} from '../../../services/modelConfigApi';
import { getWebToolsConfig, saveWebToolsConfig, type WebSearchAdapter } from '../../../services/webToolsApi';
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
  getCreditSummary,
  upsertBillingCreditPack,
  type BeeGameBillingCreditPack,
  type BeeGameBillingEvent,
  type BeeGameUsageSummary,
} from '../../../services/creditsApi';
import {
  getProjectLifecycleOverview,
  planProjectRetention,
  runProjectRetention,
  type BeeGameProjectLifecycleOverview,
  type BeeGameProjectRetentionResult,
} from '../../../services/projectLifecycleApi';
import { useSystemStore } from '../../../store/systemStore';
import { useToastContext } from '../../../contexts/ToastContext';
import { InvitationSettingsPanel } from '../../Settings/InvitationSettingsPanel';
import { UserSkillsSettingsPanel } from '../../Settings/UserSkillsSettingsPanel';
import { ModelConfigPanel } from '../../Settings/ModelConfigPanel';
import { WebToolsPanel } from '../../Settings/WebToolsPanel';
import { Dialog, DialogContent } from '../../ui/dialog';
import { UsageBillingPanel, type BillingPackFormState, type BillingSettingsCopy } from '../../Settings/BillingSettingsPanel';
import { ProjectLifecyclePanel, type ProjectLifecycleSettingsCopy } from '../../Settings/ProjectLifecycleSettingsPanel';
import { RuntimeSettingsPanel, type RuntimeCapabilityCopy } from '../../Settings/RuntimeSettingsPanel';
import {
  McpServerFormPopover,
  McpSettingsPanel,
  type McpSettingsCopy,
} from '../../Settings/McpSettingsPanel';
import {
  isMcpFormSaveable,
  toPopoverAnchorRect,
  type McpServerForm,
  type PopoverAnchorRect,
} from '../../Settings/McpSettingsPanel.types';
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
  canManageLifecycle?: boolean;
  canManageCredits?: boolean;
}

type SettingsSection = 'personal' | 'skills' | 'platform';
type SettingsTab = 'general' | 'runtime' | 'mcp' | 'skills' | 'model' | 'invitations' | 'projects' | 'credit';
type McpFormAnchor =
  | { kind: 'new'; rect: PopoverAnchorRect }
  | { kind: 'edit'; serverId: string; rect: PopoverAnchorRect }
  | null;


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
  canManageLifecycle,
  canManageCredits,
}: SettingsMenuProps) {
  const { i18n } = useTranslation('settings');
  const fixedSettingsTranslation = i18n.getFixedT(normalizeI18nLanguage(lang), 'settings');
  const translateSettings = (key: string, options?: Record<string, unknown>): string =>
    fixedSettingsTranslation(key, options);
  const settingsObject = <T,>(key: string): T => fixedSettingsTranslation(key, { returnObjects: true }) as T;
  const t = useCommonText(lang);
  const text = useBeeGameText(lang);
  const billingCopy = getBillingSettingsCopy(translateSettings);
  const projectLifecycleCopy = getProjectLifecycleSettingsCopy(translateSettings);
  const userSkillsCopy = getUserSkillsSettingsCopy(translateSettings);
  const { showError, showSuccess } = useToastContext();
  const currentUser = useSystemStore(state => state.currentUser);
  const isDark = useSystemStore(state => state.isDark);
  const toggleTheme = useSystemStore(state => state.toggleTheme);
  const hasPermission = useSystemStore(state => state.hasPermission);
  const canOpenPlatformSettings = currentUser?.role === 'owner';
  const effectiveCanManageWorkspace =
    canManageWorkspace ?? (canOpenPlatformSettings && hasPermission('workspace.manage'));
  const effectiveCanManageSecrets = canManageSecrets ?? (canOpenPlatformSettings && hasPermission('secrets.manage'));
  const effectiveCanManageRuntimeSettings =
    canManageRuntimeSettings ?? (canOpenPlatformSettings && hasPermission('runtime_settings.manage'));
  const effectiveCanManageMcp = canManageMcp ?? (canOpenPlatformSettings && hasPermission('mcp.manage'));
  const effectiveCanManageSkills = canManageSkills ?? Boolean(currentUser);
  const effectiveCanManageModelConfig =
    canManageModelConfig ?? (canOpenPlatformSettings && hasPermission('model_config.manage'));
  const effectiveCanManageInvitations = canManageInvitations ?? canOpenPlatformSettings;
  const effectiveCanReadAudit = canReadAudit ?? (canOpenPlatformSettings && hasPermission('audit.read'));
  const effectiveCanManageLifecycle =
    canManageLifecycle ?? (canOpenPlatformSettings && hasPermission('lifecycle.admin'));
  const effectiveCanManageCredits = canManageCredits ?? (canOpenPlatformSettings && hasPermission('credits.admin'));
  const hasPlatformSettings =
    effectiveCanManageWorkspace ||
    effectiveCanManageSecrets ||
    effectiveCanManageRuntimeSettings ||
    effectiveCanManageMcp ||
    effectiveCanManageModelConfig ||
    effectiveCanManageInvitations ||
    effectiveCanReadAudit ||
    effectiveCanManageLifecycle ||
    effectiveCanManageCredits;
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
  const [runtimeSettings, setRuntimeSettings] = useState<Required<RuntimeSettingsConfig>>(() =>
    normalizeRuntimeSettings({}),
  );
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
  const [invitationRequired, setInvitationRequired] = useState(false);
  const [invitations, setInvitations] = useState<InvitationRecord[]>([]);
  const [newInvitationCode, setNewInvitationCode] = useState('');
  const [newInvitationLabel, setNewInvitationLabel] = useState('');
  const [newInvitationMaxUses, setNewInvitationMaxUses] = useState('');
  const [invitationStatus, setInvitationStatus] = useState('');
  const [isSavingInvitations, setIsSavingInvitations] = useState(false);
  const [projectLifecycleOverview, setProjectLifecycleOverview] = useState<BeeGameProjectLifecycleOverview | null>(
    null,
  );
  const [projectLifecycleStatus, setProjectLifecycleStatus] = useState('');
  const [projectRetentionResult, setProjectRetentionResult] = useState<BeeGameProjectRetentionResult | null>(null);
  const [isProjectRetentionRunning, setIsProjectRetentionRunning] = useState(false);
  const [usageSummary, setUsageSummary] = useState<BeeGameUsageSummary | null>(null);
  const [billingStatus, setBillingStatus] = useState('');
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
        .then(configs => {
          if (cancelled) return;
          setExistingConfigs(configs);
          const defaultConfig = configs.find(config => config.isDefault) || configs[0];
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
        .then(settings => {
          if (cancelled) return;
          setWorkspacePath(settings.workspacePath);
          setWorkspaceStatus('');
        })
        .catch(error => {
          if (!cancelled) {
            setWorkspaceStatus(error instanceof Error ? error.message : text.workspaceReadFailed);
          }
        });
    }
    if (effectiveCanManageSecrets) {
      void getWebToolsConfig()
        .then(config => {
          if (cancelled) return;
          setWebSearchAdapter(config.webSearchAdapter || 'tavily');
          setBraveApiKeyPreview(config.braveApiKeyPreview || '');
          setExaApiKeyPreview(config.exaApiKeyPreview || '');
          setBraveApiKey('');
          setExaApiKey('');
          setWebToolsStatus('');
        })
        .catch(error => {
          if (!cancelled) {
            setWebToolsStatus(error instanceof Error ? error.message : text.webToolsReadFailed);
          }
        });
    }
    if (effectiveCanManageRuntimeSettings) {
      void getRuntimeSettings()
        .then(config => {
          if (cancelled) return;
          setRuntimeSettings(normalizeRuntimeSettings(config));
          setRuntimeSettingsStatus('');
        })
        .catch(error => {
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
        .catch(error => {
          if (!cancelled) {
            setInvitationStatus(error instanceof Error ? error.message : adminCopy.invitation.unavailable);
          }
        });
    }
    if (effectiveCanManageMcp) {
      void listMcpServers()
        .then(servers => {
          if (cancelled) return;
          setMcpServers(servers);
          setMcpForm(createEmptyMcpForm());
          setMcpFormAnchor(null);
          setIsMcpActionMenuOpen(false);
          setDiscoveredMcpServers([]);
          setMcpStatus('');
        })
        .catch(error => {
          if (!cancelled) {
            setMcpStatus(error instanceof Error ? error.message : 'MCP settings unavailable');
          }
        });
    }
    if (effectiveCanManageSkills) {
      void listUserSkills()
        .then(skills => {
          if (cancelled) return;
          setUserSkills(uniqueUserSkills(skills));
        })
        .catch(error => {
          if (!cancelled) {
            setUserSkills([]);
            showError(error instanceof Error ? error.message : userSkillsCopy.unavailable);
          }
        });
    }
    if (effectiveCanManageLifecycle) {
      void getProjectLifecycleOverview()
        .then(overview => {
          if (cancelled) return;
          setProjectLifecycleOverview(overview);
          setProjectLifecycleStatus('');
        })
        .catch(error => {
          if (!cancelled) {
            setProjectLifecycleOverview(null);
            setProjectLifecycleStatus(error instanceof Error ? error.message : projectLifecycleCopy.unavailable);
          }
        });
    }
    if (effectiveCanManageCredits) {
      void getCreditSummary()
        .then(summary => {
          if (cancelled) return;
          setUsageSummary(summary);
          setBillingStatus('');
        })
        .catch(error => {
          if (!cancelled) {
            setUsageSummary(null);
            setBillingStatus(error instanceof Error ? error.message : billingCopy.auditUnavailable);
          }
        });
      void Promise.all([getBillingCreditPacks(), getBillingEvents()])
        .then(([packs, events]) => {
          if (cancelled) return;
          setBillingCreditPacks(packs.packs);
          setBillingEvents(events.events);
          setBillingPackForm(createEmptyBillingPackForm());
        })
        .catch(error => {
          if (!cancelled) {
            setBillingCreditPacks([]);
            setBillingEvents([]);
            setBillingStatus(error instanceof Error ? error.message : billingCopy.billingUnavailable);
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
    effectiveCanManageCredits,
    effectiveCanManageLifecycle,
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
      setExistingConfigs([saved, ...existingConfigs.filter(config => config.id !== saved.id)]);
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
      setStatus(formatModelConfigError(error, text));
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
      setInvitations(current => [created, ...current.filter(item => item.id !== created.id)]);
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
      setInvitations(current => current.map(item => (item.id === updated.id ? updated : item)));
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
      setInvitations(current => current.filter(item => item.id !== id));
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
      const saved = formOverride.id ? await updateMcpServer(formOverride.id, payload) : await createMcpServer(payload);
      setMcpServers(current => [saved, ...current.filter(server => server.id !== saved.id)]);
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
      setMcpServers(current => {
        const next = current.filter(server => server.id !== id);
        setMcpForm(createEmptyMcpForm());
        setMcpFormAnchor(null);
        return next;
      });
      setMcpHealthById(current => {
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
      setUserSkills(current => uniqueUserSkills([saved, ...current.filter(skill => skill.id !== saved.id)]));
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
      setUserSkills(current => uniqueUserSkills(current.map(item => (item.id === saved.id ? saved : item))));
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
      setUserSkills(current => current.filter(item => item.id !== skill.id));
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
      setMcpHealthById(current => ({ ...current, [server.id]: result }));
    } catch (error) {
      setMcpHealthById(current => ({
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
      setMcpServers(current => [saved, ...current.filter(item => item.id !== saved.id)]);
      void handleTestMcpServer(saved);
      setDiscoveredMcpServers(current =>
        current.map(item =>
          item.name === server.name && item.sourcePath === server.sourcePath ? { ...item, exists: true } : item,
        ),
      );
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
      setMcpServers(current => [saved, ...current.filter(item => item.id !== saved.id)]);
      setMcpHealthById(current => ({ ...current, [saved.id]: server.test }));
      setActiveMcpServers(current =>
        current.map(item => (item.endpoint === server.endpoint ? { ...item, exists: true } : item)),
      );
    } catch (error) {
      setMcpStatus(error instanceof Error ? error.message : 'MCP server import failed');
    } finally {
      setIsSavingMcp(false);
    }
  };

  const webSearchKeyField = getWebSearchKeyField(webSearchAdapter);
  const webSearchKeyPreview =
    webSearchKeyField === 'brave' ? braveApiKeyPreview : webSearchKeyField === 'exa' ? exaApiKeyPreview : '';
  const webSearchKeyValue = webSearchKeyField === 'brave' ? braveApiKey : webSearchKeyField === 'exa' ? exaApiKey : '';
  const savedPrefix = `${text.savedPrefix}${text.savedPrefixSeparator}`;
  const capabilityCopy = settingsObject<RuntimeCapabilityCopy>('runtimeCapabilities');
  const mcpCopy = settingsObject<McpSettingsCopy>('mcp');
  const adminCopy = getAdminSettingsCopy(translateSettings);
  const sectionTabs = useMemo(
    () => [
      { id: 'personal' as const, label: text.settingsGeneral, icon: Globe },
      ...(effectiveCanManageSkills ? [{ id: 'skills' as const, label: userSkillsCopy.tab, icon: BookOpenText }] : []),
      ...(hasPlatformSettings ? [{ id: 'platform' as const, label: adminCopy.platform, icon: ShieldCheck }] : []),
    ],
    [adminCopy.platform, effectiveCanManageSkills, hasPlatformSettings, text.settingsGeneral, userSkillsCopy.tab],
  );
  const platformTabs = useMemo(() => {
    return [
      { id: 'general' as const, label: adminCopy.deployment, icon: ShieldCheck },
      ...(effectiveCanManageInvitations
        ? [{ id: 'invitations' as const, label: adminCopy.invitation.tab, icon: Ticket }]
        : []),
      ...(effectiveCanManageRuntimeSettings
        ? [{ id: 'runtime' as const, label: capabilityCopy.title, icon: Cpu }]
        : []),
      ...(effectiveCanManageMcp ? [{ id: 'mcp' as const, label: mcpCopy.title, icon: Network }] : []),
      ...(effectiveCanManageModelConfig ? [{ id: 'model' as const, label: text.settingsModel, icon: KeyRound }] : []),
      ...(effectiveCanManageLifecycle
        ? [{ id: 'projects' as const, label: projectLifecycleCopy.tab, icon: FolderOpen }]
        : []),
      ...(effectiveCanManageCredits ? [{ id: 'credit' as const, label: billingCopy.tab, icon: ReceiptText }] : []),
    ];
  }, [
    effectiveCanManageWorkspace,
    effectiveCanManageSecrets,
    effectiveCanManageMcp,
    effectiveCanManageModelConfig,
    effectiveCanManageInvitations,
    effectiveCanManageCredits,
    effectiveCanManageLifecycle,
    effectiveCanManageRuntimeSettings,
    effectiveCanReadAudit,
    adminCopy.deployment,
    billingCopy.tab,
    capabilityCopy.title,
    mcpCopy.title,
    projectLifecycleCopy.tab,
    text.settingsModel,
  ]);
  const activeTabLabel =
    activeSection === 'personal'
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
  const isSavingCurrentTab =
    activeSection === 'platform' && activeTab === 'general'
      ? effectiveCanManageSecrets && isSavingWebTools
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
  const isSaveDisabled =
    activeSection === 'platform' && activeTab === 'general'
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
    setRuntimeSettings(current => ({
      ...current,
      [key]: !current[key],
    }));
  };

  const handleSaveBillingPack = async () => {
    const priceId = billingPackForm.priceId.trim();
    const credits = Number(billingPackForm.credits);
    if (!priceId || !Number.isFinite(credits) || credits <= 0) {
      setBillingStatus(billingCopy.positiveCreditsRequired);
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
      setBillingCreditPacks(current =>
        [...current.filter(pack => pack.priceId !== result.pack.priceId), result.pack].sort(
          (left, right) => left.sortOrder - right.sortOrder || left.credits - right.credits,
        ),
      );
      setBillingPackForm(createEmptyBillingPackForm());
      setBillingStatus(billingCopy.packSaved);
    } catch (error) {
      setBillingStatus(error instanceof Error ? error.message : billingCopy.packSaveFailed);
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
    if (activeSection === 'platform' && !platformTabs.some(tab => tab.id === activeTab)) {
      setActiveTab(platformTabs[0]?.id ?? 'general');
    }
  }, [activeSection, activeTab, effectiveCanManageSkills, hasPlatformSettings, platformTabs]);

  return (
    <Dialog open={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent
        aria-label={t.settings}
        className="h-[min(680px,calc(100dvh-1rem))] w-[min(820px,calc(100vw-1rem))] max-w-none overflow-hidden p-0 text-foreground sm:h-[min(620px,calc(100dvh-2rem))] sm:w-[min(820px,calc(100vw-2rem))]"
      >
        <div
          onClick={event => event.stopPropagation()}
          data-testid="settings-modal-shell"
          className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground sm:flex-row"
        >
          <aside
            data-testid="settings-modal-sidebar"
            className="flex h-auto w-full shrink-0 flex-col border-b border-border bg-muted/30 p-2 sm:h-full sm:w-44 sm:border-b-0 sm:border-r sm:p-3"
          >
            <div className="mb-2 flex items-center justify-between sm:mb-4">
              <button
                type="button"
                aria-label={text.closeSettings}
                onClick={onClose}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1 sm:block sm:space-y-1.5 sm:overflow-visible sm:pb-0" role="tablist" aria-label={t.systemSettings}>
              {sectionTabs.map(tab => {
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
                    className={`flex h-9 min-w-max items-center gap-2 rounded-lg px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-full ${selected ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground'}`}
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
            {activeSection === 'platform' ? (
                <div className="mt-2 border-t border-border pt-2 sm:mt-4 sm:pt-3">
                <div className="type-caption-1 mb-2 px-3 text-muted-foreground">{adminCopy.platform}</div>
                <div className="flex gap-1.5 overflow-x-auto pb-1 sm:block sm:space-y-1.5 sm:overflow-visible sm:pb-0" role="tablist" aria-label={adminCopy.platform}>
                  {platformTabs.map(tab => {
                    const Icon = tab.icon;
                    const selected = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        onClick={() => setActiveTab(tab.id)}
                    className={`flex h-9 min-w-max items-center gap-2 rounded-lg px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-full ${selected ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground'}`}
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

          <main data-testid="settings-modal-content" className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <header className="shrink-0 px-6 pb-3 pt-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs text-muted-foreground">
                    {activeSection === 'platform'
                      ? adminCopy.platform
                      : activeSection === 'skills'
                        ? userSkillsCopy.tab
                        : t.systemSettings}
                  </div>
                  <h2 className="mt-2 text-xl font-semibold text-foreground">{activeTabLabel}</h2>
                </div>
                {activeSection === 'platform' && activeTab === 'mcp' && effectiveCanManageMcp ? (
                  <div className="relative mt-2">
                    <button
                      type="button"
                      aria-label={mcpCopy.form.actions}
                      aria-haspopup="menu"
                      aria-expanded={isMcpActionMenuOpen}
                      onClick={event => {
                        if (!isMcpActionMenuOpen) {
                          setMcpFormAnchor(null);
                        }
                        setIsMcpActionMenuOpen(current => !current);
                        event.currentTarget.dataset.anchor = 'mcp-actions';
                      }}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-background text-foreground shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                    {isMcpActionMenuOpen ? (
                      <>
                        <div className="fixed inset-0 z-[250]" onMouseDown={() => setIsMcpActionMenuOpen(false)} />
                        <div
                          role="menu"
                          className="absolute right-0 top-12 z-[260] w-56 overflow-hidden rounded-lg border border-border bg-background p-1.5 shadow-lg"
                          onMouseDown={event => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setIsMcpActionMenuOpen(false);
                              void handleDiscoverActiveMcpServers();
                            }}
                            disabled={isScanningActiveMcp}
                            className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Network className="h-4 w-4 text-orange-300" />
                            {isScanningActiveMcp ? mcpCopy.form.scanning : mcpCopy.form.scanActive}
                          </button>
                          <div className="my-1 h-px bg-border" />
                          <button
                            type="button"
                            role="menuitem"
                            onClick={event => {
                              const anchor = document.querySelector('[data-anchor="mcp-actions"]');
                              setMcpForm(createEmptyMcpForm());
                              setMcpStatus('');
                              setIsMcpActionMenuOpen(false);
                              setMcpFormAnchor({
                                kind: 'new',
                                rect: toPopoverAnchorRect((anchor ?? event.currentTarget).getBoundingClientRect()),
                              });
                            }}
                            className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-foreground transition-colors hover:bg-accent"
                          >
                            <Plus className="h-4 w-4 text-muted-foreground" />
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
                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-background text-foreground shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <FaPlus className="h-4 w-4" />
                    </button>
                  </div>
                ) : null}
              </div>
            </header>

            <div className="mx-6 h-px shrink-0 bg-border" />

            <div
              data-testid="settings-modal-scroll-area"
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-2 [scrollbar-gutter:stable]"
            >
              {activeSection === 'personal' && activeTab === 'general' ? (
                <div className="divide-y divide-border">
                  <label className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center">
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Globe className="h-4 w-4 text-muted-foreground" />
                      {t.language}
                    </span>
                    <select
                      value={lang}
                      onChange={event => onSetLang(event.target.value as Language)}
                      className="h-10 w-full rounded-lg border border-input bg-background px-3 text-[16px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30 min-[900px]:text-md"
                    >
                      {LANGUAGE_OPTIONS.map(option => (
                        <option key={option.code} value={option.code}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center">
                    <span className="text-sm font-medium text-foreground">{t.theme}</span>
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
                      <span className="text-sm text-muted-foreground">{isDark ? t.darkMode : t.lightMode}</span>
                      <Switch checked={isDark} aria-label={t.theme} onCheckedChange={() => toggleTheme()} />
                    </div>
                  </div>
                </div>
              ) : null}

              {activeSection === 'platform' && activeTab === 'general' ? (
                <div className="divide-y divide-border">
                  {effectiveCanManageWorkspace ? (
                    <div className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center">
                      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <FolderOpen className="h-4 w-4 text-muted-foreground" />
                        {text.workspacePath}
                      </span>
                      <div className="min-w-0 space-y-2">
                        <div className="max-w-full whitespace-normal break-all rounded-lg border border-border bg-muted px-3 py-3 font-mono text-xs text-foreground">
                          {workspacePath || adminCopy.workspaceManaged}
                        </div>
                        <div className="text-xs text-muted-foreground">{adminCopy.workspaceNote}</div>
                        {workspaceStatus ? (
                          <div className="text-xs text-foreground dark:text-foreground">{workspaceStatus}</div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {effectiveCanManageSecrets ? (
                    <WebToolsPanel
                      label={text.webSearch}
                      searchBackend={text.searchBackend}
                      adapter={webSearchAdapter}
                      keyField={webSearchKeyField}
                      keyValue={webSearchKeyValue}
                      keyPreview={webSearchKeyPreview}
                      savedPrefix={savedPrefix}
                      status={webToolsStatus}
                      onAdapterChange={setWebSearchAdapter}
                      onKeyChange={value => {
                        if (webSearchKeyField === 'brave') setBraveApiKey(value);
                        if (webSearchKeyField === 'exa') setExaApiKey(value);
                      }}
                    />
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
                  onToggleRequired={() => setInvitationRequired(value => !value)}
                  onNewCodeChange={setNewInvitationCode}
                  onNewLabelChange={setNewInvitationLabel}
                  onNewMaxUsesChange={setNewInvitationMaxUses}
                  onCreate={() => void handleCreateInvitation()}
                  onToggleInvitation={invitation => void handleToggleInvitation(invitation)}
                  onDeleteInvitation={id => void handleDeleteInvitation(id)}
                />
              ) : null}

              {activeSection === 'platform' && activeTab === 'projects' && effectiveCanManageLifecycle ? (
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

              {activeSection === 'platform' && activeTab === 'credit' && effectiveCanManageCredits ? (
                <UsageBillingPanel
                  summary={usageSummary}
                  status={billingStatus}
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
                <RuntimeSettingsPanel
                  copy={capabilityCopy}
                  settings={runtimeSettings}
                  status={runtimeSettingsStatus}
                  onToggle={updateRuntimeSetting}
                />
              ) : null}

              {activeSection === 'platform' && activeTab === 'model' && effectiveCanManageModelConfig ? (
                <ModelConfigPanel
                  labels={{
                    provider: text.provider,
                    baseUrl: text.baseUrl,
                    apiKey: text.apiKey,
                    models: text.models,
                    fast: text.fast,
                    balanced: text.balanced,
                    strong: text.strong,
                    fastModel: text.fastModel,
                    balancedModel: text.balancedModel,
                    strongModel: text.strongModel,
                  }}
                  provider={provider}
                  baseUrl={baseUrl}
                  apiKey={apiKey}
                  fastModel={fastModel}
                  balancedModel={balancedModel}
                  strongModel={strongModel}
                  apiKeyPreview={apiKeyPreview}
                  savedPrefix={savedPrefix}
                  onProviderChange={setProvider}
                  onBaseUrlChange={setBaseUrl}
                  onApiKeyChange={setApiKey}
                  onFastModelChange={setFastModel}
                  onBalancedModelChange={setBalancedModel}
                  onStrongModelChange={setStrongModel}
                  onSubmit={event => {
                    event.preventDefault();
                    if (!isSaveDisabled) void handleSaveSettings();
                  }}
                />
              ) : null}
              {activeSection === 'platform' && activeTab === 'model' && status ? (
                <p role="status" className="mt-3 text-sm text-destructive">{status}</p>
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
                  onTest={server => void handleTestMcpServer(server)}
                  onDelete={id => void handleDeleteMcpServer(id)}
                  onImport={server => void handleImportDiscoveredMcpServer(server)}
                  onImportActive={server => void handleImportActiveMcpServer(server)}
                />
              ) : null}
              {activeSection === 'skills' && effectiveCanManageSkills ? (
                <UserSkillsSettingsPanel
                  copy={userSkillsCopy}
                  skills={userSkills}
                  isSaving={isSavingUserSkill}
                  onImport={file => void handleImportUserSkill(file)}
                  onToggle={skill => void handleToggleUserSkill(skill)}
                  onDelete={skill => void handleDeleteUserSkill(skill)}
                />
              ) : null}
            </div>
            {activeSection === 'platform' &&
            activeTab !== 'mcp' &&
            activeTab !== 'projects' &&
            activeTab !== 'credit' &&
            (activeTab !== 'general' || hasGeneralSaveAction) ? (
              <div className="flex items-center justify-end border-t border-border bg-muted/30 px-6 py-4">
                <button
                  type="button"
                  aria-label={text.saveSettings}
                  onClick={handleSaveSettings}
                  disabled={isSaveDisabled}
                  className="rounded-md border border-transparent bg-primary text-primary-foreground inline-flex h-11 items-center px-6 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSavingCurrentTab ? text.saving : text.saveSettings}
                </button>
              </div>
            ) : null}
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatModelConfigError(error: unknown, text: Record<string, any>): string {
  if (!(error instanceof Error)) return text.modelSaveFailed;
  const apiError = error as Error & { code?: string; hostname?: string };
  const messages: Record<string, unknown> = {
    outbound_invalid_url: text.modelOutboundInvalidUrl,
    outbound_unsupported_protocol: text.modelOutboundHttpsRequired,
    outbound_embedded_credentials: text.modelOutboundCredentials,
    outbound_host_not_allowed: text.modelOutboundHostNotAllowed,
    outbound_port_not_allowed: text.modelOutboundPortNotAllowed,
    outbound_dns_unresolved: text.modelOutboundDnsUnresolved,
    outbound_address_not_public: text.modelOutboundAddressNotPublic,
  };
  const template = apiError.code ? messages[apiError.code] : undefined;
  return typeof template === 'string' ? template.replace('{host}', apiError.hostname || '') : error.message;
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
      usedCount: (usedCount: number, maxUses?: number | null) =>
        maxUses
          ? translate('admin.invitation.usedCountLimited', { usedCount, maxUses })
          : translate('admin.invitation.usedCountUnlimited', { usedCount }),
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
    noReference: translate('billing.noReference'),
    positiveCreditsRequired: translate('billing.positiveCreditsRequired'),
    packSaved: translate('billing.packSaved'),
    packSaveFailed: translate('billing.packSaveFailed'),
    auditUnavailable: translate('billing.auditUnavailable'),
    billingUnavailable: translate('billing.billingUnavailable'),
    metrics: {
      consumed: translate('billing.metrics.consumed'),
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
    projectsLimitValue: (used: number, limit: number) =>
      translate('projectLifecycle.projectsLimitValue', { used, limit }),
    unlimited: translate('projectLifecycle.unlimited'),
    remainingValue: (count: number) => translate('projectLifecycle.remainingValue', { count }),
    supabaseEnabled: translate('projectLifecycle.supabaseEnabled'),
    localOnly: translate('projectLifecycle.localOnly'),
    retentionTitle: translate('projectLifecycle.retentionTitle'),
    retentionDescription: translate('projectLifecycle.retentionDescription'),
    dryRun: translate('projectLifecycle.dryRun'),
    runRetention: translate('projectLifecycle.runRetention'),
    retentionSummary: (planned: number, deleted: number, retained: number) =>
      translate('projectLifecycle.retentionSummary', { planned, deleted, retained }),
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
    resourceLibraryEnabled: config.resourceLibraryEnabled ?? true,
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
    envText: (server.env || []).map(item => `${item.key}=${item.value || ''}`).join('\n'),
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
            .map(item => item.trim())
            .filter(Boolean),
        }
      : { url: form.url.trim() }),
    ...(form.cwd.trim() ? { cwd: form.cwd.trim() } : {}),
    env: form.envText
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const [key, ...rest] = line.split('=');
        return {
          key: key.trim(),
          value: rest.join('=').trim(),
        };
      })
      .filter(item => item.key),
    autoStart: form.autoStart,
  };
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
