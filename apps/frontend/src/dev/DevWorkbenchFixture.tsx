import { useEffect, useMemo, useState } from 'react';
import { BeeGameLivePreviewPage } from '../components/Demiurge/BeeGameLivePreviewPage';
import { RightSidebar } from '../components/Demiurge/RightSidebar';
import { api, type ChatAttachmentPayload } from '../services/api';
import {
  resourceLibraryApi,
  type ResourceElement,
  type ResourceFolder,
  type ResourcePackSummary,
} from '../services/resourceLibraryApi';
import { applyThemeToDocument, useSystemStore } from '../store/systemStore';
import type { ChatDisplayMessage, ProjectRuntimeDisplayModel } from '../viewModels/displayModels';
import { toChatDisplayMessages } from '../viewModels/displayModels';
import { normalizeChatHistory } from '../utils/chatHistory';
import { transcriptEventsToHistory } from '../services/beeGameAdapter';
import type { Language } from '../components/Demiurge/AgentsConfig';
import type { WaitingPermissionState } from '../utils/waitingPermission';
import canonicalTranscriptEvents from './fixtures/canonicalTranscriptEvents.json';

const PROJECT_ID = 'night-courtyard-crystal-shockwave';
const IMPLEMENTATION_TIMESTAMP = Date.parse('2026-09-15T02:16:03.172Z');

const FIXTURE_ASSET_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// The fixture is a sanitized canonical transcript response. The production adapter
// and history normalizer, rather than this fixture, create ChatDisplayMessage values.
// eslint-disable-next-line react-refresh/only-export-components -- static fixture data is intentionally exported for tests
export const sampleMessages: ChatDisplayMessage[] = toChatDisplayMessages(normalizeChatHistory(
  transcriptEventsToHistory(PROJECT_ID, canonicalTranscriptEvents),
));

const waitingPermission: WaitingPermissionState = {
  kind: 'none',
  isWaitingStatus: false,
  isBlockingChat: false,
  message: '',
  placeholder: 'Ask team (Shift+Enter to new line)...',
};

const fixtureProjectStatus: ProjectRuntimeDisplayModel = {
  project_id: PROJECT_ID,
  phase: 'IMPLEMENTATION',
};

const fixtureArtifacts: Awaited<ReturnType<typeof api.getArtifacts>> = [
  {
    artifact_id: 'fixture-artifact-gdd',
    id: 'fixture-artifact-gdd',
    name: 'docs/ART_DIRECTION.md',
    path: 'docs/ART_DIRECTION.md',
    artifact_type: 'document',
    status: 'active',
    created_by: 'beegame',
    created_at: new Date(IMPLEMENTATION_TIMESTAMP).toISOString(),
  },
  {
    artifact_id: 'fixture-artifact-scene',
    id: 'fixture-artifact-scene',
    name: 'src/components/ShockwaveCanvas.tsx',
    path: 'src/components/ShockwaveCanvas.tsx',
    artifact_type: 'source',
    status: 'active',
    created_by: 'beegame',
    created_at: new Date(IMPLEMENTATION_TIMESTAMP).toISOString(),
  },
  {
    artifact_id: 'fixture-artifact-package',
    id: 'fixture-artifact-package',
    name: 'night-courtyard-crystal-shockwave.zip',
    artifact_type: 'package',
    status: 'active',
    created_by: 'beegame',
    created_at: new Date(IMPLEMENTATION_TIMESTAMP).toISOString(),
    package_download: true,
  },
];

const fixtureArtifactContent: Record<string, string> = {
  'fixture-artifact-gdd':
    '# Night Courtyard\n\n技术验收场景：夜色庭院与可点击水晶冲击波。',
  'fixture-artifact-scene':
    'export function ShockwaveCanvas() {\n  return <canvas aria-label="Crystal shockwave" />;\n}',
};

