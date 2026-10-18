// Compatibility module for the tracking imports in the original project.
export const DEFAULT_META_PIXEL_ID = '1150103850693228';
const attributionKey = 'zerobet:meta-attribution';
const purchaseKey = 'zerobet:meta-purchases';
const fields = ['fbclid','utm_source','utm_medium','utm_campaign','utm_content','utm_term'] as const;
function read(key: string): Record<string, any> {
  try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
}
function cookie(name: string) {
  return document.cookie.split('; ').find(c => c.startsWith(name + '='))?.slice(name.length + 1) || '';
}
export function initMetaAdsAttribution() {
  if (typeof window === 'undefined') return;
  const saved = read(attributionKey);
  const query = new URLSearchParams(location.search);
  let changed = false;
  for (const field of fields) {
    const value = query.get(field);
    if (value) { saved[field] = value; changed = true; }
  }
  if (changed) {
    saved.landingPage = location.pathname;
    saved.capturedAt = new Date().toISOString();
    try { localStorage.setItem(attributionKey, JSON.stringify(saved)); } catch {}
  }
}
export function getMetaAttributionPayload() {
  if (typeof window === 'undefined') return {};
  initMetaAdsAttribution();
  const saved = read(attributionKey);
  return { ...saved, fbp: cookie('_fbp'), fbc: cookie('_fbc') };
}
function track(event: string, params: Record<string, any> = {}) {
  if (typeof window === 'undefined') return false;
  const fbq = (window as any).fbq;
  if (typeof fbq !== 'function') return false;
  fbq('track', event, params);
  return true;
}
export function trackMetaPurchase(value: number, params: Record<string, any> = {}) {
  if (!Number.isFinite(value) || value <= 0) return;
  const orderId = String(params.orderId || '');
  const sent = read(purchaseKey);
  if (orderId && sent[orderId]) return;
  if (track('Purchase', { ...params, value, currency: 'BRL' }) && orderId) {
    sent[orderId] = Date.now();
    const recent = Object.fromEntries(Object.entries(sent).slice(-300));
    try { localStorage.setItem(purchaseKey, JSON.stringify(recent)); } catch {}
  }
}
export function trackMetaDepositIntent(value: number, params: Record<string, any> = {}) {
  track('InitiateCheckout', { ...params, value, currency: 'BRL' });
}
export function trackMetaRegistration(params: Record<string, any> = {}) { track('CompleteRegistration', params); }
export function trackMetaPageView() { track('PageView'); }
export function trackMetaViewContent(name: string, provider?: string) { track('ViewContent', { content_name: name, content_category: provider }); }
export function trackMetaContact(name: string) { track('Contact', { content_name: name }); }
