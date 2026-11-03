// Real hosted integration check. Two independent clients, public key only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPublicClient } from '../lib/supabase.js';
import { deleteExpense, listExpenses, saveExpense, subscribeExpenses, TRIP_ID } from '../lib/expenses.js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error('Set the public Supabase URL and publishable key in .env.local first. No private keys are needed.');
const writer = createPublicClient(url, key);
const observer = createPublicClient(url, key);
let id, channel, observed, eventError;
let reads = Promise.resolve();
const marker = `Integration check ${randomUUID()}`;
async function waitFor(predicate, description) {
  const deadline = Date.now() + 15000;
  while (!predicate()) {
    if (eventError) throw eventError;
    if (Date.now() > deadline) throw new Error(`Timed out: ${description}. Check the migration and Realtime publication.`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
try {
  await listExpenses(writer);
  console.log('PASS: public read');
  let subscribed = false;
  channel = subscribeExpenses(observer, () => {
    // Only Realtime events cause this refetch. No polling or focus fallback.
    reads = reads.then(async () => { observed = await listExpenses(observer); }).catch(error => { eventError = error; });
  }, status => {
    if (status === 'SUBSCRIBED') subscribed = true;
    if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) eventError = new Error(`Realtime: ${status}`);
  });
  await waitFor(() => subscribed, 'public Realtime subscription');
  const payload = { title: marker, amount_cents: 5100, expense_date: '2026-11-04', category: 'Other', paid_by: 'Marcus', split_type: 'shared', notes: marker };
  ({ id } = await saveExpense(writer, payload));
  await waitFor(() => observed?.some(e => e.id === id && e.paid_by === 'Marcus'), 'insert on second client');
  console.log('PASS: public insert and Realtime insert synchronization');
  const original = observed.find(e => e.id === id);
  await saveExpense(writer, { ...payload, amount_cents: 5200, paid_by: 'Chloe' }, original);
  await waitFor(() => observed?.some(e => e.id === id && e.amount_cents === 5200 && e.paid_by === 'Chloe'), 'update on second client');
  console.log('PASS: public update and Realtime update synchronization');
  await assert.rejects(saveExpense(writer, payload, original), /changed on another device/);
  console.log('PASS: stale update rejected');
  await deleteExpense(writer, observed.find(e => e.id === id));
  await waitFor(() => observed && !observed.some(e => e.id === id), 'delete on second client');
  id = undefined;
  console.log('PASS: public delete and Realtime delete synchronization');
  for (const table of ['trips', 'trip_members', 'trip_invitations']) {
    const result = await writer.from(table).select('*').limit(1);
    assert.ok(result.error, `${table} must not be public`);
  }
  assert.ok((await writer.from('expenses').select('created_by').limit(1)).error);
  assert.ok((await writer.from('expenses').insert({ ...payload, trip_id: randomUUID() })).error);
  assert.ok((await writer.from('expense_sync').update({ revision: 999 }).eq('trip_id', TRIP_ID)).error);
  console.log('PASS: private columns, legacy tables, foreign trip inserts and sync writes denied');
} finally {
  if (channel) await observer.removeChannel(channel);
  if (id) {
    const { error } = await writer.from('expenses').delete().eq('id', id).eq('notes', marker);
    if (error) { console.error('Test-row cleanup failed; remove the expense with title:', marker); process.exitCode = 1; }
  }
  await writer.removeAllChannels();
  await observer.removeAllChannels();
}
