import { describe, expect, test } from 'bun:test'
import { resolveBeeGameSkillsConfig } from '../config'

describe('BeeGame skills config', () => {
  test('requires user skill synchronization by default in production', () => {
    expect(resolveBeeGameSkillsConfig({
      NODE_ENV: 'production',
      BEEGAME_SKILLS_SERVICE_URL: 'https://skills.example.invalid',
    })).toMatchObject({ required: true })
  })

  test('keeps local development resilient unless strict synchronization is requested', () => {
    expect(resolveBeeGameSkillsConfig({
      NODE_ENV: 'development',
      BEEGAME_SKILLS_SERVICE_URL: 'http://127.0.0.1:62176',
    })).toMatchObject({ required: false })
  })

  test('honors an explicit synchronization policy in every environment', () => {
    expect(resolveBeeGameSkillsConfig({
      NODE_ENV: 'development',
      BEEGAME_SKILLS_REQUIRED: '1',
    })).toMatchObject({ required: true })
    expect(resolveBeeGameSkillsConfig({
      NODE_ENV: 'production',
      BEEGAME_SKILLS_REQUIRED: '0',
    })).toMatchObject({ required: false })
  })
})
