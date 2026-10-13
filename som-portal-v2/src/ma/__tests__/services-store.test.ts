// src/ma/__tests__/services-store.test.ts
// Unit tests for MA service CRUD, status polling, and type schemas.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MAServicesFileSchema,
  MAServiceSchema,
  MAStatusCacheSchema,
  MAStatusHiddenSchema,
  MATypesFileSchema,
  MAModulesFileSchema,
  CreateMAServiceInput,
  UpdateMAServiceInput,
  ToggleMAInput,
  JenkinsTriggerInput,
} from '../types';
import { filterItems, flattenStatusItems } from '../status-poller';

// ── Schema validation tests ─────────────────────────────────────────────────

describe('MAServiceSchema', () => {
  const validService = {
    id: 1,
    service_name: 'Login TrueMoney Wallet',
    service_type: 'TMN',
    tool_type: 'Jenkins',
    can_change_text: 'YES',
    remark: 'test',
    link_manual: '',
    direct_link: '',
    custom_url: '',
    grafana_link: '',
    opensearch_url: '',
    images: [],
    backoffice_use_case_id: null,
    jenkins_server_id: 'TMN-OPS',
    jenkins_job_path: '/job/wallet-maintenance_login',
    created_at: '2026-04-19 20:56:44',
    updated_at: '2026-09-02 14:20:19',
  };

  it('parses a valid service', () => {
    const result = MAServiceSchema.safeParse(validService);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(1);
      expect(result.data.service_name).toBe('Login TrueMoney Wallet');
    }
  });

  it('applies defaults for optional fields', () => {
    const minimal = {
      id: 2,
      service_name: 'Test',
      service_type: 'TMN',
      tool_type: 'Manual',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    };
    const result = MAServiceSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.images).toEqual([]);
      expect(result.data.backoffice_use_case_id).toBeNull();
      expect(result.data.jenkins_server_id).toBe('');
    }
  });

  it('accepts toggle/trigger stamp fields', () => {
    const withStamps = {
      ...validService,
      last_toggled_action: 'enable',
      last_toggled_by: 'usr_dev',
      last_toggled_at: 1700000000,
      last_jenkins_by: 'usr_dev',
      last_jenkins_at: 1700000001,
    };
    const result = MAServiceSchema.safeParse(withStamps);
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = MAServiceSchema.safeParse({ id: 1 });
    expect(result.success).toBe(false);
  });
});

describe('MAServicesFileSchema', () => {
  it('parses a valid file', () => {
    const result = MAServicesFileSchema.safeParse({
      services: [
        {
          id: 1,
          service_name: 'Test',
          service_type: 'TMN',
          tool_type: 'Jenkins',
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        },
      ],
      next_id: 2,
    });
    expect(result.success).toBe(true);
  });

  it('defaults to empty', () => {
    const result = MAServicesFileSchema.safeParse(undefined);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.services).toEqual([]);
      expect(result.data.next_id).toBe(1);
    }
  });
});

describe('CreateMAServiceInput', () => {
  it('validates required fields', () => {
    const r1 = CreateMAServiceInput.safeParse({});
    expect(r1.success).toBe(false);

    const r2 = CreateMAServiceInput.safeParse({
      service_name: 'Test',
      service_type: 'TMN',
      tool_type: 'Jenkins',
    });
    expect(r2.success).toBe(true);
  });
});

describe('UpdateMAServiceInput', () => {
  it('requires id', () => {
    const r = UpdateMAServiceInput.safeParse({ service_name: 'X' });
    expect(r.success).toBe(false);
  });

  it('allows partial updates', () => {
    const r = UpdateMAServiceInput.safeParse({ id: 1, remark: 'new' });
    expect(r.success).toBe(true);
  });
});

describe('ToggleMAInput', () => {
  it('validates action enum', () => {
    const r1 = ToggleMAInput.safeParse({ id: 1, action: 'enable' });
    expect(r1.success).toBe(true);

    const r2 = ToggleMAInput.safeParse({ id: 1, action: 'toggle' });
    expect(r2.success).toBe(false);
  });

  it('enforces reason max length', () => {
    const r = ToggleMAInput.safeParse({
      id: 1,
      action: 'disable',
      reason: 'x'.repeat(501),
    });
    expect(r.success).toBe(false);
  });
});

