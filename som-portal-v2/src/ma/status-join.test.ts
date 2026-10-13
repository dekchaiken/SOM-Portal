import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { backofficeItems, joinStatus, normName } from './status-join';

// Real data from the v1 cache and registry. Skipped when the data folder is not present.
const DATA = process.env.DATA_DIR ?? path.resolve(__dirname, '../../../data');
const hasData = fs.existsSync(path.join(DATA, 'sm', 'ma-status-cache.json'));

describe('normName', () => {
  it('drops a leading "disable", lower-cases and strips symbols', () => {
    expect(normName('Disable  Login-Wallet!')).toBe('login wallet');
    expect(normName(null)).toBe('');
  });
});

describe('backofficeItems', () => {
  it('marks ma_enable as closed and keeps the use case id', () => {
    const [a, b] = backofficeItems([
      { use_case_id: 7, use_case_name: 'A', ma_enable: true },
      { use_case_id: 8, use_case_name: 'B', ma_enable: false },
    ]);
    expect(a).toMatchObject({ name: 'bo:7', status: 'closed', use_case_id: 7, type: 'tmn_backoffice' });
    expect(b!.status).toBe('open');
  });
});

describe('joinStatus on the real cache', () => {
  it.skipIf(!hasData)('reproduces the v1 summary from the same inputs', () => {
    const cache = JSON.parse(fs.readFileSync(path.join(DATA, 'sm', 'ma-status-cache.json'), 'utf8'));
    const services = JSON.parse(fs.readFileSync(path.join(DATA, 'sm', 'ma-services.json'), 'utf8')).services;
    const sources = { tmn_backoffice: cache.payload.sources.tmn_backoffice };
    const out = joinStatus(services, sources, cache.payload.sources.tmn_backoffice.fetched_at);
    const v1 = cache.payload.summary;
    expect(out.summary.total).toBe(v1.total);
    expect(out.summary.open).toBe(v1.open);
    expect(out.summary.closed).toBe(v1.closed);
    expect(out.summary.unknown).toBe(v1.unknown);
    expect(out.summary.matched).toBe(v1.matched);
    expect(out.unmapped_backoffice.length).toBe(cache.payload.unmapped_backoffice.length);
  });
});
