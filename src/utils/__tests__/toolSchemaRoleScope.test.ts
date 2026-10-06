import { expect, test } from 'bun:test'
import { FileWriteTool } from '@bee-game-studio/builtin-tools/tools/FileWriteTool/FileWriteTool.js'
import { toolToAPISchema } from '../api.js'
import { clearToolSchemaCache } from '../toolSchemaCache.js'

test.each([false, true])('role-specific tool schema is isolated in either render order, roleFirst=%s', async roleFirst => {
  clearToolSchemaCache()
  const generic = { ...FileWriteTool, prompt: async () => 'GENERIC_METHOD' }
  const role = { ...generic, apiSchemaCacheScope: 'offline-bounded-role', prompt: async () => 'ROLE_METHOD' }
  const schema = (tool: typeof generic) => toolToAPISchema(tool, {
    getToolPermissionContext: async () => ({}) as never, tools: [tool], agents: [],
  })
  try {
    const first = await schema(roleFirst ? role : generic)
    const second = await schema(roleFirst ? generic : role)
    expect(first).toHaveProperty('description', roleFirst ? 'ROLE_METHOD' : 'GENERIC_METHOD')
    expect(second).toHaveProperty('description', roleFirst ? 'GENERIC_METHOD' : 'ROLE_METHOD')
    expect(first).toHaveProperty('name', FileWriteTool.name)
    expect(second).toHaveProperty('name', FileWriteTool.name)
    // Prompt drift still does not churn either session-stable schema.
    expect(await schema({ ...role, prompt: async () => 'LATE_ROLE_DRIFT' })).toHaveProperty('description', 'ROLE_METHOD')
    expect(await schema({ ...generic, prompt: async () => 'LATE_GENERIC_DRIFT' })).toHaveProperty('description', 'GENERIC_METHOD')
  } finally { clearToolSchemaCache() }
})
