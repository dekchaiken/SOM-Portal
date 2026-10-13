'use client';
// MA Services Registry — client component with full CRUD.
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Icon } from '@/icons';

interface MAService {
  id: number;
  service_name: string;
  service_type: string;
  tool_type: string;
  can_change_text: string;
  remark: string;
  link_manual: string;
  direct_link: string;
  custom_url: string;
  grafana_link: string;
  opensearch_url: string;
  images: string[];
  backoffice_use_case_id: number | null;
  jenkins_server_id: string;
  jenkins_job_path: string;
  created_at: string;
  updated_at: string;
}

interface ServiceType {
  name: string;
  description: string;
  color: string;
  count: number;
}

const API_BASE = '/v2/api/v1/ma-services';

export function MAServicesClient() {
  const [services, setServices] = useState<MAService[]>([]);
  const [types, setTypes] = useState<ServiceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [toolFilter, setToolFilter] = useState('');
  const [editing, setEditing] = useState<MAService | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [svcRes, typesRes] = await Promise.all([
        fetch(API_BASE),
        fetch(`${API_BASE}/types`),
      ]);
      const svcJson = await svcRes.json();
      const typesJson = await typesRes.json();
      if (svcJson.ok) setServices(svcJson.data);
      if (typesJson.ok) setTypes(typesJson.data);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this service?')) return;
    const res = await fetch(`${API_BASE}/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.ok) fetchData();
    else alert(json.error ?? 'Delete failed');
  };

  const handleSave = async (data: Record<string, unknown>) => {
    setSaving(true);
    try {
      const isEdit = !!data.id;
      const url = isEdit ? `${API_BASE}/${data.id}` : API_BASE;
      const method = isEdit ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (json.ok) {
        setEditing(null);
        setCreating(false);
        fetchData();
      } else {
        alert(json.error ?? 'Save failed');
      }
    } finally {
      setSaving(false);
    }
  };

  const filteredServices = services.filter((s) => {
    if (typeFilter && s.service_type !== typeFilter) return false;
    if (toolFilter && s.tool_type !== toolFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        s.service_name.toLowerCase().includes(q) ||
        s.remark.toLowerCase().includes(q) ||
        String(s.id).includes(q)
      );
    }
    return true;
  });

  const toolTypes = [...new Set(services.map((s) => s.tool_type))].sort();

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <h1 className="text-xl font-semibold">MA Services</h1>
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-md bg-[var(--surface-subtle)]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">MA Services Registry</h1>
          <p className="text-xs text-[var(--text-muted)]">
            {services.length} services registered
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => { setCreating(true); setEditing(null); }}
        >
          <Icon name="plus" size={14} />
          Add Service
        </Button>
      </div>

      {error && (
        <div className="rounded-md bg-[var(--chip-danger-bg)] p-3 text-sm text-[var(--chip-danger-fg)]">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Search by name, remark, or ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-1.5 text-sm"
        >
          <option value="">All Types</option>
          {types.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name} ({t.count})
            </option>
          ))}
        </select>
        <select
          value={toolFilter}
          onChange={(e) => setToolFilter(e.target.value)}
          className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-1.5 text-sm"
        >
          <option value="">All Tools</option>
          {toolTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* Services Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs font-medium text-[var(--text-muted)]">
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Service Name</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Tool</th>
              <th className="px-3 py-2">Jenkins</th>
              <th className="px-3 py-2">BO Use Case</th>
              <th className="px-3 py-2">Updated</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredServices.map((svc) => (
              <tr
                key={svc.id}
                className="border-b border-[var(--border)] hover:bg-[var(--surface-subtle)]"
              >
                <td className="px-3 py-2 font-mono text-xs">{svc.id}</td>
                <td className="px-3 py-2">
                  <div className="font-medium">{svc.service_name}</div>
                  {svc.remark && (
                    <div className="text-xs text-[var(--text-muted)] line-clamp-1">
                      {svc.remark}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Badge variant="info">{svc.service_type}</Badge>
                </td>
                <td className="px-3 py-2">{svc.tool_type}</td>
                <td className="px-3 py-2 text-xs">
                  {svc.jenkins_server_id ? (
                    <span title={svc.jenkins_job_path}>
                      {svc.jenkins_server_id}
                    </span>
                  ) : (
                    <span className="text-[var(--text-muted)]">-</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {svc.backoffice_use_case_id ?? (
                    <span className="text-[var(--text-muted)]">-</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-[var(--text-muted)]">
                  {svc.updated_at}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { setEditing(svc); setCreating(false); }}
                      className="rounded p-1 hover:bg-[var(--surface-subtle)]"
                      title="Edit"
                    >
                      <Icon name="pencil" size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(svc.id)}
                      className="rounded p-1 text-[var(--chip-danger-fg)] hover:bg-[var(--surface-subtle)]"
                      title="Delete"
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredServices.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-[var(--text-muted)]">
            No services found.
          </CardContent>
        </Card>
      )}

      {/* Create/Edit Dialog */}
      {(creating || editing) && (
        <ServiceFormDialog
          service={editing}
          types={types}
          saving={saving}
          onSave={handleSave}
          onClose={() => { setCreating(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

// ── Inline form dialog ──────────────────────────────────────────────────────

function ServiceFormDialog({
  service,
  types,
  saving,
  onSave,
  onClose,
}: {
  service: MAService | null;
  types: ServiceType[];
  saving: boolean;
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const isEdit = !!service;
  const [form, setForm] = useState({
    service_name: service?.service_name ?? '',
    service_type: service?.service_type ?? (types[0]?.name ?? ''),
    tool_type: service?.tool_type ?? 'Jenkins',
    can_change_text: service?.can_change_text ?? '',
    remark: service?.remark ?? '',
    link_manual: service?.link_manual ?? '',
    direct_link: service?.direct_link ?? '',
    custom_url: service?.custom_url ?? '',
    grafana_link: service?.grafana_link ?? '',
    opensearch_url: service?.opensearch_url ?? '',
    backoffice_use_case_id: service?.backoffice_use_case_id ?? '',
    jenkins_server_id: service?.jenkins_server_id ?? '',
    jenkins_job_path: service?.jenkins_job_path ?? '',
  });

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: Record<string, unknown> = { ...form };
    if (isEdit) data.id = service!.id;
    const boId = Number(form.backoffice_use_case_id);
    data.backoffice_use_case_id = boId > 0 ? boId : null;
    onSave(data);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-[var(--surface-card)] p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">
          {isEdit ? 'Edit Service' : 'New Service'}
        </h2>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Service Name" required>
            <input
              value={form.service_name}
              onChange={set('service_name')}
              className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm"
              required
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Service Type">
              <select
                value={form.service_type}
                onChange={set('service_type')}
                className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm"
              >
                {types.map((t) => (
                  <option key={t.name} value={t.name}>{t.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Tool Type">
              <select
                value={form.tool_type}
                onChange={set('tool_type')}
                className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm"
              >
                <option value="Jenkins">Jenkins</option>
                <option value="Backoffice">Backoffice</option>
                <option value="Manual">Manual</option>
                <option value="Other">Other</option>
              </select>
            </Field>
          </div>
          <Field label="Remark">
            <textarea
              value={form.remark}
              onChange={set('remark')}
              rows={2}
              className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Jenkins Server ID">
              <input
                value={form.jenkins_server_id}
                onChange={set('jenkins_server_id')}
                className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm"
              />
            </Field>
            <Field label="Jenkins Job Path">
              <input
                value={form.jenkins_job_path}
                onChange={set('jenkins_job_path')}
                className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm"
              />
            </Field>
          </div>
          <Field label="Backoffice Use Case ID">
            <input
              value={form.backoffice_use_case_id}
              onChange={set('backoffice_use_case_id')}
              type="number"
              className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm"
            />
          </Field>
          <Field label="Direct Link">
            <input
              value={form.direct_link}
              onChange={set('direct_link')}
              className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm"
            />
          </Field>
          <Field label="Manual Link">
            <input
              value={form.link_manual}
              onChange={set('link_manual')}
              className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm"
            />
          </Field>
          <Field label="Grafana Link">
            <input
              value={form.grafana_link}
              onChange={set('grafana_link')}
              className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm"
            />
          </Field>
          <Field label="Can Change Text">
            <select
              value={form.can_change_text}
              onChange={set('can_change_text')}
              className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm"
            >
              <option value="">-</option>
              <option value="YES">YES</option>
              <option value="NO">NO</option>
            </select>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" type="submit" disabled={saving}>
              {saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
        {label}
        {required && <span className="text-[var(--chip-danger-fg)]"> *</span>}
      </span>
      {children}
    </label>
  );
}
