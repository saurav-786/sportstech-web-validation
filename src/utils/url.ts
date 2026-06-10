export function normalizeUrl(rawUrl: string, baseUrl: string): string | null {
  try {
    const url = new URL(rawUrl, baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    url.searchParams.sort();
    return url.toString();
  } catch {
    return null;
  }
}

import type { PageCategory } from '../types.js';

const categoryRules: Array<[PageCategory, RegExp]> = [
  ['cart', /\/(cart|warenkorb|basket)\b/i],
  ['checkout', /\/(checkout|kasse|payment)\b/i],
  ['login', /\/(login|signin|anmelden|register|signup)\b/i],
  ['account', /\/(account|konto|profile|my-)/i],
  ['blog', /\/(blog|news|magazin|article|ratgeber|guide)\b/i],
  ['support', /\/(support|help|hilfe|faq|contact|kontakt|service)\b/i],
  ['legal', /\/(impressum|privacy|datenschutz|agb|terms|legal|widerruf|cookie)\b/i],
  ['search', /\/(search|suche)\b|[?&](q|query|s)=/i],
  ['product', /\/(products?|produkt|p)\/|\/[a-z0-9-]+-(f\d+|\d{3,})\/?$/i],
  ['category', /\/(collections?|category|kategorie|c)\/|\/(laufband|bikes-ergometer|rudergeraet|krafttraining|vibration|zubehoer)/i],
  ['landing', /\/(lp|landing|sale|angebote|deals|black-friday)\b/i]
];

export function categorizeUrl(url: string, baseUrl: string): PageCategory {
  try {
    const u = new URL(url);
    const base = new URL(baseUrl);
    if (u.pathname === '/' || u.href === base.href) return 'home';
    for (const [category, pattern] of categoryRules) {
      if (pattern.test(u.pathname + u.search)) return category;
    }
    return 'other';
  } catch {
    return 'other';
  }
}

export function isIgnoredPath(url: string, ignoredPaths: string[]): boolean {
  try {
    const { pathname } = new URL(url);
    return ignoredPaths.some((ignored) => ignored && pathname.startsWith(ignored));
  } catch {
    return false;
  }
}

export function isInternalUrl(candidate: string, baseUrl: string): boolean {
  const candidateUrl = new URL(candidate);
  const base = new URL(baseUrl);
  return candidateUrl.hostname === base.hostname || candidateUrl.hostname.endsWith(`.${base.hostname}`);
}
