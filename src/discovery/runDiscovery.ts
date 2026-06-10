import { crawlWebsite } from './crawler.js';

const map = await crawlWebsite();
console.log(`Discovered ${map.totalPages} pages. Reports written to reports/website-map.*`);
