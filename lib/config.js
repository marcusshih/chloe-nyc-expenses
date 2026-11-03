export function publicConfiguration(url, key) {
  const missingURL = !url || url.includes('YOUR_PROJECT');
  const missingKey = !key || key.includes('YOUR_');
  if (missingURL && missingKey) return null;
  if (missingURL || missingKey) throw new Error('Set both NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
  if (!key.startsWith('sb_publishable_')) throw new Error('Use a Supabase public publishable key (sb_publishable_…), never a secret or service-role key.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
    throw new Error('Use an HTTPS Supabase URL (HTTP is allowed only for local development).');
  }
  return { url, key };
}
