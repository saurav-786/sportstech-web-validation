import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

export const options = {
  scenarios: {
    smoke_10: { executor: 'constant-vus', vus: 10, duration: '1m' },
    load_50: { executor: 'constant-vus', vus: 50, duration: '2m', startTime: '1m10s' },
    stress_100: { executor: 'constant-vus', vus: 100, duration: '2m', startTime: '3m20s' },
    spike_500: { executor: 'constant-vus', vus: 500, duration: '1m', startTime: '5m30s' }
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000']
  }
};

const baseUrl = __ENV.BASE_URL || 'https://www.sportstech.de/';
const responseTime = new Trend('site_response_time');
const errorRate = new Rate('site_error_rate');

export default function () {
  const response = http.get(baseUrl);
  responseTime.add(response.timings.duration);
  errorRate.add(response.status >= 400);
  check(response, {
    'status is 2xx or 3xx': (res) => res.status >= 200 && res.status < 400,
    'body is not blank': (res) => res.body && res.body.length > 100
  });
  sleep(1);
}

export function handleSummary(data) {
  return {
    'reports/performance-report.json': JSON.stringify(data, null, 2),
    stdout: `Performance summary written to reports/performance-report.json\n`
  };
}
