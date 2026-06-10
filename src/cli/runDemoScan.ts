const defaults: Record<string, string> = {
  DEMO_MODE: '1',
  MAX_PAGES: '5',
  CRAWL_DEPTH: '2',
  DEVICE_SET: 'desktop',
  BROWSERS: 'chromium',
  REQUEST_TIMEOUT_MS: '30000',
  MAX_LINK_CHECKS: '80',
  MAX_CONTROL_CHECKS: '20',
  MAX_TAB_CHECKS: '8',
  SCAN_TIMEOUT_MS: '900000'
};

for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ??= value;
}

if (!process.argv.includes('--headed')) {
  process.argv.push('--headed');
}

await import('./runScan.js');
