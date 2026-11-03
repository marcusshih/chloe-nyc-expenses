import './globals.css';
export const metadata = { title: 'New York | Marcus & Chloe', description: 'A shared travel ledger for Marcus and Chloe. New York, November 4–9, 2026.' };
export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#ffffff' };
export default function Layout({ children }) {
  // Browser extensions add attributes to body before React hydrates. Tolerate
  // those attributes here; descendant hydration checks remain enabled.
  return <html lang="en"><body suppressHydrationWarning>{children}</body></html>;
}
