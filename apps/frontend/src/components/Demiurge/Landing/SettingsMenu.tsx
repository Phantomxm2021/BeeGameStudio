import {resolveModelApiProtocol,type ModelApiProtocol} from '@bee-game-studio/agent-workflow/model-protocol';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { motion } from 'motion/react';
import { EASE_OUT } from '../../beui/registry/lib/ease';
import { ModelConnectionsPanel, type ModelConnectionsHandle, type ModelConnectionsSaveState } from '../../Settings/ModelConnectionsPanel';
import { BgsSettingsPanel } from '../../Settings/BgsSettingsPanel';
import { PersonalImageConnectionPanel, type PersonalImageConnectionHandle, type PersonalImageConnectionSaveState } from '../../Settings/PersonalImageConnectionPanel';
import {
  BookOpenText,
  Cpu,
  FolderOpen,
  Globe,
  KeyRound,
  Info,
  Image,
  MoreHorizontal,
  Pencil,
  Network,
  Plus,
  Plus as FaPlus,
  ReceiptText,
  ShieldCheck,
  Ticket,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ImageGenerationSettingsPanel, type ImageSettingsHandle, type ImageSettingsState } from '../../Settings/ImageGenerationSettingsPanel';
import { LANGUAGE_OPTIONS, type Language } from '../AgentsConfig';
import { Switch } from '../../ui/switch';
import { normalizeI18nLanguage, useBeeGameText, useCommonText } from '../../../i18n/useBeeGameTranslations';
import { getBeeGameWorkspaceSettings } from '../../../services/beeGameAdapter';
import {
  createModelConfig,
  deleteModelConfig,
  listModelConfigs,
  updateModelConfig,
  type ModelConfig,
  type ModelProviderKind,
  type ModelAuthMethod,
} from '../../../services/modelConfigApi';
import {
  getRuntimeSettings,
  saveRuntimeSettings,
  type RuntimeSettingsConfig,
} from '../../../services/runtimeSettingsApi';
import {
  createMcpServer,
  deleteMcpServer,
  discoverActiveMcpServers,
  discoverMcpServers,
  importDiscoveredMcpServer,
  listMcpServers,
  testMcpServer,
  updateMcpServer,
  type ActiveDiscoveredMcpServer,
  type DiscoveredMcpServer,
  type McpServerConfig,
  type McpServerInput,
  type McpServerTestResult,
} from '../../../services/mcpServersApi';
import { useUserSkillsSettings } from '../../../hooks/useUserSkillsSettings';
import { useSettingsSectionLoad } from '../../../hooks/useSettingsSectionLoad';
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
import { getOpenCodeGoProvider, OPENCODE_GO_PROFILES } from '@bee-game-studio/agent-workflow/opencode-go';
import { Dialog, DialogContent } from '../../ui/dialog';
import { MorphPopover, MorphPopoverContent, MorphPopoverTrigger } from '../../beui/registry/components/motion/popover-morph';
import { CloseIconButton } from '../../ui/CloseIconButton';
import { Tabs, TabsList, TabsTrigger } from '../../beui/motion/tabs';
import { ProjectSelect } from '../../beui/project-select';
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
  canManageRuntimeSettings?: boolean;
  canManageMcp?: boolean;
  canManageSkills?: boolean;
  canManageModelConfig?: boolean;
  canManageInvitations?: boolean;
  canReadAudit?: boolean;
  canManageLifecycle?: boolean;
  canManageCredits?: boolean;
}