const fixturePack: ResourcePackSummary = {
  id: 'fixture-resource-pack',
  name: 'Night Courtyard technical kit',
  styles: ['Cold restrained fantasy', 'Additive magic light'],
  gameTypes: ['Technical acceptance', 'Web scene'],
  dimension: '2D',
  primaryCategory: 'world-scene',
  categories: ['background', 'ui'],
  license: 'CC0 / original SVG',
  version: '1.0.0',
  status: 'published',
  description: 'Read-only resource library data for the Night Courtyard acceptance scene.',
  tags: ['night-courtyard', 'crystal', 'shockwave'],
  source: 'Fixture data',
  author: 'BeeGame Studio',
  elementCount: 1,
};

const fixtureElement: ResourceElement = {
  id: 'fixture-resource-element',
  packId: fixturePack.id,
  name: 'night-courtyard.webp',
  path: 'assets/runtime/night-courtyard.webp',
  category: 'background',
  kind: 'image',
  specs: { width: 1920, height: 1080, format: 'webp', previewStatus: 'ready' },
  dependencies: [],
  status: 'ready',
};

const fixtureFolder: ResourceFolder = {
  id: 'fixture-resource-folder',
  packId: fixturePack.id,
  name: 'runtime',
  path: 'assets/runtime',
};

