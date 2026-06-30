type BeeGameFetch = typeof fetch

export function parseBootstrapOwnerEmails(value: string): string[] {
  const seen = new Set<string>()
  const emails: string[] = []
  for (const raw of value.split(',')) {
    const email = raw.trim().toLowerCase()
    if (!email || seen.has(email)) continue
    seen.add(email)
    emails.push(email)
  }
  return emails
}

export async function upsertBootstrapOwnerInvites(input: {
  url: string
  serviceRoleKey: string
  emails: string[]
  fetchImpl?: BeeGameFetch
}): Promise<void> {
  const baseUrl = input.url.replace(/\/+$/, '')
  const emails = input.emails.map(email => email.trim().toLowerCase()).filter(Boolean)
  if (!baseUrl) throw new Error('Supabase URL is required')
  if (!input.serviceRoleKey.trim()) throw new Error('Supabase service role key is required')
  if (emails.length === 0) throw new Error('At least one bootstrap owner email is required')

  const response = await (input.fetchImpl ?? fetch)(
    `${baseUrl}/rest/v1/beegame_platform_owner_invites`,
    {
      method: 'POST',
      headers: {
        apikey: input.serviceRoleKey,
        authorization: `Bearer ${input.serviceRoleKey}`,
        'content-type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(emails.map(email => ({ email }))),
    },
  )
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(
      `Bootstrap owner invite upsert failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`,
    )
  }
}