type SettingsSection = 'personal' | 'connections' | 'image-connection' | 'skills' | 'mcp' | 'platform';
type SettingsTab = 'general' | 'runtime' | 'skills' | 'model' | 'image' | 'invitations' | 'projects' | 'credit';
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
  const adminCopy = getAdminSettingsCopy(translateSettings);
  const { showError, showSuccess, showWarning } = useToastContext();
  const currentUser = useSystemStore(state => state.currentUser);
  const isDark = useSystemStore(state => state.isDark);
  const toggleTheme = useSystemStore(state => state.toggleTheme);
  const hasPermission = useSystemStore(state => state.hasPermission);
  const canOpenPlatformSettings = currentUser?.role === 'owner';
  const effectiveCanManageWorkspace =
    canManageWorkspace ?? (canOpenPlatformSettings && hasPermission('workspace.manage'));
  const effectiveCanManageRuntimeSettings =
    canManageRuntimeSettings ?? (canOpenPlatformSettings && hasPermission('runtime_settings.manage'));
  const effectiveCanManageMcp = canManageMcp ?? Boolean(currentUser && hasPermission('mcp.manage'));
  const canDiscoverHostMcp = canOpenPlatformSettings && hasPermission('workspace.manage');
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
    effectiveCanManageRuntimeSettings ||
    effectiveCanManageModelConfig ||
    effectiveCanManageInvitations ||
    effectiveCanReadAudit ||
    effectiveCanManageLifecycle ||
    effectiveCanManageCredits;
  const [existingConfigs, setExistingConfigs] = useState<ModelConfig[]>([]);
  const [selectedModelConfigId, setSelectedModelConfigId] = useState('');
  const [modelAction, setModelAction] = useState<'create' | 'details' | 'rename' | 'delete' | null>(null);
  const [activeModelPopoverId, setActiveModelPopoverId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [provider, setProvider] = useState<ModelProviderKind>('openai-compatible');
  const [apiProtocol,setApiProtocol]=useState<ModelApiProtocol>('responses');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [apiKeyPreview, setApiKeyPreview] = useState('');
  const [isDefault, setIsDefault] = useState(true);
  const [published, setPublished] = useState(true);
  const [authMethods, setAuthMethods] = useState<ModelAuthMethod[]>(['platform']);
  const goProvider = getOpenCodeGoProvider(baseUrl);
  const goProfile = goProvider ? OPENCODE_GO_PROFILES[goProvider] : undefined;
  const [goModelsReady, setGoModelsReady] = useState(false);
  const goModelsComplete = !goProfile || goModelsReady;
  const [status, setStatus] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const imageSettingsRef = useRef<ImageSettingsHandle>(null);
  const [imageSettingsState, setImageSettingsState] = useState<ImageSettingsState>({ busy: false, canSave: false });
  const modelConnectionsRef = useRef<ModelConnectionsHandle>(null);
  const [modelConnectionSaveState, setModelConnectionSaveState] = useState<ModelConnectionsSaveState>({ visible: false, disabled: true, busy: false });
  const imageConnectionRef = useRef<PersonalImageConnectionHandle>(null);
  const [imageConnectionSaveState, setImageConnectionSaveState] = useState<PersonalImageConnectionSaveState>({ disabled: true, busy: false });
  const [workspacePath, setWorkspacePath] = useState('');
  const [workspaceStatus, setWorkspaceStatus] = useState('');

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
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [activeSection, setActiveSection] = useState<SettingsSection>('personal');
  const {
    userSkills, loading: skillsLoading, isSavingUserSkill, handleImportUserSkill, handleToggleUserSkill, handleDeleteUserSkill,
  } = useUserSkillsSettings({ isOpen, allowed: effectiveCanManageSkills, selected: activeSection === 'skills',
    userId: currentUser?.id, copy: userSkillsCopy });
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

  const modelsLoading = useSettingsSectionLoad({
    isOpen, allowed: effectiveCanManageModelConfig,
    selected: activeSection === 'platform' && activeTab === 'model', userId: currentUser?.id,
    load: isCurrent => {
      setModelAction(null);
      setActiveModelPopoverId(null);
      setApiKey('');
      return listModelConfigs()
        .then(configs => {
          if (!isCurrent()) return;
          setExistingConfigs(configs);
          const defaultConfig = configs.find(config => config.isDefault) || configs[0];
          if (!defaultConfig) return;
          setSelectedModelConfigId(defaultConfig.id);
          setName(defaultConfig.name);
          setProvider(defaultConfig.provider);
          setApiProtocol(defaultConfig.apiProtocol ?? resolveModelApiProtocol(defaultConfig.provider));
          setBaseUrl(defaultConfig.baseUrl || '');
          setModel(defaultConfig.model || '');
          setApiKeyPreview(defaultConfig.apiKeyPreview || '');
          setIsDefault(defaultConfig.isDefault);
          setPublished(defaultConfig.published ?? true);
          setAuthMethods(defaultConfig.authMethods ?? ['platform']);
        })
        .catch(() => {
          if (isCurrent()) {
            setExistingConfigs([]);
            setSelectedModelConfigId('');
            setApiKeyPreview('');
            setStatus(lang.startsWith('zh') ? '无法读取模型配置，请关闭设置后重试。' : 'Could not load model configurations. Reopen Settings to try again.');
          }
        });
    },
  });
  const workspaceLoading = useSettingsSectionLoad({
    isOpen, allowed: effectiveCanManageWorkspace,
    selected: activeSection === 'platform' && activeTab === 'general', userId: currentUser?.id,
    load: isCurrent => {
      return getBeeGameWorkspaceSettings()
        .then(settings => {
          if (!isCurrent()) return;
          setWorkspacePath(settings.workspacePath);
          setWorkspaceStatus('');
        })
        .catch(error => {
          if (isCurrent()) {
            setWorkspaceStatus(error instanceof Error ? error.message : text.workspaceReadFailed);
          }
        });
    },
  });
  const runtimeLoading = useSettingsSectionLoad({
    isOpen, allowed: effectiveCanManageRuntimeSettings,
    selected: activeSection === 'platform' && activeTab === 'runtime', userId: currentUser?.id,
    load: isCurrent => {
      return getRuntimeSettings()
        .then(config => {
          if (!isCurrent()) return;
          setRuntimeSettings(normalizeRuntimeSettings(config));
          setRuntimeSettingsStatus('');
        })
        .catch(error => {
          if (isCurrent()) {
            setRuntimeSettingsStatus(error instanceof Error ? error.message : 'Runtime settings unavailable');
          }
        });
    },
  });
  const invitationsLoading = useSettingsSectionLoad({
    isOpen, allowed: effectiveCanManageInvitations,
    selected: activeSection === 'platform' && activeTab === 'invitations', userId: currentUser?.id,
    load: isCurrent => {
      return Promise.all([getInvitationPublicSettings(), listInvitations()])
        .then(([settings, records]) => {
          if (!isCurrent()) return;
          setInvitationRequired(settings.required);
          setInvitations(records);
          setNewInvitationCode('');
          setNewInvitationLabel('');
          setNewInvitationMaxUses('');
          setInvitationStatus('');
        })
        .catch(error => {
          if (isCurrent()) {
            setInvitationStatus(error instanceof Error ? error.message : adminCopy.invitation.unavailable);
          }
        });
    },
  });
  const mcpLoading = useSettingsSectionLoad({
    isOpen, allowed: effectiveCanManageMcp,
    selected: activeSection === 'mcp', userId: currentUser?.id,
    load: isCurrent => {
      return listMcpServers()
        .then(servers => {
          if (!isCurrent()) return;
          setMcpServers(servers);
          setMcpForm(createEmptyMcpForm());
          setMcpFormAnchor(null);
          setIsMcpActionMenuOpen(false);
          setDiscoveredMcpServers([]);
          setMcpStatus('');
        })
        .catch(error => {
          if (isCurrent()) {
            showError(error instanceof Error ? error.message : 'MCP settings unavailable');
          }
        });
    },
  });
  const lifecycleLoading = useSettingsSectionLoad({
    isOpen, allowed: effectiveCanManageLifecycle,
    selected: activeSection === 'platform' && activeTab === 'projects', userId: currentUser?.id,
    load: isCurrent => {
      return getProjectLifecycleOverview()
        .then(overview => {
          if (!isCurrent()) return;
          setProjectLifecycleOverview(overview);
          setProjectLifecycleStatus('');
        })
        .catch(error => {
          if (isCurrent()) {
            setProjectLifecycleOverview(null);
            setProjectLifecycleStatus(error instanceof Error ? error.message : projectLifecycleCopy.unavailable);
          }
        });
    },
  });
  const creditsLoading = useSettingsSectionLoad({
    isOpen, allowed: effectiveCanManageCredits,
    selected: activeSection === 'platform' && activeTab === 'credit', userId: currentUser?.id,
    load: isCurrent => {
      const summary = getCreditSummary()
        .then(summary => {
          if (!isCurrent()) return;
          setUsageSummary(summary);
          setBillingStatus('');
        })
        .catch(error => {
          if (isCurrent()) {
            setUsageSummary(null);
            setBillingStatus(error instanceof Error ? error.message : billingCopy.auditUnavailable);
          }
        });
      const billing = Promise.all([getBillingCreditPacks(), getBillingEvents()])
        .then(([packs, events]) => {
          if (!isCurrent()) return;
          setBillingCreditPacks(packs.packs);
          setBillingEvents(events.events);
          setBillingPackForm(createEmptyBillingPackForm());
        })
        .catch(error => {
          if (isCurrent()) {
            setBillingCreditPacks([]);
            setBillingEvents([]);
            setBillingStatus(error instanceof Error ? error.message : billingCopy.billingUnavailable);
          }
        });
      return Promise.all([summary, billing]);
    },
  });

  const isLoadingCurrentSection = activeSection === 'skills' ? skillsLoading
    : activeSection === 'mcp' ? mcpLoading
    : activeSection !== 'platform' ? false
    : activeTab === 'general' ? workspaceLoading
    : activeTab === 'runtime' ? runtimeLoading
    : activeTab === 'model' ? modelsLoading
    : activeTab === 'invitations' ? invitationsLoading
    : activeTab === 'projects' ? lifecycleLoading
    : activeTab === 'credit' ? creditsLoading : false;

  useEffect(() => {
    return () => {
      if (mcpAutoSaveTimerRef.current !== null) {
        window.clearTimeout(mcpAutoSaveTimerRef.current);
        mcpAutoSaveTimerRef.current = null;
      }
    };
  }, [isOpen, effectiveCanManageMcp, currentUser?.id]);

  const openModelConfig = (action: NonNullable<typeof modelAction>, config?: ModelConfig) => {
    setSelectedModelConfigId(config?.id ?? ''); setName(config?.name ?? ''); setProvider(config?.provider ?? 'openai-compatible');setApiProtocol(config ? config.apiProtocol ?? resolveModelApiProtocol(config.provider) : 'responses');
    setBaseUrl(config?.baseUrl ?? ''); setApiKey(''); setApiKeyPreview(config?.apiKeyPreview ?? '');
    setModel(config?.model ?? '');
    setIsDefault(config?.isDefault ?? existingConfigs.length === 0); setPublished(config?.published ?? true); setAuthMethods(config?.authMethods ?? ['platform']);
    setStatus(''); setModelAction(action);
  };
  const closeModelConfig = () => { if (!isSaving) { setModelAction(null); setActiveModelPopoverId(null); setApiKey(''); setStatus(''); } };
  const handleModelListAction = async () => {
    if (!selectedModelConfigId || (modelAction === 'rename' && !name.trim())) return;
    setIsSaving(true); setStatus('');
    try {
      if (modelAction === 'delete') {
        const result = await deleteModelConfig(selectedModelConfigId);
        if (!result.deleted) throw new Error(lang.startsWith('zh') ? '模型未删除，请刷新后核对。' : 'Model was not deleted. Refresh and check again.');
        setExistingConfigs(current => current.filter(config => config.id !== selectedModelConfigId));
      } else {
        const saved = await updateModelConfig(selectedModelConfigId, { name: name.trim() });
        setExistingConfigs(current => current.map(config => config.id === saved.id ? saved : config));
      }
      setModelAction(null);
      setActiveModelPopoverId(null);
    } catch (error) { showError(formatModelConfigError(error, text)); }
    finally { setIsSaving(false); }
  };

  const handleSaveModelConfig = async () => {
    setStatus('');
    setIsSaving(true);
    try {
      const payload = {
        name: name.trim() || (goProfile ? 'OpenCode Go' : 'BeeGame LLM'),
        published,
        authMethods,
        provider,
        apiProtocol,
        baseUrl: baseUrl.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        model: model.trim(),
        isDefault,
      };
      const saved = selectedModelConfigId
        ? await updateModelConfig(selectedModelConfigId, payload)
        : await createModelConfig({
            ...payload,
            apiKey: apiKey.trim(),
          });
      setSelectedModelConfigId(saved.id);
      setExistingConfigs(current => {
        const others = current.filter(config => config.id !== saved.id).map(config => saved.isDefault ? { ...config, isDefault: false } : config);
        return [...others, saved];
      });
      setName(saved.name);
      setProvider(saved.provider);
      setApiProtocol(saved.apiProtocol ?? resolveModelApiProtocol(saved.provider));
      setBaseUrl(saved.baseUrl || '');
      setModel(saved.model || '');
      setApiKeyPreview(saved.apiKeyPreview || apiKeyPreview);
      setApiKey('');
      return true;
    } catch (error) {
      showError(formatModelConfigError(error, text));
      return false;
    } finally {
      setIsSaving(false);
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
      showError(error instanceof Error ? error.message : 'Runtime settings save failed');
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
      showError(error instanceof Error ? error.message : adminCopy.invitation.saveFailed);
      return false;
    } finally {
      setIsSavingInvitations(false);
    }
  };

  const handleCreateInvitation = async () => {
    const code = newInvitationCode.trim();
    if (!code) {
      showError(adminCopy.invitation.codeRequired);
      return;
    }
    const maxUses = parsePositiveInteger(newInvitationMaxUses);
    if (newInvitationMaxUses.trim() && maxUses === null) {
      showError(adminCopy.invitation.maxUsesInvalid);
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
      showError(error instanceof Error ? error.message : adminCopy.invitation.createFailed);
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
      showError(error instanceof Error ? error.message : adminCopy.invitation.updateFailed);
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
      showError(error instanceof Error ? error.message : adminCopy.invitation.deleteFailed);
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
      showError(error instanceof Error ? error.message : projectLifecycleCopy.dryRunFailed);
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
      showError(error instanceof Error ? error.message : projectLifecycleCopy.runFailed);
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
      showError(error instanceof Error ? error.message : 'MCP server save failed');
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
      showError(error instanceof Error ? error.message : 'MCP server delete failed');
    } finally {
      setIsSavingMcp(false);
    }
  };


  const handleImportUserSkillInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) void handleImportUserSkill(file);
  };



  const handleTestMcpServer = async (server: McpServerConfig) => {
    setMcpStatus('');
    setTestingMcpServerId(server.id);
    try {
      const result = await testMcpServer(mcpServerToInput(server));
      setMcpHealthById(current => ({ ...current, [server.id]: result }));
      if (result.status === 'untested') showWarning(result.message);
      else if (!result.ok) showError(result.message || 'MCP connection test failed');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MCP connection test failed';
      setMcpHealthById(current => ({
        ...current,
        [server.id]: {
          ok: false,
          status: 'unavailable',
          message,
          checkedAt: new Date().toISOString(),
        },
      }));
      showError(message);
    } finally {
      setTestingMcpServerId('');
    }
  };

  const handleDiscoverActiveMcpServers = async () => {
    setMcpStatus('');
    setIsScanningActiveMcp(true);
    try {
      const [configs, active] = await Promise.allSettled([discoverMcpServers(), discoverActiveMcpServers()]);
      const activeServers = active.status === 'fulfilled' ? active.value : [];
      // HTTP configurations already found by the live scan need only one row.
      const configuredServers = configs.status === 'fulfilled'
        ? configs.value.filter(server => !server.url || !activeServers.some(item => item.url === server.url))
        : [];
      setDiscoveredMcpServers(configuredServers);
      setActiveMcpServers(activeServers);
      const failure = [configs, active].find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') {
        showError(failure.reason instanceof Error ? failure.reason.message : 'MCP discovery failed');
      } else {
        const count = configuredServers.length + activeServers.length;
        if (!count) showWarning(mcpCopy.form.noActiveDiscovered);
        else showSuccess(translateSettings('mcp.form.discoveryFound', { count }));
      }
    } finally {
      setIsScanningActiveMcp(false);
    }
  };

  const handleImportDiscoveredMcpServer = async (server: DiscoveredMcpServer) => {
    setMcpStatus('');
    setIsSavingMcp(true);
    try {
      const saved = await importDiscoveredMcpServer(server);
      setMcpServers(current => [saved, ...current.filter(item => item.id !== saved.id)]);
      setDiscoveredMcpServers(current =>
        current.map(item =>
          item.name === server.name && item.sourcePath === server.sourcePath ? { ...item, exists: true } : item,
        ),
      );
    } catch (error) {
      showError(error instanceof Error ? error.message : 'MCP server import failed');
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
      showError(error instanceof Error ? error.message : 'MCP server import failed');
    } finally {
      setIsSavingMcp(false);
    }
  };

  const savedPrefix = `${text.savedPrefix}${text.savedPrefixSeparator}`;
  const capabilityCopy = settingsObject<RuntimeCapabilityCopy>('runtimeCapabilities');
  const mcpCopy = settingsObject<McpSettingsCopy>('mcp');
  const sectionTabs = useMemo(
    () => [
      { id: 'personal' as const, label: text.settingsGeneral, icon: Globe },
      ...(currentUser ? [{ id: 'connections' as const, label: lang.startsWith('zh') ? '模型连接' : 'Model connections', icon: KeyRound }] : []),
      ...(currentUser ? [{ id: 'image-connection' as const, label: lang.startsWith('zh') ? 'AI 生图' : 'AI Images', icon: Image }] : []),
      ...(effectiveCanManageSkills ? [{ id: 'skills' as const, label: userSkillsCopy.tab, icon: BookOpenText }] : []),
      ...(effectiveCanManageMcp ? [{ id: 'mcp' as const, label: mcpCopy.title, icon: Network }] : []),
      ...(hasPlatformSettings ? [{ id: 'platform' as const, label: adminCopy.platform, icon: ShieldCheck }] : []),
    ],
    [adminCopy.platform, currentUser, lang, effectiveCanManageSkills, effectiveCanManageMcp, hasPlatformSettings, mcpCopy.title, text.settingsGeneral, userSkillsCopy.tab],
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
      ...(effectiveCanManageModelConfig ? [{ id: 'model' as const, label: text.settingsModel, icon: KeyRound }] : []),
      ...(effectiveCanManageModelConfig ? [{ id: 'image' as const, label: lang.startsWith('zh') ? '生图服务' : 'Image service', icon: Cpu }] : []),
      ...(effectiveCanManageLifecycle
        ? [{ id: 'projects' as const, label: projectLifecycleCopy.tab, icon: FolderOpen }]
        : []),
      ...(effectiveCanManageCredits ? [{ id: 'credit' as const, label: billingCopy.tab, icon: ReceiptText }] : []),
    ];
  }, [
    effectiveCanManageModelConfig,
    lang,
    effectiveCanManageInvitations,
    effectiveCanManageCredits,
    effectiveCanManageLifecycle,
    effectiveCanManageRuntimeSettings,
    adminCopy.deployment,
    adminCopy.invitation.tab,
    billingCopy.tab,
    capabilityCopy.title,
    projectLifecycleCopy.tab,
    text.settingsModel,
  ]);
  const activeTabLabel =
    activeSection === 'connections' ? (lang.startsWith('zh') ? '模型连接' : 'Model connections') : activeSection === 'personal'
      ? text.settingsGeneral
      : activeSection === 'image-connection'
        ? (lang.startsWith('zh') ? 'AI 生图' : 'AI Images')
      : activeSection === 'skills'
        ? userSkillsCopy.title
        : activeSection === 'mcp'
          ? mcpCopy.title
        : activeTab === 'image'
          ? (lang.startsWith('zh') ? '生图服务' : 'Image service')
        : activeTab === 'general'
          ? adminCopy.deployment
          : activeTab === 'runtime'
            ? capabilityCopy.title
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
    activeTab === 'image' ? imageSettingsState.busy :
    activeSection === 'platform' && activeTab === 'general'
      ? false
      : activeTab === 'runtime'
        ? isSavingRuntimeSettings
        : activeTab === 'skills'
            ? false
            : activeTab === 'invitations'
              ? isSavingInvitations
              : activeTab === 'projects'
                ? false
                : activeTab === 'credit'
                  ? false
                  : isSaving;
  const hasGeneralSaveAction = false;
  const isSaveDisabled =
    activeTab === 'image' ? imageSettingsState.busy || !imageSettingsState.canSave :
    activeSection === 'platform' && activeTab === 'general'
      ? !hasGeneralSaveAction || isSavingCurrentTab
      : activeTab === 'runtime'
        ? isSavingCurrentTab
        : activeTab === 'skills'
            ? true
            : activeTab === 'invitations'
              ? isSavingCurrentTab
              : activeTab === 'projects'
                ? true
                : activeTab === 'credit'
                  ? true
                  : isSavingCurrentTab || !authMethods.length || !model.trim() || !goModelsComplete || (!selectedModelConfigId && authMethods.includes('platform') && !apiKey.trim());

  const handleSaveSettings = async () => {
    if (activeSection !== 'platform') return;
    if (activeTab === 'model') {
      const saved = await handleSaveModelConfig();
      if (saved) { setModelAction(null); setActiveModelPopoverId(null); }
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
    if (activeTab === 'image') {
      if (await imageSettingsRef.current?.save()) onClose();
      return;
    }
    if (activeTab === 'skills') return;
    if (activeTab === 'projects') return;
    if (activeTab === 'credit') return;
    onClose();
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
      showError(billingCopy.positiveCreditsRequired);
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
      showError(error instanceof Error ? error.message : billingCopy.packSaveFailed);
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
    if (!effectiveCanManageMcp && activeSection === 'mcp') {
      setActiveSection('personal');
      setActiveTab('general');
      return;
    }
    if (activeSection === 'platform' && !platformTabs.some(tab => tab.id === activeTab)) {
      setActiveTab(platformTabs[0]?.id ?? 'general');
    }
  }, [activeSection, activeTab, effectiveCanManageSkills, effectiveCanManageMcp, hasPlatformSettings, platformTabs]);

  const modelConfigEditor = (
    <>
      <ModelConfigPanel
        language={lang}
        onGoModelsReady={setGoModelsReady}
        enableOpenCodeGo
        labels={{
          provider: text.provider,
          protocol: lang.startsWith('zh') ? '协议' : 'Protocol',
          baseUrl: text.baseUrl,
          apiKey: text.apiKey,
          model: text.model,
        }}
        provider={provider}
        apiProtocol={apiProtocol}
        onApiProtocolChange={setApiProtocol}
        baseUrl={baseUrl}
        apiKey={apiKey}
        model={model}
        apiKeyPreview={apiKeyPreview}
        savedPrefix={savedPrefix}
        onProviderChange={value => { setProvider(value); setAuthMethods(current => current.filter(method => method === 'platform' || method === 'byok')); }}
        onBaseUrlChange={setBaseUrl}
        onApiKeyChange={setApiKey}
        onModelChange={setModel}
        onSubmit={event => {
          event.preventDefault();
          if (!isSaveDisabled) void handleSaveSettings();
        }}
      />
      <div className="space-y-1 border-t border-border pt-4">
        <div className="flex min-h-11 items-center justify-between gap-4 text-sm">
          <span>{lang.startsWith('zh') ? '向普通用户发布' : 'Publish to users'}</span>
          <Switch checked={published} onCheckedChange={setPublished} ariaLabel={lang.startsWith('zh') ? '向普通用户发布' : 'Publish to users'} size="sm" />
        </div>
        <div className="flex min-h-11 items-center justify-between gap-4 text-sm">
          <span>{lang.startsWith('zh') ? '平台默认模型' : 'Platform default model'}</span>
          <Switch checked={isDefault} onCheckedChange={setIsDefault} ariaLabel={lang.startsWith('zh') ? '平台默认模型' : 'Platform default model'} size="sm" />
        </div>
        <fieldset className="border-t border-border pt-3">
          <legend className="text-sm text-muted-foreground">{lang.startsWith('zh') ? '允许的接入方式' : 'Allowed authentication methods'}</legend>
          {(['platform', 'byok', ...(goProfile ? [] : provider === 'openai-compatible' ? ['chatgpt-subscription'] : [])] as ModelAuthMethod[]).map(method => {
            const label = method === 'platform' ? (lang.startsWith('zh') ? '平台凭据' : 'Platform credentials') : method === 'byok' ? 'BYOK' : 'ChatGPT subscription';
            return <div key={method} className="flex min-h-11 items-center justify-between gap-4 text-sm">
              <span>{label}</span>
              <Switch checked={authMethods.includes(method)} onCheckedChange={checked => setAuthMethods(current => checked ? [...current, method] : current.filter(item => item !== method))} ariaLabel={label} size="sm" />
            </div>;
          })}
        </fieldset>
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <button type="button" disabled={isSaving} onClick={closeModelConfig} className="rounded-lg px-3 py-2 text-sm text-muted-foreground disabled:opacity-50">{lang.startsWith('zh') ? '取消' : 'Cancel'}</button>
        <button type="button" disabled={isSaveDisabled} onClick={() => void handleSaveSettings()} className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{isSaving ? text.saving : text.saveSettings}</button>
      </div>
    </>
  );
  const modelActionTitle = modelAction === 'create' ? (lang.startsWith('zh') ? '添加模型配置' : 'Add model configuration')
    : modelAction === 'details' ? (lang.startsWith('zh') ? '模型详情' : 'Model details')
      : modelAction === 'rename' ? (lang.startsWith('zh') ? '编辑名称' : 'Edit name')
        : (lang.startsWith('zh') ? '删除模型配置' : 'Delete model configuration');
  const modelActionContent = modelAction ? (
    <div data-testid="model-config-popover" className="max-h-[min(560px,calc(100dvh-2rem))] overflow-y-auto p-5 text-popover-foreground">
      <h3 className="mb-3 text-lg font-semibold">{modelActionTitle}</h3>
      {modelAction === 'delete' ? <p className="text-sm text-muted-foreground">{lang.startsWith('zh') ? `确认删除平台模型「${name}」？使用此配置的用户和后续任务将无法继续使用它。此操作不会删除项目。` : `Delete platform model “${name}”? Users and future tasks using this configuration will lose access to it. Projects will not be deleted.`}</p> : null}
      {modelAction === 'rename' ? <form className="mt-4" onSubmit={event => { event.preventDefault(); if (!isSaving) void handleModelListAction(); }}>
        <input autoFocus aria-label={lang.startsWith('zh') ? '模型显示名称' : 'Model display name'} maxLength={100} value={name} onChange={event => setName(event.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" />
      </form> : null}
      {modelAction === 'create' || modelAction === 'details' ? modelConfigEditor : null}
      {modelAction === 'rename' || modelAction === 'delete' ? <>
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" disabled={isSaving} onClick={closeModelConfig} className="rounded-lg px-3 py-2 text-sm text-muted-foreground disabled:opacity-50">{lang.startsWith('zh') ? '取消' : 'Cancel'}</button>
          <button type="button" disabled={isSaving || (modelAction === 'rename' && !name.trim())} onClick={() => void handleModelListAction()} className={`${modelAction === 'delete' ? 'rounded-lg' : 'rounded-full'} bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50`}>{isSaving ? text.saving : modelAction === 'delete' ? (lang.startsWith('zh') ? '删除' : 'Delete') : text.saveSettings}</button>
        </div>
      </> : null}
    </div>
  ) : null;

  return (
    <Dialog open={isOpen} onOpenChange={open => { if (!open && !modelAction && !activeModelPopoverId) onClose(); }}>
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
              <CloseIconButton label={text.closeSettings} onClick={onClose} />
            </div>
            <Tabs value={activeSection} onValueChange={value => { setActiveSection(value as typeof activeSection); setActiveTab('general'); }}>
            <TabsList className="flex h-auto gap-1.5 overflow-x-auto border-0 pb-1 sm:block sm:space-y-1.5 sm:overflow-visible sm:pb-0" aria-label={t.systemSettings}>
              {sectionTabs.map(tab => {
                const Icon = tab.icon;
                return (
                  <TabsTrigger
                    key={tab.id}
                    value={tab.id}
                    className="flex h-9 min-w-max items-center justify-start gap-2 rounded-lg px-3 text-left text-sm data-[active]:bg-accent sm:w-full"
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
            </Tabs>
            {activeSection === 'platform' ? (
                <div className="mt-2 border-t border-border pt-2 sm:mt-4 sm:pt-3">
                <div className="type-caption-1 mb-2 px-3 text-muted-foreground">{adminCopy.platform}</div>
                <Tabs value={activeTab} onValueChange={value => setActiveTab(value as typeof activeTab)}>
                <TabsList className="flex h-auto gap-1.5 overflow-x-auto border-0 pb-1 sm:block sm:space-y-1.5 sm:overflow-visible sm:pb-0" aria-label={adminCopy.platform}>
                  {platformTabs.map(tab => {
                    const Icon = tab.icon;
                    return (
                      <TabsTrigger
                        key={tab.id}
                        value={tab.id}
                        className="flex h-9 min-w-max items-center justify-start gap-2 rounded-lg px-3 text-left text-sm data-[active]:bg-accent sm:w-full"
                      >
                        <Icon className="h-4 w-4" />
                        {tab.label}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
                </Tabs>
              </div>
            ) : null}
          </aside>

          <main data-testid="settings-modal-content" className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <fieldset disabled={isLoadingCurrentSection} aria-busy={isLoadingCurrentSection} className="contents">
            <header className={`shrink-0 px-6 ${activeSection === 'mcp' ? 'pb-5 pt-6' : 'pb-3 pt-5'}`}>
              <div className="flex items-end justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">
                    {activeSection === 'platform'
                      ? adminCopy.platform
                      : activeSection === 'skills'
                        ? userSkillsCopy.tab
                        : t.systemSettings}
                  </div>
                  <h2 className={`mt-2 font-semibold text-foreground ${activeSection === 'mcp' ? 'text-2xl tracking-tight' : 'text-xl'}`}>{activeTabLabel}</h2>
                </div>
                {activeSection === 'platform' && activeTab === 'model' && effectiveCanManageModelConfig ? (
                  <MorphPopover open={modelAction === 'create'} onOpenChange={open => open ? openModelConfig('create') : closeModelConfig()}>
                    <MorphPopoverTrigger>
                      <button type="button" aria-label={lang.startsWith('zh') ? '添加模型配置' : 'Add model configuration'} title={lang.startsWith('zh') ? '添加模型配置' : 'Add model configuration'} disabled={modelsLoading || isSaving} className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-transparent text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                        <Plus className="size-5" />
                      </button>
                    </MorphPopoverTrigger>
                    <MorphPopoverContent side="bottom" align="end" ariaLabel={modelActionTitle} onOpenAutoFocus={content => content.focus()} className="w-[min(480px,calc(100vw-2rem))] rounded-xl border-border bg-popover shadow-xl">
                      {modelAction === 'create' ? modelActionContent : null}
                    </MorphPopoverContent>
                  </MorphPopover>
                ) : null}
                {activeSection === 'mcp' && effectiveCanManageMcp ? (
                  <div className="relative">
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
                      className="inline-flex size-9 items-center justify-center rounded-full border border-border bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Plus className="size-5" />
                    </button>
                    {isMcpActionMenuOpen ? (
                      <>
                        <div className="fixed inset-0 z-[250]" onMouseDown={() => setIsMcpActionMenuOpen(false)} />
                        <div
                          role="menu"
                          className="absolute right-0 top-12 z-[260] w-56 overflow-hidden rounded-lg border border-border bg-background p-1.5 shadow-lg"
                          onMouseDown={event => event.stopPropagation()}
                        >
                          {canDiscoverHostMcp ? <button
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
                          </button> : null}
                          {canDiscoverHostMcp ? <div className="my-1 h-px bg-border" /> : null}
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
                  <div className="shrink-0">
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
                      className="inline-flex size-9 items-center justify-center rounded-full bg-transparent text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <FaPlus className="size-5" />
                    </button>
                  </div>
                ) : null}
              </div>
            </header>

            {activeSection !== 'mcp' ? <div className="mx-6 h-px shrink-0 bg-border" /> : null}

            <motion.div
              key={`${activeSection}-${activeTab}`}
              data-testid="settings-modal-scroll-area"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.16, ease: EASE_OUT }}
              className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-2 ${activeSection === 'mcp' || activeSection === 'connections' || activeSection === 'skills' ? 'flex flex-col' : ''}`}
            >
              {activeSection === 'personal' && activeTab === 'general' ? (
                <div className="divide-y divide-border">
                  <div className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center">
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Globe className="h-4 w-4 text-muted-foreground" />
                      {t.language}
                    </span>
                    <ProjectSelect ariaLabel={t.language} value={lang} onValueChange={value => onSetLang(value as Language)} options={LANGUAGE_OPTIONS.map(option => ({ value: option.code, label: option.label }))} className="w-full" triggerClassName="h-10 rounded-lg type-input min-[900px]:text-md" />
                  </div>
                  <div className="grid min-h-16 gap-3 py-3 sm:grid-cols-[10.5rem_1fr] sm:items-center">
                    <span className="text-sm font-medium text-foreground">{t.theme}</span>
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
                      <span className="text-sm text-muted-foreground">{isDark ? t.darkMode : t.lightMode}</span>
                      <Switch checked={isDark} aria-label={t.theme} onCheckedChange={() => toggleTheme()} />
                    </div>
                  </div>
                </div>
              ) : null}

              {activeSection === 'personal' && currentUser ? <BgsSettingsPanel key={currentUser.id} language={lang} /> : null}
              {activeSection === 'connections' && currentUser ? <ModelConnectionsPanel key={currentUser.id} ref={modelConnectionsRef} language={lang} onSaveStateChange={setModelConnectionSaveState} /> : null}
              {activeSection === 'image-connection' && currentUser ? <PersonalImageConnectionPanel key={currentUser.id} ref={imageConnectionRef} language={lang} onSaveStateChange={setImageConnectionSaveState} /> : null}

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
                <>
                {currentUser?.role === 'owner' && <section aria-label={lang.startsWith('zh') ? '管理员 ChatGPT 订阅' : 'Administrator ChatGPT subscription'} className="border-b border-border py-3">
                  <h3 className="text-sm font-medium">{lang.startsWith('zh') ? '管理员 ChatGPT 订阅' : 'Administrator ChatGPT subscription'}</h3>
                  <p className="mt-2 text-xs text-muted-foreground">{lang.startsWith('zh') ? '与模型连接、生图服务共用同一份账户授权，无需重复登录。登录仅授权；模型及生图的启用、默认选择与计费仍分别配置。' : 'Shares the same account authorization with Model connections and Image service; no second sign-in is needed. Signing in does not change model or image activation, defaults, or billing settings.'}</p>
                  <ModelConnectionsPanel key={currentUser.id} language={lang} chatgptAuthorizationOnly />
                </section>}
                {modelsLoading ? <p role="status" className="py-5 text-sm text-muted-foreground">{lang.startsWith('zh') ? '加载中…' : 'Loading…'}</p> : !existingConfigs.length && !status ? <p className="py-5 text-sm text-muted-foreground">{lang.startsWith('zh') ? '暂无模型配置，点击右上角 + 添加。' : 'No model configurations. Use + to add one.'}</p> : null}
                <ul aria-label={lang.startsWith('zh') ? '模型配置列表' : 'Model configurations'} className="divide-y divide-border">
                  {existingConfigs.map(config => <li key={config.id} className="flex min-h-16 items-center gap-3 py-3">
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium" title={config.name}>{config.name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{config.provider}{config.isDefault ? (lang.startsWith('zh') ? ' · 默认' : ' · Default') : ''}{config.published === false ? (lang.startsWith('zh') ? ' · 未发布' : ' · Unpublished') : ''}</p></div>
                    <MorphPopover
                      open={activeModelPopoverId === config.id}
                      onOpenChange={open => {
                        if (open) { setActiveModelPopoverId(config.id); setModelAction(null); setStatus(''); }
                        else closeModelConfig();
                      }}
                    >
                      <MorphPopoverTrigger>
                        <button type="button" aria-label={`${config.name} ${lang.startsWith('zh') ? '操作' : 'actions'}`} disabled={isSaving} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setActiveModelPopoverId(config.id); setModelAction(null); } }} className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-transparent text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"><MoreHorizontal className="size-5" /></button>
                      </MorphPopoverTrigger>
                      <MorphPopoverContent key={modelAction && selectedModelConfigId === config.id ? modelAction : 'menu'} side="bottom" align="end" ariaLabel={modelAction && selectedModelConfigId === config.id ? modelActionTitle : `${config.name} ${lang.startsWith('zh') ? '操作' : 'actions'}`} onOpenAutoFocus={content => content.focus()} className={`${modelAction && selectedModelConfigId === config.id ? 'w-[min(480px,calc(100vw-2rem))]' : 'w-44'} rounded-xl border-border bg-popover shadow-xl`}>
                        {modelAction && selectedModelConfigId === config.id ? modelActionContent : <div role="menu" aria-label={`${config.name} ${lang.startsWith('zh') ? '操作' : 'actions'}`} className="p-1">
                          <button type="button" role="menuitem" onClick={() => openModelConfig('rename', config)} className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent"><Pencil className="size-4" />{lang.startsWith('zh') ? '编辑名称' : 'Edit name'}</button>
                          <button type="button" role="menuitem" onClick={() => openModelConfig('details', config)} className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent"><Info className="size-4" />{lang.startsWith('zh') ? '详情' : 'Details'}</button>
                          <button type="button" role="menuitem" onClick={() => openModelConfig('delete', config)} className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-destructive hover:bg-accent"><Trash2 className="size-4" />{lang.startsWith('zh') ? '删除' : 'Delete'}</button>
                        </div>}
                      </MorphPopoverContent>
                    </MorphPopover>
                  </li>)}
                </ul>
                </>
              ) : null}

              {activeSection === 'platform' && activeTab === 'image' && effectiveCanManageModelConfig ? (
                <ImageGenerationSettingsPanel ref={imageSettingsRef} language={lang} onStateChange={setImageSettingsState} onSaved={onClose} onOpenModelConnections={() => { setActiveSection('platform'); setActiveTab('model'); }} />
              ) : null}
              {activeSection === 'platform' && activeTab === 'model' && !modelAction && status ? (
                <p role="status" className="mt-3 text-sm text-destructive">{status}</p>
              ) : null}

              {activeSection === 'mcp' && effectiveCanManageMcp ? (
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
            </motion.div>
            {(activeSection === 'image-connection' || activeSection === 'connections' && modelConnectionSaveState.visible || activeSection === 'platform' &&
            activeTab !== 'model' &&
            activeTab !== 'projects' &&
            activeTab !== 'credit' &&
            (activeTab !== 'general' || hasGeneralSaveAction)) ? (
              <div className="flex items-center justify-end border-t border-border bg-muted/30 px-6 py-4">
                <button
                  type="button"
                  aria-label={text.saveSettings}
                  onClick={activeSection === 'image-connection' ? () => void imageConnectionRef.current?.save() : activeSection === 'connections' ? () => modelConnectionsRef.current?.saveByok() : handleSaveSettings}
                  disabled={activeSection === 'image-connection' ? imageConnectionSaveState.disabled : activeSection === 'connections' ? modelConnectionSaveState.disabled : isSaveDisabled}
                  className="rounded-full border border-transparent bg-primary text-primary-foreground inline-flex h-11 items-center px-6 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {activeSection === 'image-connection' ? imageConnectionSaveState.busy ? text.saving : text.saveSettings : activeSection === 'connections' ? modelConnectionSaveState.busy ? text.saving : text.saveSettings : isSavingCurrentTab ? text.saving : text.saveSettings}
                </button>
              </div>
            ) : null}
            </fieldset>
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatModelConfigError(error: unknown, text: Record<string, string>): string {
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
  return { resourceLibraryEnabled: config.resourceLibraryEnabled ?? true };
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
