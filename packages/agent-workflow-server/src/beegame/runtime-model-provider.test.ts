import { expect, test } from 'bun:test'
import { mergeRuntimeEnv } from './session-manager'

test('selected Responses settings win over inherited configuration', () => {
  expect(mergeRuntimeEnv({modelType:'openai',env:{OPENAI_BASE_URL:'https://selected.example/v1',OPENAI_API_KEY:'selected'}},
    {OPENAI_BASE_URL:'https://inherited.example/v1'})).toMatchObject({BEEGAME_MODEL_TYPE:'openai',OPENAI_BASE_URL:'https://selected.example/v1',OPENAI_API_KEY:'selected'})
})
test('explicit native provider selection remains stable above unrelated inherited settings', () => {
  for (const modelType of ['anthropic','gemini','grok'] as const)
    expect(mergeRuntimeEnv({modelType,env:{}},{OPENAI_API_KEY:'unselected'}).BEEGAME_MODEL_TYPE).toBe(modelType)
  expect(()=>mergeRuntimeEnv(undefined,{BEEGAME_MODEL_TYPE:'unknown'})).toThrow('Unsupported')
})
test('an owner-resolved personal connection beats stale platform credentials', () => {
  expect(mergeRuntimeEnv({modelType:'openai',env:{OPENAI_API_KEY:'platform'}},
    {BGS_MODEL_CONNECTION_RESOLVED:'1',BEEGAME_MODEL_TYPE:'openai',OPENAI_API_KEY:'personal'}).OPENAI_API_KEY).toBe('personal')
})
