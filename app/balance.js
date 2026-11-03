import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, RefreshCw } from 'lucide-react';
import { money } from '../lib/money';
import { latestRate, ntd } from '../lib/exchange';

export default function Balance({ summary, currency, setCurrency }) {
 const [rate, setRate] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
 const controller = useRef(null);
 async function refresh() {
  controller.current?.abort();
  const request = new AbortController(); controller.current = request;
  setLoading(true); setError('');
  const timeout = setTimeout(() => request.abort(), 10000);
  try { const next = await latestRate(request.signal); if (!request.signal.aborted) setRate(next); }
  catch { if (controller.current === request) setError('Rate unavailable. Try refresh.'); }
  finally { clearTimeout(timeout); if (controller.current === request) setLoading(false); }
 }
 useEffect(() => {
  if (currency !== 'TWD') return;
  refresh();
  const timer = setInterval(refresh, 60 * 60 * 1000);
  const focus = () => refresh(); window.addEventListener('focus', focus);
  return () => { clearInterval(timer); window.removeEventListener('focus', focus); controller.current?.abort(); controller.current = null; };
 }, [currency]);
 const converted = currency === 'TWD' && rate;
 const direction = summary.balance > 0 ? 'Chloe owes Marcus' : summary.balance < 0 ? 'Marcus owes Chloe' : 'No balance due';
 return <div className="balance-card">
  <div className="balance-tools"><span>Balance</span><button className="currency-button" onClick={() => setCurrency(currency === 'USD' ? 'TWD' : 'USD')} aria-label="Switch balance currency" aria-pressed={currency === 'TWD'}><ArrowLeftRight size={13}/>{currency === 'USD' ? 'USD → NTD' : 'NTD → USD'}</button></div>
  <h2 className="balance-heading"><span className="balance-direction">{direction}</span>{summary.balance !== 0 && <> <span className="balance-amount">{converted ? `≈ ${ntd(Math.abs(summary.balance), rate.rate)}` : money(Math.abs(summary.balance))}</span></>}</h2>
  {summary.balance === 0 && <p className="balance-amount">{converted ? ntd(0, rate.rate) : money(0)}</p>}
  {currency === 'TWD' && <div className="exchange-note"><span role="status">{loading ? 'Fetching rate…' : error || (rate ? `1 USD = NT$${rate.rate} · ${rate.date} · daily estimate` : 'USD shown until rate loads')}{error && rate ? ' Using previous rate.' : ''}</span><button className="icon-button" onClick={refresh} disabled={loading} aria-label="Refresh exchange rate"><RefreshCw size={13}/></button></div>}
 </div>;
}
