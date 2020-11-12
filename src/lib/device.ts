import type useragent from 'express-useragent';

export function deviceSummary(ua: useragent.UserAgent): string {
  return [ua.platform, ua.os, ua.browser, ua.isMobile ? `mobile` : `non-mobile`]
    .filter(Boolean)
    .filter((part) => part !== `unknown`)
    .join(` / `);
}
