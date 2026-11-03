import './globals.css';
export const metadata = { title: 'New York | Marcus & Chloe', description: 'A shared travel ledger for Marcus and Chloe. New York, November 4–9, 2026.' };
export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#f7f5f0' };
export default function Layout({ children }) { return <html lang="en"><body>{children}</body></html>; }
