import test from 'node:test';
import assert from 'node:assert/strict';
import { publicConfiguration } from '../lib/config.js';
import { createPublicClient } from '../lib/supabase.js';

test('public configuration rejects private keys and incomplete settings', () => {
  assert.equal(publicConfiguration(), null);
  assert.equal(publicConfiguration('https://YOUR_PROJECT.supabase.co', 'sb_publishable_YOUR_PUBLIC_KEY'), null);
  for (const key of ['sb_secret_example', 'eyJhbGciOiJIUzI1NiJ9.example', undefined]) {
    assert.throws(() => publicConfiguration('https://example.supabase.co', key));
  }
  assert.throws(() => publicConfiguration('http://example.com', 'sb_publishable_test'));
  assert.ok(publicConfiguration('http://127.0.0.1:54321', 'sb_publishable_test'));
});

test('public client has no Auth client and cannot reuse a stored account session', async () => {
  const db = createPublicClient('https://example.supabase.co', 'sb_publishable_test');
  assert.throws(() => db.auth.getSession(), /accessToken option/);
  assert.equal(await db.realtime.accessToken(), 'sb_publishable_test');
  await db.removeAllChannels();
});
