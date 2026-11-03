import test from 'node:test';
import assert from 'node:assert/strict';
import { todayInNewYork } from '../lib/date.js';
import { latestRate, ntd } from '../lib/exchange.js';
test('New York date respects midnight and daylight saving boundaries', () => {
 assert.equal(todayInNewYork(new Date('2026-11-03T04:59:59Z')), '2026-11-02');
 assert.equal(todayInNewYork(new Date('2026-11-03T05:00:00Z')), '2026-11-03');
 assert.equal(todayInNewYork(new Date('2026-07-03T04:00:00Z')), '2026-07-03');
 assert.equal(ntd(2550, 32.1), 'NT$818.55');
});
test('rate parser rejects invalid currency and values', async () => {
 const original = globalThis.fetch;
 try {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ base:'USD',quote:'TWD',rate:32.1,date:'2026-11-03' }) });
  assert.equal((await latestRate()).rate, 32.1);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ base:'USD',quote:'EUR',rate:-1,date:'2026-11-03' }) });
  await assert.rejects(latestRate(), /Invalid/);
 } finally { globalThis.fetch = original; }
});
