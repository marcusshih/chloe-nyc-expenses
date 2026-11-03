import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { EXPENSE_COLUMNS, TRIP_ID } from '../lib/expenses.js';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const oldTrip = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherTrip = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const dateMigration = await readFile(new URL('../supabase/migrations/003_flexible_expense_dates.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/002_public_shared_trip.sql', import.meta.url), 'utf8');
async function legacyDatabase() {
  const db = new PGlite();
  // Supabase's roles/Auth schema/publication. pgcrypto is only needed by the
  // removed invitation RPCs; PGlite lacks that extension. All other SQL is exact.
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create publication supabase_realtime;
  `);
  const legacy = await readFile(new URL('../supabase/migrations/001_trip.sql', import.meta.url), 'utf8');
  await db.exec(legacy.replace('create extension if not exists pgcrypto with schema extensions;', ''));
  return db;
}
const insertSQL = `insert into public.expenses(trip_id,title,amount_cents,expense_date,category,paid_by,split_type,notes)
 values($1,$2,$3,'2026-11-04','Food & Drinks','Marcus','shared','') returning id,updated_at`;

test('migration preserves NYC expenses; anon CRUD is scoped and signals every change', async () => {
  const db = await legacyDatabase();
  try {
    await db.exec(`
      insert into auth.users(id) values('${owner}');
      insert into public.trips(id,created_by) values('${oldTrip}','${owner}');
      insert into public.trips(id,name,created_by) values('${otherTrip}','Private unrelated trip','${owner}');
      insert into public.trip_members values('${oldTrip}','${owner}','Marcus');
      insert into public.expenses(trip_id,title,amount_cents,expense_date,category,paid_by,split_type,created_by)
      values('${oldTrip}','Preserved coffee',501,'2026-11-04','Food & Drinks','Chloe','shared','${owner}'),
            ('${otherTrip}','Private expense',999,'2026-11-04','Other','Marcus','shared','${owner}');
    `);
    await db.exec(migration);
    await db.exec(dateMigration);
    const rls = await db.query(`select relname,relrowsecurity from pg_class where oid in
      ('public.trips'::regclass,'public.expenses'::regclass,'public.trip_members'::regclass,
       'public.trip_invitations'::regclass,'public.expense_sync'::regclass)`);
    assert.equal(rls.rows.length, 5);
    assert.ok(rls.rows.every(r => r.relrowsecurity));
    const published = await db.query("select tablename from pg_publication_tables where pubname='supabase_realtime'");
    assert.deepEqual(published.rows.map(r => r.tablename), ['expense_sync']);
    for (const name of ['create_trip', 'create_invitation', 'accept_invitation', 'is_trip_member']) {
      assert.equal((await db.query('select 1 from pg_proc where proname=$1', [name])).rows.length, 0);
    }

    await db.exec('set role anon');
    assert.equal((await db.query('select current_user')).rows[0].current_user, 'anon');
    const preserved = (await db.query(`select ${EXPENSE_COLUMNS} from public.expenses`)).rows;
    assert.equal(preserved.length, 1);
    assert.equal(preserved[0].title, 'Preserved coffee');
    assert.equal(preserved[0].trip_id, TRIP_ID);
    const revision = async () => Number((await db.query('select revision from public.expense_sync')).rows[0].revision);
    assert.equal(await revision(), 0);

    const added = (await db.query(insertSQL, [TRIP_ID, 'Public lunch', 5100])).rows[0];
    assert.equal(await revision(), 1);
    const updated = await db.query(`update public.expenses set title='Public dinner',paid_by='Chloe'
      where id=$1 returning title,paid_by,updated_at`, [added.id]);
    assert.equal(updated.rows[0].paid_by, 'Chloe');
    assert.ok(updated.rows[0].updated_at > added.updated_at);
    assert.equal(await revision(), 2);
    // Optimistic concurrency checks include the original timestamp.
    const stale = await db.query(`update public.expenses set title='Stale overwrite'
      where id=$1 and updated_at=$2 returning id`, [added.id, added.updated_at]);
    assert.equal(stale.rows.length, 0);
    assert.equal(await revision(), 2);
    await db.query('delete from public.expenses where id=$1', [added.id]);
    assert.equal(await revision(), 3);

    // RLS still limits requests with the client-side filter deliberately removed.
    assert.equal((await db.query(`select id from public.expenses where trip_id=$1`, [otherTrip])).rows.length, 0);
    assert.equal((await db.query(`update public.expenses set title='attack' where trip_id=$1 returning id`, [otherTrip])).rows.length, 0);
    assert.equal((await db.query(`delete from public.expenses where trip_id=$1 returning id`, [otherTrip])).rows.length, 0);
    await assert.rejects(db.query(insertSQL, [otherTrip, 'Wrong trip', 100]), /row-level security/);
    await assert.rejects(db.query(insertSQL, [TRIP_ID, 'Invalid amount', 0]), /check constraint/);
    await assert.rejects(db.exec(`update public.expenses set paid_by='Someone else'`), /check constraint/);
    await db.exec(`update public.expenses set expense_date='2026-11-03'`);
    assert.equal((await db.query('select expense_date::text as date from public.expenses')).rows[0].date, '2026-11-03');
    await assert.rejects(db.exec(`update public.expenses set expense_date='2026-02-30'`), /date|range/i);
    for (const sql of [
      'select created_by from public.expenses', 'select * from public.expenses',
      'select * from public.trips', 'select * from public.trip_members', 'select * from public.trip_invitations',
      `update public.expenses set trip_id='${otherTrip}'`, 'update public.expenses set created_at=now()',
      `update public.expenses set created_by='${owner}'`,
      `insert into public.expenses(trip_id,title,amount_cents,expense_date,category,paid_by,split_type,created_by)
       values('${TRIP_ID}','Creator spoof',100,'2026-11-04','Other','Marcus','shared','${owner}')`,
      'update public.expense_sync set revision=99', 'delete from public.expense_sync',
      'truncate public.expenses', 'select public.notify_expenses()',
    ]) await assert.rejects(db.exec(sql), /permission denied/);

    await db.exec('reset role; set role authenticated');
    await assert.rejects(db.exec('select title from public.expenses'), /permission denied/);
    await assert.rejects(db.query(insertSQL, [TRIP_ID, 'Old session', 100]), /permission denied/);
    await assert.rejects(db.exec("update public.expenses set title='Old session'"), /permission denied/);
    await db.exec('reset role');
    assert.equal((await db.query('select title from public.expenses where trip_id=$1', [otherTrip])).rows[0].title, 'Private expense');
    assert.equal((await db.query('select count(*)::int as n from public.trip_members')).rows[0].n, 1);
  } finally { await db.close(); }
});

test('fresh database seeds exactly one shared trip without accounts', async () => {
  const db = await legacyDatabase();
  try {
    await db.exec(migration);
    await db.exec(dateMigration);
    assert.equal((await db.query('select count(*)::int as n from public.trips')).rows[0].n, 1);
    await db.exec('set role anon');
    assert.equal((await db.query(insertSQL, [TRIP_ID, 'First expense', 100])).rows.length, 1);
  } finally { await db.close(); }
});

test('ambiguous existing NYC trips abort the migration atomically', async () => {
  const db = await legacyDatabase();
  try {
    await db.exec(`insert into auth.users(id) values('${owner}');
      insert into public.trips(created_by) values('${owner}'),('${owner}');`);
    await assert.rejects(db.exec(migration), /Multiple NYC trips/);
    await db.exec('rollback');
    assert.equal((await db.query("select 1 from pg_proc where proname='create_trip'")).rows.length, 1);
    assert.equal((await db.query('select count(*)::int as n from public.trips')).rows[0].n, 2);
  } finally { await db.close(); }
});
