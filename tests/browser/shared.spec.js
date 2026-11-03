import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { TRIP_ID } from '../../lib/expenses.js';

// Transport fixture, not a hosted Supabase test. PostgreSQL/RLS are tested
// separately by database.test.js; scripts/verify-supabase.mjs checks real Realtime.
async function publicBackend(context, state) {
  await context.route('https://nyc-test.supabase.co/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    expect(url.pathname).toBe('/rest/v1/expenses');
    expect(request.headers().apikey).toBe('sb_publishable_browser_test');
    const project = rows => rows.map(row => Object.fromEntries((url.searchParams.get('select') || 'id').split(',').map(key => [key, row[key]])));
    let matched = state.rows.filter(row => ['id', 'trip_id', 'updated_at'].every(key => !url.searchParams.has(key) || url.searchParams.get(key) === `eq.${row[key]}`));
    if (request.method() === 'GET') {
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Number(url.searchParams.get('limit') || 500);
      await route.fulfill({ json: project(matched.slice(offset, offset + limit)) });
      return;
    }
    if (request.method() === 'POST') {
      const row = { ...request.postDataJSON(), id: randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      expect(row.trip_id).toBe(TRIP_ID);
      expect(row).not.toHaveProperty('created_by');
      state.rows.push(row);
      matched = [row];
    } else if (request.method() === 'PATCH') {
      for (const row of matched) Object.assign(row, request.postDataJSON(), { updated_at: new Date().toISOString() });
    } else if (request.method() === 'DELETE') {
      state.rows = state.rows.filter(row => !matched.includes(row));
    } else throw new Error(`Unexpected method ${request.method()}`);
    await route.fulfill({ json: project(matched) });
    if (matched.length) for (const notify of state.subscribers) notify();
  });
  await context.routeWebSocket('wss://nyc-test.supabase.co/**', ws => {
    let notify;
    ws.onMessage(message => {
      const [joinRef, ref, topic, event, payload] = JSON.parse(String(message));
      if (event === 'phx_join') {
        expect(payload.config.postgres_changes).toEqual([{ event: 'UPDATE', schema: 'public', table: 'expense_sync', filter: `trip_id=eq.${TRIP_ID}` }]);
        ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: payload.config.postgres_changes.map(filter => ({ ...filter, id: 1 })) } }]));
        notify = () => ws.send(JSON.stringify([joinRef, null, topic, 'postgres_changes', { ids: [1], data: {
          schema: 'public', table: 'expense_sync', type: 'UPDATE', commit_timestamp: new Date().toISOString(), errors: null,
          columns: [{ name: 'trip_id', type: 'uuid' }, { name: 'revision', type: 'int8' }],
          record: { trip_id: TRIP_ID, revision: 1 }, old_record: {},
        } }]));
        state.subscribers.add(notify);
      } else if (['heartbeat', 'phx_leave'].includes(event)) {
        ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
      }
    });
    ws.onClose(() => state.subscribers.delete(notify));
  });
}

