export const CATEGORIES = ['Food & Drinks', 'Transportation', 'Attractions', 'Shopping', 'Other'];
export const PEOPLE = ['Marcus', 'Chloe'];
export const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export function parseCents(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(String(value))) throw new Error('Enter a positive USD amount with at most two decimal places.');
  const [whole, fraction = ''] = String(value).split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 100000000) throw new Error('Amount must be between $0.01 and $1,000,000.');
  return cents;
}
export function shares(expense) {
  const n = expense.amount_cents;
  if (expense.split_type === 'marcus') return { Marcus: n, Chloe: 0 };
  if (expense.split_type === 'chloe') return { Marcus: 0, Chloe: n };
  // Marcus consistently receives the extra cent on odd shared amounts.
  return { Marcus: Math.ceil(n / 2), Chloe: Math.floor(n / 2) };
}
export function summarize(expenses) {
  const paid = { Marcus: 0, Chloe: 0 }, owed = { Marcus: 0, Chloe: 0 };
  for (const e of expenses) { paid[e.paid_by] += e.amount_cents; const s = shares(e); for (const p of PEOPLE) owed[p] += s[p]; }
  const balance = paid.Marcus - owed.Marcus;
  return { total: paid.Marcus + paid.Chloe, paid, owed, balance, settlement: balance === 0 ? 'You’re all square ♡' : balance > 0 ? `Chloe owes Marcus ${money(balance)}` : `Marcus owes Chloe ${money(-balance)}` };
}
export function csv(expenses) {
  const cell = v => '"' + String(v ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""') + '"';
  return '\uFEFF' + [['Date','Title','Amount (USD)','Category','Paid by','Split','Notes'], ...expenses.map(e => [e.expense_date,e.title,(e.amount_cents/100).toFixed(2),e.category,e.paid_by,e.split_type,e.notes])].map(row => row.map(cell).join(',')).join('\r\n');
}
