// som-portal-v2/src/opensearch/__tests__/dsl.test.ts
// DSL builder tests — ensure typed params produce the v1 contract shape.
import { describe, it, expect } from 'vitest';
import { buildSearchDsl, buildTraceDsl, parseTimeRange } from '../dsl';
import { SearchParamsSchema } from '../schema';

describe('parseTimeRange', () => {
  it('returns correct interval for 5m preset', () => {
    const { interval } = parseTimeRange({ range: 'last_5m' });
    expect(interval).toBe('30s');
  });

  it('returns correct interval for 1h preset', () => {
    const { interval } = parseTimeRange({ range: 'last_1h' });
    expect(interval).toBe('2m');
  });

  it('returns correct interval for 7d preset', () => {
    const { interval } = parseTimeRange({ range: 'last_7d' });
    expect(interval).toBe('12h');
  });

  it('uses start/end when provided', () => {
    const start = '2026-10-01T00:00:00Z';
    const end = '2026-10-01T01:00:00Z';
    const { gte, lte, interval } = parseTimeRange({ range: 'last_15m', start, end });
    expect(gte).toBe(Date.parse(start));
    expect(lte).toBe(Date.parse(end));
    expect(interval).toBe('2m'); // 1h span
  });

  it('throws on invalid start/end', () => {
    expect(() => parseTimeRange({ range: 'last_15m', start: 'bad', end: 'worse' })).toThrow();
  });
});

describe('buildSearchDsl', () => {
  it('builds a valid DSL with module and level filters', () => {
    const input = SearchParamsSchema.parse({
      endpoint_id: 'os_1',
      module: 'payment-core',
      log_level: 'ERROR',
      range: 'last_1h',
    });
    const dsl = buildSearchDsl(input);

    expect(dsl).toMatchObject({
      size: 200,
      from: 0,
      sort: [{ '@timestamp': { order: 'desc' } }],
      track_total_hits: 10000,
      timeout: '30s',
    });

    // @timestamp + module + level = 3 filters
    const filters = (dsl.query as Record<string, unknown> as { bool: { filter: unknown[] } }).bool.filter;
    expect(filters).toHaveLength(3);
  });

  it('includes query_string for q param', () => {
    const input = SearchParamsSchema.parse({
      endpoint_id: 'os_1',
      q: 'payment failed',
      range: 'last_15m',
    });
    const dsl = buildSearchDsl(input);
    const must = (dsl.query as Record<string, unknown> as { bool: { must: unknown[] } }).bool.must;
    expect(must).toHaveLength(1);
    expect(must[0]).toMatchObject({
      query_string: {
        query: 'payment failed',
        default_field: 'REST',
        analyze_wildcard: true,
        lenient: true,
      },
    });
  });

  it('includes regexp for regexp_rest param', () => {
    const input = SearchParamsSchema.parse({
      endpoint_id: 'os_1',
      regexp_rest: '[4-5][0-9]{2}',
      range: 'last_15m',
    });
    const dsl = buildSearchDsl(input);
    const must = (dsl.query as Record<string, unknown> as { bool: { must: unknown[] } }).bool.must;
    expect(must).toHaveLength(1);
    expect(must[0]).toMatchObject({
      regexp: { REST: { value: '[4-5][0-9]{2}', flags: 'ALL', case_insensitive: true } },
    });
  });

  it('includes histogram and top_pods aggs', () => {
    const input = SearchParamsSchema.parse({
      endpoint_id: 'os_1',
      range: 'last_15m',
    });
    const dsl = buildSearchDsl(input);
    expect(dsl.aggs).toBeDefined();
    const aggs = dsl.aggs as Record<string, unknown>;
    expect(aggs.histogram).toBeDefined();
    expect(aggs.top_pods).toBeDefined();
  });

  it('clamps size and from', () => {
    const input = SearchParamsSchema.parse({
      endpoint_id: 'os_1',
      range: 'last_15m',
      size: 500,
      from: 100,
    });
    const dsl = buildSearchDsl(input);
    expect(dsl.size).toBe(500);
    expect(dsl.from).toBe(100);
  });
});

describe('buildTraceDsl', () => {
  it('builds a trace DSL with correlation_id filter', () => {
    const dsl = buildTraceDsl('TMG-abc123', {
      range: 'last_1h',
      size: 500,
    });

    expect(dsl.sort).toEqual([{ '@timestamp': { order: 'asc' } }]);
    expect(dsl.track_total_hits).toBe(5000);
    expect(dsl.size).toBe(500);

    // Should have by_module agg
    const aggs = dsl.aggs as Record<string, unknown>;
    expect(aggs.by_module).toBeDefined();
  });

  it('extends lte by 90s for log-shipping skew', () => {
    const now = Date.now();
    const dsl = buildTraceDsl('CID-1', { range: 'last_5m', size: 100 });
    const filter = ((dsl.query as Record<string, unknown>).bool as Record<string, unknown>).filter as Array<Record<string, unknown>>;
    const rangeFilter = filter[0] as { range: { '@timestamp': { lte: number } } };
    // lte should be roughly now + 90s (within a few seconds of test execution)
    expect(rangeFilter.range['@timestamp'].lte).toBeGreaterThan(now + 85_000);
  });
});
