// The trip's calendar date, independent of the device's timezone.
export function todayInNewYork(now = new Date()) {
 const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
 const part = type => parts.find(value => value.type === type).value;
 return `${part('year')}-${part('month')}-${part('day')}`;
}
