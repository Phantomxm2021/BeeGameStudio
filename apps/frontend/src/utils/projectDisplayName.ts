/** Display workspace names without the generated identity suffix. Never alter stored IDs. */
export function getProjectDisplayName(project: { name?: string; root_path?: string }, fallback: string): string {
  const folder = String(project.root_path || '').replaceAll('\\', '/').split('/').filter(Boolean).at(-1);
  for (const candidate of [folder, project.name]) {
    const name = String(candidate || '').replace(/--[a-f\d]{8,}$/i, '').trim();
    if (name && !/^(?:project_\d+_[a-z\d]+|proj_[a-f\d-]+|[a-f\d]{8,})$/i.test(name)) return name;
  }
  return fallback;
}
