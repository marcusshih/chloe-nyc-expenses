export const RATE_URL = 'https://api.frankfurter.dev/v2/rate/USD/TWD';
export async function latestRate(signal) {
 const response = await fetch(RATE_URL, { cache: 'no-store', credentials: 'omit', signal });
 if (!response.ok) throw new Error('Exchange rate unavailable.');
 const data = await response.json();
 if (data.base !== 'USD' || data.quote !== 'TWD' || !Number.isFinite(data.rate) || data.rate <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) throw new Error('Invalid exchange rate.');
 return { rate: data.rate, date: data.date };
}
export const ntd = (cents, rate) => 'NT$' + new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100 * rate);
