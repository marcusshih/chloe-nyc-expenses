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

test('extension-added body attributes do not produce a hydration warning', async ({ page }) => {
  const state = { rows: [], subscribers: new Set() };
  await publicBackend(page.context(), state);
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  // Run at document start and inject as soon as the parser creates body,
  // before hydration, without changing the document's network origin.
  await page.addInitScript(() => {
    const inject = () => {
      if (!document.body) return false;
      document.body.setAttribute('data-new-gr-c-s-check-loaded', '14.1343.0');
      document.body.setAttribute('data-gr-ext-installed', '');
      document.body.setAttribute('cz-shortcut-listen', 'true');
      return true;
    };
    if (!inject()) {
      const observer = new MutationObserver(() => { if (inject()) observer.disconnect(); });
      observer.observe(document, { childList: true, subtree: true });
    }
  });
  await page.goto('/');
  await expect(page.getByText('Live sync', { exact: true })).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-gr-ext-installed', '');
  await page.getByLabel('Description').fill('Hydration check');
  await expect(page.getByLabel('Description')).toHaveValue('Hydration check');
  expect(errors.filter(error => /hydrat|didn't match|server rendered/i.test(error))).toEqual([]);
});

async function showView(page, name) {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#${name.toLowerCase()}$`));
}

test('menu separates Home, Expenses, and Summary with browser history and direct links', async ({ page }) => {
  await publicBackend(page.context(), { rows: [], subscribers: new Set() });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Add expense', exact: true })).toBeVisible();
  await expect(page.locator('.expenses, .categories, .paid-card')).toHaveCount(0);
  await showView(page, 'Expenses');
  await expect(page.getByLabel('Filter expenses by date')).toBeVisible();
  await expect(page.getByLabel('Description')).toHaveCount(0);
  await showView(page, 'Summary');
  await expect(page.getByText('Spending details', { exact: true })).toBeVisible();
  await expect(page.locator('.expenses')).toHaveCount(0);
  await page.goBack();
  await expect(page.getByLabel('Filter expenses by date')).toBeVisible();
  await page.goForward();
  await expect(page.getByText('Spending details', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Summary', exact: true })).toBeVisible();
  await showView(page, 'Home');
  await expect(page.getByLabel('Description')).toBeVisible();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Home', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeFocused();
});

test('retired Transportation expenses remain editable and counted', async ({ page }) => {
  const state = { rows: [{ id: randomUUID(), trip_id: TRIP_ID, title: 'Subway', amount_cents: 300,
    expense_date: '2026-11-04', category: 'Transportation', paid_by: 'Marcus', split_type: 'shared', notes: '',
    created_at: '2026-11-04T12:00:00.000Z', updated_at: '2026-11-04T12:00:00.000Z' }], subscribers: new Set() };
  await publicBackend(page.context(), state);
  await page.goto('/');
  await expect(page.locator('.balance-amount')).toHaveText('$1.50');
  await expect(page.getByLabel('Date', { exact: true })).toBeHidden();
  await page.getByText('More options', { exact: true }).click();
  expect(await page.locator('#category option').allTextContents()).not.toContain('Transportation');
  await showView(page, 'Expenses');
  await page.getByLabel('Category', { exact: true }).selectOption('Transportation');
  await page.getByRole('button', { name: 'Edit Subway, $3.00', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Category', { exact: true })).toHaveValue('Transportation');
  await page.getByLabel('Description').fill('Subway fare');
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByRole('button', { name: 'Edit Subway fare, $3.00', exact: true })).toBeVisible();
  await showView(page, 'Summary');
  await page.getByText('Spending details', { exact: true }).click();
  await expect(page.locator('.category-breakdown').filter({ hasText: 'Transportation' })).toContainText('$3.00');
});

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
    await expect(marcus.getByRole('heading', { name: 'Add expense', exact: true })).toBeVisible();
    await expect(marcus.locator('.expenses, .categories, .paid-card')).toHaveCount(0);
    await chloe.screenshot({ path: test.info().outputPath('desktop-home.png'), fullPage: true });
    await showView(chloe, 'Expenses');
    await marcus.getByLabel('Description').fill('Shared lunch');
    await marcus.getByLabel('Amount (USD)').fill('51.00');
    await expect(marcus.getByLabel('Paid by', { exact: true })).toHaveValue('Marcus');
    await marcus.getByText('More options', { exact: true }).click();
    expect(await marcus.locator('#category option').allTextContents()).not.toContain('Transportation');
    await expect(marcus.getByLabel('Split', { exact: true })).toHaveValue('shared');
    await expect(marcus.getByLabel('Expense shares')).toContainText('Marcus’s share$25.50');
    await expect(marcus.getByLabel('Expense shares')).toContainText('Chloe’s share$25.50');
    await marcus.getByLabel('Split', { exact: true }).selectOption('chloe');
    await expect(marcus.getByLabel('Expense shares')).toContainText('Marcus’s share$0.00');
    await expect(marcus.getByLabel('Expense shares')).toContainText('Chloe’s share$51.00');
    await marcus.getByLabel('Split', { exact: true }).selectOption('shared');
    await marcus.getByRole('button', { name: 'Save expense' }).click();
    await expect(chloe.getByRole('button', { name: 'Edit Shared lunch, $51.00', exact: true })).toBeVisible({ timeout: 5000 });
    await showView(chloe, 'Summary');
    await expect(chloe.getByRole('heading', { name: 'Chloe owes Marcus $25.50' })).toBeVisible();
    await expect(marcus.locator('.balance-amount')).toHaveText('$25.50');
    await expect(marcus.getByLabel('Amount (USD)')).toHaveValue('');
    await marcus.screenshot({ path: test.info().outputPath('mobile-populated.png'), fullPage: true });
    await chloe.screenshot({ path: test.info().outputPath('desktop-populated.png'), fullPage: true });

    await showView(chloe, 'Expenses');
    await chloe.getByRole('button', { name: 'Edit Shared lunch, $51.00', exact: true }).click();
    await chloe.getByLabel('Description').fill('Dinner');
    await chloe.getByLabel('Amount (USD)').fill('52.00');
    await chloe.getByLabel('Paid by', { exact: true }).selectOption({ label: 'Chloe' });
    await chloe.getByRole('button', { name: 'Save expense' }).click();
    await expect(marcus.locator('.balance-amount')).toHaveText('$26.00');
    await showView(marcus, 'Summary');
    await expect(marcus.getByRole('heading', { name: 'Marcus owes Chloe $26.00' })).toBeVisible();

    await showView(marcus, 'Expenses');

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
    await marcus.getByLabel('Category', { exact: true }).selectOption('Shopping');
    await expect(marcus.getByText('No expenses match these filters.')).toBeVisible();
    await showView(marcus, 'Summary');
    await expect(marcus.locator('.balance-amount')).toHaveText('$26.00');
    await showView(marcus, 'Expenses');
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
    await showView(chloe, 'Summary');
    await expect(chloe.locator('.balance-amount')).toHaveText('$0.00');
    await expect(chloe.getByRole('heading', { name: 'No balance due' })).toBeVisible();
    await expect(marcus.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
    await showView(marcus, 'Home');
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

test('today defaults, chosen dates persist, and latest NTD conversion handles failure', async ({ page }) => {
 const state = { rows: [], subscribers: new Set() };
 await publicBackend(page.context(), state);
 await page.clock.install({ time: new Date('2026-11-03T17:00:00Z') });
 let fail = false, calls = 0;
 await page.route('https://api.frankfurter.dev/**', route => { calls++; return fail ? route.fulfill({status:503,body:'Unavailable'}) : route.fulfill({json:{base:'USD',quote:'TWD',rate:32.1,date:'2026-11-03'}}); });
 await page.goto('/');
 await page.getByText('More options', {exact:true}).click();
 await expect(page.getByLabel('Date',{exact:true})).toHaveValue('2026-11-03');
 await page.getByLabel('Description').fill('Today lunch');
 await page.getByLabel('Amount (USD)').fill('51');
 await page.getByRole('button',{name:'Save expense'}).click();
 await expect.poll(()=>state.rows.length).toBe(1);
 expect(state.rows[0].expense_date).toBe('2026-11-03');
 await expect(page.getByRole('heading',{name:'Chloe owes Marcus $25.50'})).toBeVisible();
 await page.getByRole('button',{name:'Switch balance currency'}).click();
 await expect(page.locator('.balance-amount')).toHaveText('≈ NT$818.55');
 await expect(page.getByRole('status').filter({hasText:'daily estimate'})).toContainText('2026-11-03');
 fail = true;
 await page.getByRole('button',{name:'Refresh exchange rate'}).click();
 await expect(page.getByText(/Using previous rate/)).toBeVisible();
 await expect(page.locator('.balance-amount')).toHaveText('≈ NT$818.55');
 await page.getByRole('button',{name:'Switch balance currency'}).click();
 await expect(page.locator('.balance-amount')).toHaveText('$25.50');
 await page.getByText('More options',{exact:true}).click();
 await page.getByLabel('Date',{exact:true}).fill('2026-11-07');
 await page.clock.setSystemTime(new Date('2026-11-04T17:00:00Z'));
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByLabel('Date',{exact:true})).toHaveValue('2026-11-07');
 await showView(page,'Summary');
 await page.getByRole('button',{name:'Switch balance currency'}).click();
 await expect(page.getByText('Rate unavailable. Try refresh.',{exact:true})).toBeVisible();
 await expect(page.locator('.balance-amount')).toHaveText('$25.50');
 expect(calls).toBeGreaterThanOrEqual(3);
});
