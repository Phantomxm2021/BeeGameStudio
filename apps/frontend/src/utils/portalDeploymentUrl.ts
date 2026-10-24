/** Use the release record ID: rollback records can point at an earlier version's files. */
export function portalDeploymentUrl(portalOrigin: string | undefined, gameUrl: string, deploymentId?: string): string {
  if (!portalOrigin?.trim()) return gameUrl;
  try {
    const portal = new URL(portalOrigin);
    const game = new URL(gameUrl);
    if (portal.protocol !== 'https:' || !/^\/deployments\/[A-Za-z0-9_-]+\/files\/index\.html$/.test(game.pathname)) return gameUrl;
    if (deploymentId && !/^[A-Za-z0-9_-]+$/.test(deploymentId)) return gameUrl;
    return new URL(deploymentId ? `/deployments/${deploymentId}/files/index.html` : game.pathname, portal.origin).toString();
  } catch {
    return gameUrl;
  }
}

/** One stable, user-facing link per project; the portal chooses its latest successful release. */
export function portalProjectUrl(portalOrigin: string | undefined, projectId: string, fallbackGameUrl: string): string {
  if (!portalOrigin?.trim() || !projectId.trim()) return fallbackGameUrl;
  try {
    const portal = new URL(portalOrigin);
    if (portal.protocol !== 'https:') return fallbackGameUrl;
    return new URL(`/g/${encodeURIComponent(projectId)}`, portal.origin).toString();
  } catch {
    return fallbackGameUrl;
  }
}
