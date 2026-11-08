// Older detailed-record contracts explicitly choose that view; the app defaults to Quick Skim.
export function withDetailedHistory(value) {
  const url = new URL(value)
  if (/^\/patients\/[^/]+$/.test(url.pathname)) url.searchParams.set('historyDensity', 'detailed')
  return url.href
}