export function DevWorkbenchFixture() {
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const explicitFixturePreview = query.get('preview') === 'live';
  const [previewLive, setPreviewLive] = useState(explicitFixturePreview);
  const isDark = useSystemStore((state) => state.isDark);
  const [lang, setLang] = useState<Language>('en');
  const [messages, setMessages] = useState(sampleMessages);
  const [isLoading, setIsLoading] = useState(false);
  const [fixtureReady, setFixtureReady] = useState(false);
  const requestedTheme = query.get('theme');

  useEffect(() => {
    const requestedIsDark =
      requestedTheme === 'dark' ? true : requestedTheme === 'light' ? false : null;
    if (requestedIsDark === null) return;
    useSystemStore.getState().setTheme(requestedIsDark);
  }, [requestedTheme]);

  useEffect(() => {
    applyThemeToDocument(isDark);
  }, [isDark]);

  useEffect(() => {
    const originalGetArtifacts = api.getArtifacts;
    const originalGetArtifactContent = api.getArtifactContent;
    const originalListPacks = resourceLibraryApi.listPacks;
    const originalGetPack = resourceLibraryApi.getPack;
    const originalListFolders = resourceLibraryApi.listFolders;
    const originalListElements = resourceLibraryApi.listElements;
    const originalGetLatestProcessingJob = resourceLibraryApi.getLatestProcessingJob;
    const originalGetLatestSemanticCurationJob = resourceLibraryApi.getLatestSemanticCurationJob;
    const originalGetCurationQueue = resourceLibraryApi.getCurationQueue;
    const originalGetElementResourceUrl = resourceLibraryApi.getElementResourceUrl;
    const originalCurrentUser = useSystemStore.getState().currentUser;
    if (query.get('view') === 'resources') {
      const url = new URL(window.location.href);
      url.searchParams.set('resourceLibrary', '1');
      window.history.replaceState({ resourceLibrary: true }, '', url);
    }
    if (!originalCurrentUser) {
      useSystemStore.setState({
        currentUser: {
          id: 'fixture-reviewer',
          role: 'owner',
          email: 'reviewer@example.test',
          displayName: 'Visual reviewer',
          permissions: ['resources.manage', 'workspace.read', 'project.read'],
        },
      });
    }
    api.getArtifacts = async () => fixtureArtifacts;
    api.getArtifactContent = async (artifactId: string) =>
      fixtureArtifactContent[artifactId] || 'Fixture artifact has no text preview.';
    resourceLibraryApi.listPacks = async () => [fixturePack];
    resourceLibraryApi.getPack = async () => fixturePack;
    resourceLibraryApi.listFolders = async () => [fixtureFolder];
    resourceLibraryApi.listElements = async () => [fixtureElement];
    resourceLibraryApi.getLatestProcessingJob = async () => undefined;
    resourceLibraryApi.getLatestSemanticCurationJob = async () => undefined;
    resourceLibraryApi.getCurationQueue = async () => ({
      items: [],
      counts: { pendingItems: 0, missingSemanticTags: 0, technicalIssues: 0, dependencyIssues: 0 },
      usageTagOptions: [],
    });
    resourceLibraryApi.getElementResourceUrl = async () => FIXTURE_ASSET_URL;
    // Do not mount production panels until their read-only fixture data is installed.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- this gate prevents child requests before the fixture patch is installed.
    setFixtureReady(true);
    return () => {
      api.getArtifacts = originalGetArtifacts;
      api.getArtifactContent = originalGetArtifactContent;
      resourceLibraryApi.listPacks = originalListPacks;
      resourceLibraryApi.getPack = originalGetPack;
      resourceLibraryApi.listFolders = originalListFolders;
      resourceLibraryApi.listElements = originalListElements;
      resourceLibraryApi.getLatestProcessingJob = originalGetLatestProcessingJob;
      resourceLibraryApi.getLatestSemanticCurationJob = originalGetLatestSemanticCurationJob;
      resourceLibraryApi.getCurationQueue = originalGetCurationQueue;
      resourceLibraryApi.getElementResourceUrl = originalGetElementResourceUrl;
      if (!originalCurrentUser) useSystemStore.setState({ currentUser: null });
    };
  }, [query]);
  const buildReport = useMemo(
    () =>
      explicitFixturePreview && previewLive
        ? {
            status: 'completed',
            build_url: `${window.location.origin}/dev-preview-fixture.html`,
            summary: 'Fixture uses the sandboxed same-origin static preview page.',
            agents: ['BeeGame'],
            generated_paths: ['src/components/ShockwaveCanvas.tsx'],
            checks: [{ name: 'Preview', status: 'passed', detail: 'Renderer available' }],
          }
        : null,
    [explicitFixturePreview, previewLive]
  );
  if (!fixtureReady) return null;

  const visibleMessages = messages;

  const handleSendMessage = async (content: string): Promise<boolean> => {
    setMessages((current) => [
      ...current,
      {
        id: `fixture-user-${current.length + 1}`,
        messageId: `fixture-user-${current.length + 1}`,
        sender: 'user',
        content,
        timestamp: Date.now(),
        type: 'normal',
      },
    ]);
    setIsLoading(false);
    return true;
  };

  return (
    <>
      <BeeGameLivePreviewPage
        lang={lang}
        projectName="Workspace / visual review"
        status={isLoading ? 'running' : 'idle'}
        phaseLabel={isLoading ? 'Generating' : 'Ready for review'}
        isSyncing={false}
        buildReport={buildReport}
        tokenUsage={{
          prompt_tokens: 1840,
          completion_tokens: 920,
          input_tokens: 1840,
          output_tokens: 920,
          cache_read_tokens: 640,
          cache_creation_tokens: 0,
          total_tokens: 3400,
        }}
        onSetLang={setLang}
        onDeployProject={() => undefined}
        onStartPreview={() => setPreviewLive(true)}
        onStopPreview={() => setPreviewLive(false)}
        collaboration={
          <RightSidebarFixture
            messages={visibleMessages}
            isLoading={isLoading}
            onSendMessage={handleSendMessage}
          />
        }
      />
    </>
  );
}

function RightSidebarFixture({
  messages,
  isLoading,
  onSendMessage,
}: {
  messages: ChatDisplayMessage[];
  isLoading: boolean;
  onSendMessage: (content: string, attachments?: ChatAttachmentPayload[]) => Promise<boolean>;
}) {
  // Kept in a separate adapter so this fixture passes the production sidebar
  // the same state shape as App without duplicating its rendering.
  return (
    <RightSidebar
      projectId={PROJECT_ID}
      lang="en"
      messages={messages}
      progress={42}
      onSendMessage={onSendMessage}
      isLoading={isLoading}
      waitingPermission={waitingPermission}
      projectStatus={fixtureProjectStatus}
      currentUserDisplayName="Visual reviewer"
      currentUserEmail="reviewer@example.test"
      canSendMessage
    />
  );
}
