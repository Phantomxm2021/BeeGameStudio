// Artifact identities are shared by chat messages and artifact downloads.
const ARTIFACT_ID_PREFIX = 'beegame-artifact:'

export function toWorkspaceRelativePath(path: string, workspacePath: string): string {
  const normalized = path
    .split('\\')
    .join('/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '')
  const normalizedWorkspace = workspacePath
    .split('\\')
    .join('/')
    .replace(/\/+$/, '')
  if (normalizedWorkspace && normalized.startsWith(`${normalizedWorkspace}/`)) {
    return normalized.slice(normalizedWorkspace.length + 1)
  }
  return normalized
}

export function getArtifactPath(
  toolName: string,
  input: Record<string, unknown>,
): string {
  const normalizedTool = toolName.toLowerCase()
  if (!['write', 'edit', 'multiedit', 'notebookedit'].includes(normalizedTool))
    return ''
  return String(
    input.file_path || input.path || input.notebook_path || '',
  ).trim()
}

export function encodeArtifactId(
  projectId: string,
  sessionId: string | undefined,
  path: string,
): string {
  const encodedProjectId = encodeURIComponent(projectId)
  const encodedPath = encodeURIComponent(path)
  return sessionId
    ? `${ARTIFACT_ID_PREFIX}${encodedProjectId}:${encodeURIComponent(sessionId)}:${encodedPath}`
    : `${ARTIFACT_ID_PREFIX}${encodedProjectId}:${encodedPath}`
}

export function decodeArtifactId(
  artifactId: string,
): { projectId: string; sessionId?: string; path: string } | null {
  if (!artifactId.startsWith(ARTIFACT_ID_PREFIX)) return null
  const parts = artifactId.slice(ARTIFACT_ID_PREFIX.length).split(':')
  if (parts.length === 3) {
    return {
      projectId: decodeURIComponent(parts[0]),
      sessionId: decodeURIComponent(parts[1]),
      path: decodeURIComponent(parts[2]),
    }
  }
  if (parts.length === 2) {
    return {
      projectId: decodeURIComponent(parts[0]),
      path: decodeURIComponent(parts[1]),
    }
  }
  return null
}