test('two public browsers add, edit, delete, sync, filter, settle, and export a full backup', async ({ browser }) => {
  const state = { rows: [], subscribers: new Set() };
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    await publicBackend(phone, state);
    await publicBackend(desktop, state);
    const marcus = await phone.newPage(), chloe = await desktop.newPage();
    const errors = [];
    for (const page of [marcus, chloe]) {
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('/');
      await expect(page.getByText('Live sync', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: /sign in|sign up|invite|join trip|sign out/i })).toHaveCount(0);
    }
    await marcus.getByRole('button', { name: 'Add expense', exact: true }).click();
    await marcus.getByLabel('Description').fill('Shared lunch');
    await marcus.getByLabel('Amount (USD)').fill('51.00');
    await expect(marcus.getByLabel('Paid by', { exact: true })).toHaveValue('Marcus');
    await marcus.getByRole('button', { name: 'Save expense' }).click();
    await expect(chloe.getByRole('button', { name: 'Edit Shared lunch, $51.00', exact: true })).toBeVisible({ timeout: 5000 });
    await expect(chloe.getByRole('heading', { name: 'Chloe owes Marcus $25.50' })).toBeVisible();
    await expect(marcus.locator('.total')).toHaveText('$51.00');
    await marcus.screenshot({ path: test.info().outputPath('mobile-populated.png'), fullPage: true });
    await chloe.screenshot({ path: test.info().outputPath('desktop-populated.png'), fullPage: true });

    await chloe.getByRole('button', { name: 'Edit Shared lunch, $51.00', exact: true }).click();
    await chloe.getByLabel('Description').fill('Dinner');
    await chloe.getByLabel('Amount (USD)').fill('52.00');
    await chloe.getByLabel('Paid by', { exact: true }).selectOption({ label: 'Paid by Chloe' });
    await chloe.getByRole('button', { name: 'Save expense' }).click();
    await expect(marcus.getByRole('button', { name: 'Edit Dinner, $52.00', exact: true })).toBeVisible({ timeout: 5000 });
    await expect(marcus.getByRole('heading', { name: 'Marcus owes Chloe $26.00' })).toBeVisible();

    // A stale open form must not overwrite a second device's changes.
    await marcus.getByRole('button', { name: 'Edit Dinner, $52.00', exact: true }).click();
    await chloe.getByRole('button', { name: 'Edit Dinner, $52.00', exact: true }).click();
    await chloe.getByLabel('Notes (optional)').fill('Updated on second device');
    await chloe.getByRole('button', { name: 'Save expense' }).click();
    await expect(marcus.getByText('Updated on second device', { exact: true })).toBeAttached();
    await marcus.getByRole('button', { name: 'Save expense' }).click();
    await expect(marcus.getByRole('dialog').getByRole('alert')).toContainText('changed on another device');
    await marcus.getByRole('button', { name: 'Close dialog' }).click();

    // Filtering changes the list; totals and the backup still include all rows.
    await marcus.getByLabel('Category', { exact: true }).selectOption('Transportation');
    await expect(marcus.getByText('No expenses match these filters.')).toBeVisible();
    await expect(marcus.locator('.total')).toHaveText('$52.00');
    const [download] = await Promise.all([
      marcus.waitForEvent('download'), marcus.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('nyc-expenses-backup.csv');
    expect(await readFile(await download.path(), 'utf8')).toContain('"Dinner","52.00","Food & Drinks","Chloe"');
    await marcus.getByLabel('Category', { exact: true }).selectOption('');
    await marcus.getByRole('button', { name: 'Nov 5', exact: true }).click();
    await expect(marcus.getByText('No expenses match these filters.')).toBeVisible();
    await marcus.getByRole('button', { name: 'All days', exact: true }).click();

    await marcus.getByRole('button', { name: 'Edit Dinner, $52.00', exact: true }).click();
    await marcus.getByRole('button', { name: 'Delete expense', exact: true }).click();
    await marcus.getByRole('button', { name: 'Keep expense', exact: true }).click();
    await marcus.getByRole('button', { name: 'Delete expense', exact: true }).click();
    await marcus.getByRole('button', { name: 'Delete expense', exact: true }).click();
    await expect(chloe.getByRole('button', { name: 'Edit Dinner, $52.00', exact: true })).toHaveCount(0, { timeout: 5000 });
    await expect(chloe.locator('.total')).toHaveText('$0.00');
    await expect(chloe.getByRole('heading', { name: 'No balance due' })).toBeVisible();
    await expect(marcus.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
    await marcus.screenshot({ path: test.info().outputPath('mobile.png'), fullPage: true });
    const dimensions = await marcus.evaluate(() => ({
      viewport: innerWidth, document: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll('main, .summary-grid, .total-card, .paid-card, .settlement, .content-grid, .section-title, .categories')].map(el => ({
        name: el.className || el.tagName, right: el.getBoundingClientRect().right, width: el.getBoundingClientRect().width,
      })),
    }));
    expect(dimensions.document, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport);
    expect(errors).toEqual([]);
  } finally { await phone.close(); await desktop.close(); }
});