describe('JenkinsTriggerInput', () => {
  it('validates service_id > 0', () => {
    const r = JenkinsTriggerInput.safeParse({ service_id: 0 });
    expect(r.success).toBe(false);
  });

  it('defaults params to empty', () => {
    const r = JenkinsTriggerInput.safeParse({ service_id: 5 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.params).toEqual({});
  });
});

// ── Types/Modules file schemas ──────────────────────────────────────────────

describe('MATypesFileSchema', () => {
  it('parses v1 shape', () => {
    const r = MATypesFileSchema.safeParse({
      service_types: [
        { name: 'TMN', description: 'TrueMoney', color: 'red' },
        { name: 'NANO', description: 'Nano', color: 'blue' },
      ],
      site_types: [{ name: 'TMN', description: 'TMN Site', color: 'red' }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.service_types).toHaveLength(2);
    }
  });
});

describe('MAModulesFileSchema', () => {
  it('parses v1 shape', () => {
    const r = MAModulesFileSchema.safeParse({
      modules: [
        {
          id: 'usecases',
          name: 'MA Usecases',
          desc: 'Maintenance Services',
          icon: 'MA',
          theme: 'amber',
          enabled: true,
          order: 0,
          builtin: true,
          status: 'active',
        },
      ],
    });
    expect(r.success).toBe(true);
  });
});

// ── Status cache + filtering ────────────────────────────────────────────────

describe('MAStatusCacheSchema', () => {
  it('parses v1 cache shape', () => {
    const r = MAStatusCacheSchema.safeParse({
      ts: 1700000000,
      filter: 'tmn_backoffice',
      payload: {
        sources: {
          tmn_backoffice: {
            ok: true,
            fetched_at: 1700000000,
            items: [
              {
                name: 'bo:123',
                label: 'Test Service',
                use_case_id: 123,
                type: 'tmn_backoffice',
                status: 'open',
                updated_at: '2026-10-01',
                updated_by: 'admin',
                category: 'use_case',
              },
            ],
          },
        },
      },
    });
    expect(r.success).toBe(true);
  });

  it('defaults to empty', () => {
    const r = MAStatusCacheSchema.safeParse(undefined);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.ts).toBe(0);
      expect(r.data.payload.sources).toEqual({});
    }
  });
});

describe('flattenStatusItems', () => {
  const cache = MAStatusCacheSchema.parse({
    ts: 100,
    filter: '',
    payload: {
      sources: {
        src_a: {
          ok: true,
          fetched_at: 100,
          items: [
            { name: 'a1', label: 'A1', type: 'src_a', status: 'open', updated_at: '', updated_by: '', category: '' },
            { name: 'a2', label: 'A2', type: 'src_a', status: 'closed', updated_at: '', updated_by: '', category: '' },
          ],
        },
        src_b: {
          ok: true,
          fetched_at: 100,
          items: [
            { name: 'b1', label: 'B1', type: 'src_b', status: 'open', updated_at: '', updated_by: '', category: '' },
          ],
        },
        src_err: {
          ok: false,
          fetched_at: 100,
          items: [],
          error: 'timeout',
        },
      },
    },
  });

  it('flattens all sources', () => {
    const items = flattenStatusItems(cache);
    expect(items).toHaveLength(3);
  });

  it('filters by source', () => {
    const items = filterItems(cache, {}, 'src_a');
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.type === 'src_a')).toBe(true);
  });

  it('excludes hidden items', () => {
    const hidden = { src_a: ['a1'] };
    const items = filterItems(cache, hidden);
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.name === 'a1')).toBeUndefined();
  });

  it('combines source filter and hidden', () => {
    const hidden = { src_a: ['a2'] };
    const items = filterItems(cache, hidden, 'src_a');
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe('a1');
  });
});

describe('MAStatusHiddenSchema', () => {
  it('parses v1 shape', () => {
    const r = MAStatusHiddenSchema.safeParse({
      nano: [],
      tmn_backoffice: [],
      tmn_features: ['add-mrt-card', 'create-mrt-order'],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.tmn_features).toHaveLength(2);
    }
  });
});
