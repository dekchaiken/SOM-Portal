// som-portal-v2/src/opensearch/__tests__/normalize.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeHit, parseStatus, parseLatency, readTotal } from '../normalize';

describe('parseStatus', () => {
  it('extracts status_code from REST line', () => {
    expect(parseStatus('POST /api/pay status_code: [200]')).toBe(200);
    expect(parseStatus('http_status=404 not found')).toBe(404);
    expect(parseStatus('responseStatus=503')).toBe(503);
    expect(parseStatus('HTTP/1.1 302 Found')).toBe(302);
  });

  it('returns null when no status found', () => {
    expect(parseStatus('just a normal log line')).toBeNull();
    expect(parseStatus('')).toBeNull();
  });
});

describe('parseLatency', () => {
  it('extracts Response time = X ms', () => {
    expect(parseLatency('Response time = 1376 ms')).toBe(1376);
  });

  it('extracts [X ms] pattern', () => {
    expect(parseLatency('request completed [1378 ms]')).toBe(1378);
  });

  it('returns null when no latency found', () => {
    expect(parseLatency('no latency info here')).toBeNull();
  });
});

describe('normalizeHit', () => {
  it('normalizes a standard OpenSearch hit', () => {
    const hit = {
      _id: 'doc123',
      _index: 'logstash-tmn-prod-applog-2026.10',
      _source: {
        '@timestamp': '2026-10-12T10:30:00.000Z',
        Module: 'payment-core',
        Log_Level: 'ERROR',
        CORRELATION_ID: 'TMG-abc123',
        REST: 'POST /api/pay status_code: [500] Response time = 1200 ms',
        Host: 'pod-abc-123',
        kubernetes: { pod_name: 'payment-core-xyz', namespace_name: 'production' },
      },
    };

    const result = normalizeHit(hit);
    expect(result.id).toBe('doc123');
    expect(result.module).toBe('payment-core');
    expect(result.log_level).toBe('ERROR');
    expect(result.correlation_id).toBe('TMG-abc123');
    expect(result.status_code).toBe(500);
    expect(result.latency_ms).toBe(1200);
    expect(result.pod).toBe('payment-core-xyz');
    expect(result.namespace).toBe('production');
  });

  it('handles missing fields gracefully', () => {
    const hit = { _id: 'doc456', _source: {} };
    const result = normalizeHit(hit);
    expect(result.id).toBe('doc456');
    expect(result.module).toBe('');
    expect(result.status_code).toBeNull();
    expect(result.latency_ms).toBeNull();
    expect(result.pod).toBe('');
  });
});

describe('readTotal', () => {
  it('handles {value, relation} format', () => {
    const data = { hits: { total: { value: 5000, relation: 'gte' } } };
    expect(readTotal(data)).toEqual({ total: 5000, relation: 'gte' });
  });

  it('handles integer format', () => {
    const data = { hits: { total: 42 } };
    expect(readTotal(data)).toEqual({ total: 42, relation: 'eq' });
  });

  it('handles missing total', () => {
    expect(readTotal({})).toEqual({ total: 0, relation: 'eq' });
  });
});
