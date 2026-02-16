import { createClient } from '@supabase/supabase-js'
import { hashApiKey } from './api-keys'

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: 'feedback_chat' } },
  )
}

/** Validate an API key and return the project_id it belongs to, or null. */
export async function validateApiKey(key: string): Promise<string | null> {
  const hash = hashApiKey(key)
  const supabase = supabaseAdmin()
  const { data } = await supabase
    .from('api_keys')
    .select('project_id')
    .eq('key_hash', hash)
    .single()

  return data?.project_id ?? null
}
