export function safeNewsReturn(value: string | null | undefined): string {
  try {
    if (value) {
      const url = new URL(value, window.location.origin);
      if (!/[\\\u0000-\u0020]/.test(value) && url.origin === window.location.origin && !url.username && !url.password && /^\/(?:events(?:\/[^/]+)?|securities(?:\/[^/]+)?|chain|industry\/(?:index\.html)?)\/?$/.test(url.pathname)) return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch { /* Untrusted destinations fall back to the news index. */ }
  return '/events';
}

export function panoramaHref(search: string): string {
  const params = new URLSearchParams(search);
  const industry = params.get('industry') || params.get('industry_id') || '';
  const news = params.get('news') || params.get('event') || '';
  if (industry) params.set('industry', industry);
  else params.delete('industry');
  params.delete('industry_id');
  params.delete('event');
  if (news) params.set('news', news);
  else params.delete('news');
  const fallback = new URLSearchParams();
  if (news) fallback.set('event', news);
  if (news && params.get('progress')) fallback.set('progress', params.get('progress')!);
  params.set('return', safeNewsReturn(params.get('return') || `/events${fallback.size ? `?${fallback}` : ''}`));
  return `/industry/index.html?${params}`;
}
