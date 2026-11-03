'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Check, Coffee, Landmark, MoreHorizontal, Plus, ShoppingBag, TrainFront, Wallet, X } from 'lucide-react';
import { supabase as db } from '../lib/supabase';
import { deleteExpense, listExpenses, saveExpense as persistExpense, subscribeExpenses } from '../lib/expenses';
import { CATEGORIES, PEOPLE, csv, money, parseCents, summarize } from '../lib/money';
const icons = [Coffee, TrainFront, Landmark, ShoppingBag, MoreHorizontal];
const dates = Array.from({length:6},(_,i)=>`2026-11-${String(i+4).padStart(2,'0')}`);
const formatDate = value => new Date(value+'T12:00:00').toLocaleDateString('en-US',{ weekday:'long',month:'short',day:'numeric' });
function Icon({category,...props}) { const Component=icons[CATEGORIES.indexOf(category)] || Wallet; return <Component {...props}/>; }
function Modal({title,close,children}) {
 const ref=useRef(null), restore=useRef(null);
 useEffect(()=>{restore.current=document.activeElement; ref.current.showModal(); return ()=>restore.current?.focus();},[]);
 return <dialog ref={ref} onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target===ref.current)close();}} aria-label={title}><div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={close}><X size={20}/></button></div>{children}</dialog>;
}
export default function Home() {
 const [expenses,setExpenses]=useState([]);
 const [loading,setLoading]=useState(!!db),[error,setError]=useState(''),[message,setMessage]=useState(''),[online,setOnline]=useState('Connecting'),[filter,setFilter]=useState(''),[categoryFilter,setCategoryFilter]=useState(''),[modal,setModal]=useState(null),[busy,setBusy]=useState(false);
 const request=useRef(0),mounted=useRef(false);
 async function load() {
  const seq=++request.current;
  try {
   const rows=await listExpenses(db);
   if(mounted.current && seq===request.current){setExpenses(rows);setLoading(false);}
  } catch(e){if(mounted.current && seq===request.current){setError(e.message);setLoading(false);}}
 }
 useEffect(()=>{
  if(!db)return;
  mounted.current=true;
  load();
  const refresh=()=>load();
  const channel=subscribeExpenses(db,refresh,status=>{
   if(!mounted.current)return;
   if(status==='SUBSCRIBED'){setOnline('Live sync');refresh();}else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status))setOnline('Sync paused');
  });
  const visible=()=>{if(document.visibilityState==='visible')refresh();};
  const offline=()=>setOnline('Offline');
  window.addEventListener('offline',offline);window.addEventListener('online',refresh);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',visible);
  const timer=setInterval(refresh,30000);
  return ()=>{mounted.current=false;request.current++;db.removeChannel(channel);clearInterval(timer);window.removeEventListener('offline',offline);window.removeEventListener('online',refresh);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',visible);};
 },[]);
 async function action(fn) { setBusy(true);setError('');setMessage('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);} }
 async function saveExpense(e){e.preventDefault();const form=new FormData(e.currentTarget);await action(async()=>{
  const payload={title:form.get('title').trim(),amount_cents:parseCents(form.get('amount')),expense_date:form.get('date'),category:form.get('category'),paid_by:form.get('paid_by'),split_type:form.get('split_type'),notes:form.get('notes').trim()};
  await persistExpense(db,payload,modal.expense);
  setModal(null);setMessage('Expense saved.');await load();
 });}
 async function removeExpense(){await action(async()=>{await deleteExpense(db,modal.expense);setModal(null);setMessage('Expense deleted.');await load();});}
 function download(){const url=URL.createObjectURL(new Blob([csv(expenses)],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download=`nyc-expenses-backup.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 const summary=summarize(expenses),filtered=expenses.filter(e=>(!filter||e.expense_date===filter)&&(!categoryFilter||e.category===categoryFilter));
 return <main>
  <header className="topbar">
   <a className="brand" href={`${process.env.NEXT_PUBLIC_BASE_PATH||''}/`} aria-label="Marcus and Chloe travel ledger">
    <span className="brand-mark" aria-hidden="true">M<span>/</span>C</span>
    <span>Travel ledger</span>
   </a>
   <div className="top-actions">{db&&<span className="sync" role="status"><i className={online==='Live sync'?'live':''}/>{online}</span>}<span className="edition">NYC / 2026</span></div>
  </header>

  <section className="intro" aria-label="Trip details">
   <div><p className="eyebrow"><span className="accent-rule"/> A SHARED TRAVEL JOURNAL</p><h1>New York<span className="title-period">.</span></h1><p className="subtitle">Marcus & Chloe <span>/</span> Six days in the city.</p></div>
   <div className="trip-dates"><span className="eyebrow">NOVEMBER 2026</span><p>04 <span>—</span> 09</p><span className="trip-location">NEW YORK, UNITED STATES</span></div>
  </section>

  <div aria-live="polite" className="notices">
   {error&&<p className="notice error" role="alert">{error}<button onClick={()=>setError('')} aria-label="Dismiss error"><X size={16}/></button></p>}
   {message&&<p className="notice"><Check size={16}/>{message}</p>}
  </div>

  {!db?<section className="setup"><p className="eyebrow">GETTING STARTED</p><h2>Connect your shared ledger.</h2><p>Add your Supabase URL and public publishable key using the project README, then rebuild. Your expenses will be available here, with no account needed.</p></section>
   :loading?<section className="setup" role="status"><span className="loader"/>Loading your shared ledger…</section>:<>

   <section className="overview" aria-label="Trip totals">
    <p className="eyebrow section-index">01 <span>OVERVIEW</span></p>
    <div className="summary-grid">
     <div className="total-card"><div className="card-caption">Total expenditure <span>USD</span></div><p className="total">{money(summary.total)}</p><p className="total-detail">{expenses.length} {expenses.length===1?'expense':'expenses'} recorded <span>04 — 09 NOV</span></p></div>
     <div className="paid-card"><p className="eyebrow">PAID BY EACH TRAVELER</p>{PEOPLE.map(p=><div className="paid-line" key={p}><div><span className="person-name">{p}</span><small>Share of costs {money(summary.owed[p])}</small></div><strong>{money(summary.paid[p])}</strong></div>)}</div>
    </div>
   </section>

   <section className="settlement"><ArrowUpRight size={20} aria-hidden="true"/><div><p className="eyebrow">SETTLEMENT</p><h2>{summary.settlement}</h2></div><p className="settlement-note">Across all trip expenses. <br/>Odd shared cents are assigned to Marcus.</p></section>

   <div className="content-grid">
    <section className="expenses">
     <div className="section-title"><div><p className="eyebrow section-index">02 <span>THE LEDGER</span></p><h2>Expenses <span className="count">{String(expenses.length).padStart(2,'0')}</span></h2></div><div className="section-actions"><button className="text-button" onClick={download} disabled={!expenses.length} title="Download all trip expenses as a CSV backup"><ArrowDownToLine size={15}/> Export CSV</button><button className="add-button primary" onClick={()=>setModal({type:'expense'})}><Plus size={17}/> Add expense</button></div></div>
     <div className="filters">
      <div className="date-filters" role="group" aria-label="Filter expenses by date"><button aria-pressed={!filter} onClick={()=>setFilter('')}>All days</button>{dates.map((d,i)=><button key={d} aria-pressed={filter===d} onClick={()=>setFilter(d)}>Nov {i+4}</button>)}</div>
      <div className="category-filter"><label htmlFor="categoryFilter">Category</label><select id="categoryFilter" value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}><option value="">All categories</option>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></div>
     </div>
     {!filtered.length?<div className="empty"><span className="empty-number" aria-hidden="true">—</span><h3>{expenses.length?'No matching expenses.':'No expenses yet.'}</h3><p>{expenses.length?'No expenses match these filters.':'Add an expense to start your shared ledger.'}</p><button className="text-button" onClick={()=>setModal({type:'expense'})}>Add an expense <ArrowUpRight size={15}/></button></div>
      :Array.from(new Set(filtered.map(e=>e.expense_date))).map(date=><div className="date-group" key={date}>
       <div className="date-heading"><h3>{formatDate(date)}</h3><span>{money(filtered.filter(e=>e.expense_date===date).reduce((s,e)=>s+e.amount_cents,0))}</span></div>
       <div className="expense-list">{filtered.filter(e=>e.expense_date===date).map(e=><button className="expense-row" key={e.id} onClick={()=>setModal({type:'expense',expense:e})} aria-label={`Edit ${e.title}, ${money(e.amount_cents)}`}><span className="category-icon"><Icon category={e.category} size={18}/></span><span className="expense-info"><strong>{e.title}</strong><small>{e.category} · {e.paid_by} paid</small>{e.notes&&<span className="note-preview">{e.notes}</span>}</span><span className="expense-amount"><strong>{money(e.amount_cents)}</strong><small>{e.split_type==='shared'?'Split 50/50':e.split_type==='marcus'?'Marcus only':'Chloe only'}</small></span></button>)}</div>
      </div>)}
    </section>
    <aside>
     <section className="categories"><p className="eyebrow section-index">03 <span>BREAKDOWN</span></p><h2>By category</h2><p className="muted">The whole trip, at a glance.</p>{CATEGORIES.map((c,i)=>{const amount=expenses.filter(e=>e.category===c).reduce((s,e)=>s+e.amount_cents,0);return <div className="category-breakdown" key={c}><div><span><span className="category-number">0{i+1}</span>{c}</span><strong>{money(amount)}</strong></div><div className="bar"><span style={{width:`${summary.total?amount/summary.total*100:0}%`}}/></div></div>;})}<div className="category-total"><span>Total</span><strong>{money(summary.total)}</strong></div></section>
     <p className="ledger-note">One trip. One shared record.<br/>All amounts in US dollars.</p>
    </aside>
   </div>
  </>}

  <footer><span>Marcus & Chloe</span><span>New York — November 2026</span></footer>

  {modal&&<Modal title={modal.type==='delete'?'Delete expense?':modal.expense?'Edit expense':'New expense'} close={()=>!busy&&setModal(null)}>
   {error&&<p className="notice error" role="alert">{error}</p>}
   {modal.type==='delete'?<><p>“{modal.expense.title}” ({money(modal.expense.amount_cents)}) will be removed for both travelers.</p><div className="modal-actions"><button className="secondary" disabled={busy} onClick={()=>setModal({...modal,type:'expense'})}>Keep expense</button><button className="danger" disabled={busy} onClick={removeExpense}>Delete expense</button></div></>:<form onSubmit={saveExpense}>
    <label htmlFor="title">Description</label><input id="title" name="title" placeholder="Coffee in the West Village" defaultValue={modal.expense?.title||''} required maxLength={120}/>
    <div className="form-grid"><div><label htmlFor="amount">Amount (USD)</label><input id="amount" name="amount" inputMode="decimal" placeholder="0.00" pattern="[0-9]+([.][0-9]{1,2})?" defaultValue={modal.expense?(modal.expense.amount_cents/100).toFixed(2):''} required/></div><div><label htmlFor="date">Date</label><input id="date" name="date" type="date" min={dates[0]} max={dates[5]} defaultValue={modal.expense?.expense_date||filter||dates[0]} required/></div></div>
    <label htmlFor="category">Category</label><select id="category" name="category" defaultValue={modal.expense?.category||categoryFilter||CATEGORIES[0]}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select>
    <div className="form-grid"><div><label htmlFor="paid_by">Paid by</label><select id="paid_by" name="paid_by" defaultValue={modal.expense?.paid_by||'Marcus'}>{PEOPLE.map(p=><option key={p} value={p}>Paid by {p}</option>)}</select></div><div><label htmlFor="split_type">Split</label><select id="split_type" name="split_type" defaultValue={modal.expense?.split_type||'shared'}><option value="shared">50/50</option><option value="marcus">Marcus only</option><option value="chloe">Chloe only</option></select></div></div>
    <label htmlFor="notes">Notes <span className="muted">(optional)</span></label><textarea id="notes" name="notes" rows={2} maxLength={2000} defaultValue={modal.expense?.notes||''}/>
    <button className="primary full" disabled={busy}>{busy?'Saving…':'Save expense'} <Check size={16}/></button>{modal.expense&&<button className="delete-link" type="button" disabled={busy} onClick={()=>setModal({...modal,type:'delete'})}>Delete expense</button>}
   </form>}
  </Modal>}
 </main>;
}
