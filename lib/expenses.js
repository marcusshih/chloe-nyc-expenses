export const TRIP_ID = '20261104-0000-4000-8000-000000000001';
export const EXPENSE_COLUMNS = 'id,trip_id,title,amount_cents,expense_date,category,paid_by,split_type,notes,created_at,updated_at';

export async function listExpenses(db) {
  const rows = [];
  // Supabase limits each response. Page so totals and backups include every row.
  const pageSize = 500;
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await db.from('expenses').select(EXPENSE_COLUMNS)
      .eq('trip_id', TRIP_ID).order('expense_date', { ascending: false })
      .order('created_at', { ascending: false }).order('id')
      .range(start, start + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

export async function saveExpense(db, payload, existing) {
  const query = existing
    ? db.from('expenses').update(payload).eq('id', existing.id).eq('trip_id', TRIP_ID).eq('updated_at', existing.updated_at)
    : db.from('expenses').insert({ ...payload, trip_id: TRIP_ID });
  const { data, error } = await query.select('id');
  if (error) throw error;
  if (!data.length) throw new Error('This expense changed on another device. Close and reopen it to use the latest version.');
  return data[0];
}

export async function deleteExpense(db, existing) {
  const { data, error } = await db.from('expenses').delete().eq('id', existing.id)
    .eq('trip_id', TRIP_ID).eq('updated_at', existing.updated_at).select('id');
  if (error) throw error;
  if (!data.length) throw new Error('This expense changed. Close and reopen it before deleting.');
}

export function subscribeExpenses(db, refresh, status) {
  return db.channel(`nyc-expenses-${TRIP_ID}`).on('postgres_changes', {
    event: 'UPDATE', schema: 'public', table: 'expense_sync', filter: `trip_id=eq.${TRIP_ID}`,
  }, refresh).subscribe(status);
}
