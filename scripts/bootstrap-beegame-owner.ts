#!/usr/bin/env bun
import { loadEnvFile } from './beegame-migration-cli'
import {
  parseBootstrapOwnerEmails,
  upsertBootstrapOwnerInvites,
} from './beegame-owner-bootstrap'

loadEnvFile('.env.local')

const url = (
  process.env.BEEGAME_SUPABASE_URL ??
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  ''
).trim()
const serviceRoleKey = (
  process.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  ''
).trim()
const emails = parseBootstrapOwnerEmails(
  process.env.BEEGAME_BOOTSTRAP_OWNER_EMAILS ?? '',
)

await upsertBootstrapOwnerInvites({
  url,
  serviceRoleKey,
  emails,
})

console.log(JSON.stringify({
  ok: true,
  ownerInvites: emails.length,
}, null, 2))
