import { createClient } from '@supabase/supabase-js';
import { publicConfiguration } from './config.js';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
// No Auth client, session storage, refresh tokens, or callback URL processing.
// Always use the publishable key's anon role, even on a previously signed-in device.
export function createPublicClient(url, key) {
  const config = publicConfiguration(url, key);
  if (!config) throw new Error('Supabase public configuration is required.');
  return createClient(config.url, config.key, { accessToken: async () => null });
}
const config = publicConfiguration(url, key);
export const supabase = config ? createPublicClient(config.url, config.key) : null;
