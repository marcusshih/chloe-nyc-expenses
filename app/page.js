'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Check, Menu as MenuIcon, Plus, X } from 'lucide-react';
import { supabase as db } from '../lib/supabase';
import { deleteExpense, listExpenses, saveExpense as persistExpense, subscribeExpenses } from '../lib/expenses';
import { CATEGORIES, PEOPLE, csv, money, parseCents, shares, summarize } from '../lib/money';
import { todayInNewYork } from '../lib/date';
import Balance from './balance';
const dates = Array.from({length:6},(_,i)=>`2026-11-${String(i+4).padStart(2,'0')}`);
const formatDate = value => new Date(value+'T12:00:00').toLocaleDateString('en-US',{ weekday:'long',month:'short',day:'numeric' });
function Modal({title,close,children}) {
 const ref=useRef(null), restore=useRef(null);
 useEffect(()=>{restore.current=document.activeElement; ref.current.showModal(); return ()=>restore.current?.focus();},[]);
 return <dialog ref={ref} onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target===ref.current)close();}} aria-label={title}><div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={close}><X size={20}/></button></div>{children}</dialog>;
}
function ExpenseForm({expense,defaultDate,defaultCategory,busy,onSubmit,onDelete}) {
 const [amount,setAmount]=useState(expense?(expense.amount_cents/100).toFixed(2):'');
 const [dateOverride,setDateOverride]=useState(null);
 const [splitType,setSplitType]=useState(expense?.split_type||'shared');
 const formCategories=expense&&!CATEGORIES.includes(expense.category)?[...CATEGORIES,expense.category]:CATEGORIES;
 let allocation=null;
 try { allocation=shares({amount_cents:parseCents(amount),split_type:splitType}); } catch { /* Preview appears once the amount is valid. */ }
 return <form onSubmit={onSubmit}>
    <label htmlFor="amount">Amount (USD)</label><input className="amount-input" id="amount" name="amount" inputMode="decimal" placeholder="0.00" pattern="[0-9]+([.][0-9]{1,2})?" value={amount} onChange={e=>setAmount(e.target.value)} required/>
    <label htmlFor="title">Description</label><input id="title" name="title" placeholder="Lunch" defaultValue={expense?.title||''} required maxLength={120}/>
    <label htmlFor="paid_by">Paid by</label><select id="paid_by" name="paid_by" defaultValue={expense?.paid_by||'Marcus'}>{PEOPLE.map(p=><option key={p} value={p}>{p}</option>)}</select>
    {allocation&&<dl className="split-preview" aria-label="Expense shares" aria-live="polite">{PEOPLE.map(person=><div key={person}><dt>{person}’s share</dt><dd>{money(allocation[person])}</dd></div>)}</dl>}
    <details className="expense-options" open={!!expense}>
     <summary>More options</summary>
     <div className="form-grid"><div><label htmlFor="date">Date</label><input id="date" name="date" type="date" value={dateOverride??expense?.expense_date??defaultDate} onChange={e=>setDateOverride(e.target.value)} required/></div><div><label htmlFor="category">Category</label><select id="category" name="category" defaultValue={expense?.category||defaultCategory}>{formCategories.map(c=><option key={c}>{c}</option>)}</select></div></div>
     <label htmlFor="split_type">Split</label><select id="split_type" name="split_type" value={splitType} onChange={e=>setSplitType(e.target.value)}><option value="shared">Equally (50/50)</option><option value="marcus">Marcus only</option><option value="chloe">Chloe only</option></select>
     <label htmlFor="notes">Notes <span className="muted">(optional)</span></label><textarea id="notes" name="notes" rows={2} maxLength={2000} defaultValue={expense?.notes||''}/>
    </details>
    <button className="primary full" disabled={busy}>{busy?'Saving…':'Save expense'}</button>{expense&&<button className="delete-link" type="button" disabled={busy} onClick={onDelete}>Delete expense</button>}
   </form>;
}
function TripTotal({summary,count}) {
 return <div className="total-card"><div className="card-caption">Total <span>USD</span></div><p className="total">{money(summary.total)}</p><p className="total-detail">{count} {count===1?'expense':'expenses'}</p></div>;
}
export default function Home() {
 const [expenses,setExpenses]=useState([]),[view,setView]=useState('home'),[formVersion,setFormVersion]=useState(0);
 const [today,setToday]=useState(''),[currency,setCurrency]=useState('USD');
 useEffect(()=>{const update=()=>setToday(todayInNewYork());update();const timer=setInterval(update,30000);window.addEventListener('focus',update);document.addEventListener('visibilitychange',update);return()=>{clearInterval(timer);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update);};},[]);
 const menuRef=useRef(null),headingRef=useRef(null);
 const [loading,setLoading]=useState(!!db),[error,setError]=useState(''),[message,setMessage]=useState(''),[online,setOnline]=useState('Connecting'),[filter,setFilter]=useState(''),[categoryFilter,setCategoryFilter]=useState(''),[modal,setModal]=useState(null),[busy,setBusy]=useState(false);
 const request=useRef(0),mounted=useRef(false);
 useEffect(()=>{
  const navigate=()=>{
   const next=location.hash.slice(1);
   setView(['expenses','summary'].includes(next)?next:'home');
   if(menuRef.current)menuRef.current.open=false;
  };
  const outside=e=>{if(menuRef.current&&!menuRef.current.contains(e.target))menuRef.current.open=false;};
  navigate();window.addEventListener('hashchange',navigate);document.addEventListener('pointerdown',outside);
  return ()=>{window.removeEventListener('hashchange',navigate);document.removeEventListener('pointerdown',outside);};
 },[]);
 useEffect(()=>{headingRef.current?.focus({preventScroll:true});window.scrollTo(0,0);},[view]);
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
  await persistExpense(db,payload,modal?.expense);
  if(!modal?.expense)setFormVersion(version=>version+1);
  setModal(null);setMessage('Expense saved.');await load();
 });}
 async function removeExpense(){await action(async()=>{await deleteExpense(db,modal.expense);setModal(null);setMessage('Expense deleted.');await load();});}
 function download(){const url=URL.createObjectURL(new Blob([csv(expenses)],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download=`nyc-expenses-backup.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 const availableDates=Array.from(new Set([...dates,...(today?[today]:[]),...expenses.map(e=>e.expense_date)])).filter(date=>date!=='2026-11-03').sort();
 const availableCategories=Array.from(new Set([...CATEGORIES,...expenses.map(expense=>expense.category)]));
 const summary=summarize(expenses),filtered=expenses.filter(e=>(!filter||e.expense_date===filter)&&(!categoryFilter||e.category===categoryFilter));
 return <main className={`view-${view}`}>
  <header className="topbar">
   <a className="brand" href="#home" aria-label="Marcus and Chloe travel ledger">
Marcus & Chloe
   </a>
   <div className="top-actions">{db&&<span className="sync" role="status"><i className={online==='Live sync'?'live':''}/>{online}</span>}
    <details className="navigation" ref={menuRef} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();menuRef.current.open=false;menuRef.current.querySelector('summary').focus();}}}>
     <summary role="button" aria-label="Menu"><MenuIcon size={18}/>Menu</summary>
     <nav aria-label="Main navigation">{[['home','Home'],['expenses','Expenses'],['summary','Summary']].map(([key,label])=><a key={key} href={`#${key}`} aria-current={view===key?'page':undefined} onClick={()=>{menuRef.current.open=false;}}>{label}</a>)}</nav>
    </details>
   </div>
  </header>

  <section className="intro" aria-label="Trip details">
   <h1 ref={headingRef} tabIndex={-1}>{view==='home'?'New York':view==='expenses'?'Expenses':'Summary'}</h1>
   <p className="trip-dates">Nov 4–9, 2026</p>
  </section>

  <div aria-live="polite" className="notices">
   {error&&<p className="notice error" role="alert">{error}<button onClick={()=>setError('')} aria-label="Dismiss error"><X size={16}/></button></p>}
   {message&&<p className="notice"><Check size={16}/>{message}</p>}
  </div>

  {!db?<section className="setup"><h2>Connect Supabase</h2><p>Add the public project settings from the README, then rebuild.</p></section>
   :loading?<section className="setup" role="status"><span className="loader"/>Loading your shared ledger…</section>:<>

   {view==='home'&&<div className="home-grid">
    <section className="home-total" aria-label="Shared balance"><Balance summary={summary} currency={currency} setCurrency={setCurrency}/></section>
    <section className="new-expense" aria-labelledby="add-expense-heading"><h2 id="add-expense-heading">Add expense</h2><ExpenseForm key={formVersion} defaultDate={today} defaultCategory={CATEGORIES[0]} busy={busy} onSubmit={saveExpense}/></section>
   </div>}

   {view==='summary'&&<>
    <section aria-label="Shared balance"><Balance summary={summary} currency={currency} setCurrency={setCurrency}/></section>
    <details className="spending-details"><summary>Spending details</summary><section className="overview" aria-label="Trip totals"><div className="summary-grid">
     <TripTotal summary={summary} count={expenses.length}/>
     <div className="paid-card"><p className="paid-label">Paid</p>{PEOPLE.map(p=><div className="paid-line" key={p}><div><span className="person-name">{p}</span><small>Share {money(summary.owed[p])}</small></div><strong>{money(summary.paid[p])}</strong></div>)}</div>
    </div></section>
    <section className="categories"><h2>By category</h2>{availableCategories.map(c=>{const amount=expenses.filter(e=>e.category===c).reduce((s,e)=>s+e.amount_cents,0);return <div className="category-breakdown" key={c}><div><span>{c}</span><strong>{money(amount)}</strong></div><div className="bar"><span style={{width:`${summary.total?amount/summary.total*100:0}%`}}/></div></div>;})}</section></details>
   </>}

   {view==='expenses'&&<>
    <section className="expenses">
     <div className="section-title"><p className="list-count">{expenses.length} {expenses.length===1?'expense':'expenses'}</p><div className="section-actions"><button className="text-button" onClick={download} disabled={!expenses.length} title="Download all trip expenses as a CSV backup"><ArrowDownToLine size={15}/> Export CSV</button><a className="add-button primary" href="#home"><Plus size={17}/> Add expense</a></div></div>
     <div className="filters">
      <div className="date-filters" role="group" aria-label="Filter expenses by date"><button aria-pressed={!filter} onClick={()=>setFilter('')}>All days</button>{availableDates.map(d=><button key={d} aria-pressed={filter===d} onClick={()=>setFilter(d)}>{new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}</button>)}</div>
      <div className="category-filter"><label htmlFor="categoryFilter">Category</label><select id="categoryFilter" value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}><option value="">All categories</option>{availableCategories.map(c=><option key={c}>{c}</option>)}</select></div>
     </div>
     {!filtered.length?<div className="empty"><h3>{expenses.length?'No matching expenses.':'No expenses yet.'}</h3><p>{expenses.length?'No expenses match these filters.':'Split equally by default.'}</p><a className="text-button" href="#home">Add an expense <Plus size={15}/></a></div>
      :Array.from(new Set(filtered.map(e=>e.expense_date))).map(date=><div className="date-group" key={date}>
       <div className="date-heading"><h3>{formatDate(date)}</h3><span>{money(filtered.filter(e=>e.expense_date===date).reduce((s,e)=>s+e.amount_cents,0))}</span></div>
       <div className="expense-list">{filtered.filter(e=>e.expense_date===date).map(e=><button className="expense-row" key={e.id} onClick={()=>setModal({type:'expense',expense:e})} aria-label={`Edit ${e.title}, ${money(e.amount_cents)}`}><span className="expense-info"><strong>{e.title}</strong><small>{e.category} · {e.paid_by} paid</small>{e.notes&&<span className="note-preview">{e.notes}</span>}</span><span className="expense-amount"><strong>{money(e.amount_cents)}</strong><small>{e.split_type==='shared'?'Split 50/50':e.split_type==='marcus'?'Marcus only':'Chloe only'}</small></span></button>)}</div>
      </div>)}
    </section>
   </>}

  </>}


  {modal&&<Modal title={modal.type==='delete'?'Delete expense?':modal.expense?'Edit expense':'New expense'} close={()=>!busy&&setModal(null)}>
   {error&&<p className="notice error" role="alert">{error}</p>}
   {modal.type==='delete'?<><p>“{modal.expense.title}” ({money(modal.expense.amount_cents)}) will be removed for both travelers.</p><div className="modal-actions"><button className="secondary" disabled={busy} onClick={()=>setModal({...modal,type:'expense'})}>Keep expense</button><button className="danger" disabled={busy} onClick={removeExpense}>Delete expense</button></div></>:<ExpenseForm key={modal.expense?.id||'new'} expense={modal.expense} defaultDate={today} defaultCategory={categoryFilter||CATEGORIES[0]} busy={busy} onSubmit={saveExpense} onDelete={()=>setModal({...modal,type:'delete'})}/>}
  </Modal>}
 </main>;
}
