// The Portal uses the exact BGS Auth client and Supabase user IDs. Its browser
// session is scoped to the Portal origin; desktop/web BGS sessions stay intact.
export {
  initializeSupabaseSession,
  getSupabaseSessionUser,
  signInWithSupabasePassword,
  signInWithSupabaseOAuth,
  clearSupabaseSession,
} from '../../frontend/src/services/supabaseAuthApi'
