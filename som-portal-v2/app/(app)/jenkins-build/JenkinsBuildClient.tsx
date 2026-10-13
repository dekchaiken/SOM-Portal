// som-portal-v2/app/(app)/jenkins-build/JenkinsBuildClient.tsx
'use client';

import * as React from 'react';
import { PulseHeader } from '@/ui/PulseHeader';
import { StatusChip, type ChipStatus } from '@/ui/StatusChip';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Badge } from '@/ui/shadcn/badge';
import { Alert, AlertDescription } from '@/ui/shadcn/alert';
import { SkeletonList } from '@/ui/Skeleton';
import { Icon } from '@/icons';
import { cn } from '@/ui/cn';
import { jenkinsApi } from '@/jenkins/ui/api-client';
import {
  JenkinsJobListSchema,
  JenkinsJobDetailSchema,
  parameterDefinitions,
  isTerminalResult,
  type JenkinsParamDef,
} from '@/jenkins/types';

/** Brief: 2s interval, stop on terminal state, hard cap 60 polls. */
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 60;

interface ServerRow {
  id: string;
  display: string;
  base_url: string;
}

interface JobNode {
  name: string;
  /** `/job/a/job/b` — the only shape the build endpoint accepts. */
  path: string;
  isFolder: boolean;
}

function segment(name: string): string {
  return `/job/${encodeURIComponent(name).replace(/%2F/gi, '')}`;
}

function resultToChip(result: string | null | undefined, building?: boolean): ChipStatus {
  if (building) return 'in_progress';
  switch ((result ?? '').toUpperCase()) {
    case 'SUCCESS':
      return 'success';
    case 'FAILURE':
      return 'danger';
    case 'UNSTABLE':
      return 'warning';
    case 'ABORTED':
    case 'NOT_BUILT':
      return 'pending';
    default:
      return 'unknown';
  }
}

export function JenkinsBuildClient() {
  const [servers, setServers] = React.useState<ServerRow[] | null>(null);
  const [serverId, setServerId] = React.useState('');
  const [crumbs, setCrumbs] = React.useState<JobNode[]>([]); // folder breadcrumb
  const [jobs, setJobs] = React.useState<JobNode[] | null>(null);
  const [jobsErr, setJobsErr] = React.useState('');
  const [jobFilter, setJobFilter] = React.useState('');
  const [selected, setSelected] = React.useState<JobNode | null>(null);
  const [params, setParams] = React.useState<JenkinsParamDef[]>([]);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [detailErr, setDetailErr] = React.useState('');
  const [loadingDetail, setLoadingDetail] = React.useState(false);
  const [triggering, setTriggering] = React.useState(false);
  const [notice, setNotice] = React.useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [poll, setPoll] = React.useState<{
    count: number;
    build: { number: number; result: string | null; building?: boolean; url?: string } | null;
    done: boolean;
  } | null>(null);

  // ── Pane 1: servers ────────────────────────────────────────────────────────
  React.useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await jenkinsApi.listServers();
      if (!alive) return;
      if (r.ok) {
        setServers(r.data);
        if (r.data.length && r.data[0]) setServerId(r.data[0].id);
      } else {
        setServers([]);
        setJobsErr(r.error);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const folderPath = crumbs.map((c) => segment(c.name)).join('');

  // ── Pane 2: jobs at the current folder level ───────────────────────────────
  const loadJobs = React.useCallback(async (sid: string, prefix: string) => {
    setJobs(null);
    setJobsErr('');
    const r = await jenkinsApi.read<unknown>(sid, `${prefix}/api/json`, {
      tree: 'jobs[name,color,_class]',
    });
    if (!r.ok) {
      setJobs([]);
      setJobsErr(r.error);
      return;
    }
    const parsed = JenkinsJobListSchema.safeParse(r.data);
    if (!parsed.success) {
      setJobs([]);
      setJobsErr('Unexpected Jenkins payload');
      return;
    }
    setJobs(
      parsed.data.jobs.map((j) => ({
        name: j.name,
        path: `${prefix}${segment(j.name)}`,
        isFolder: /Folder|WorkflowMultiBranchProject|OrganizationFolder/i.test(j._class ?? ''),
      })),
    );
  }, []);

  React.useEffect(() => {
    if (!serverId) return;
    setSelected(null);
    setParams([]);
    setValues({});
    setPoll(null);
    void loadJobs(serverId, folderPath);
  }, [serverId, folderPath, loadJobs]);

  // ── Pane 3: parameters for the selected job ────────────────────────────────
  async function selectJob(job: JobNode) {
    if (job.isFolder) {
      setCrumbs((c) => [...c, job]);
      return;
    }
    setSelected(job);
    setDetailErr('');
    setNotice(null);
    setPoll(null);
    setLoadingDetail(true);
    const r = await jenkinsApi.read<unknown>(serverId, `${job.path}/api/json`, {
      tree: 'name,displayName,buildable,description,property[parameterDefinitions[name,type,description,choices,defaultParameterValue[value]]],builds[number,result,timestamp,duration,url,building]{0,5}',
    });
    setLoadingDetail(false);
    if (!r.ok) {
      setParams([]);
      setDetailErr(r.error);
      return;
    }
    const parsed = JenkinsJobDetailSchema.safeParse(r.data);
    if (!parsed.success) {
      setParams([]);
      setDetailErr('Unexpected Jenkins payload');
      return;
    }
    const defs = parameterDefinitions(parsed.data);
    setParams(defs);
    setValues(
      Object.fromEntries(
        defs.map((d) => [d.name, String(d.defaultParameterValue?.value ?? '')]),
      ),
    );
  }

  // ── Trigger + poll ─────────────────────────────────────────────────────────
  async function trigger() {
    if (!selected) return;
    setTriggering(true);
    setNotice(null);
    const r = await jenkinsApi.build(serverId, selected.path, params.length ? values : null);
    setTriggering(false);
    if (!r.ok) {
      setNotice({ kind: 'err', text: r.error });
      return;
    }
    setNotice({
      kind: 'ok',
      text: r.data.queue_id
        ? `Build queued (queue item #${r.data.queue_id})`
        : 'Build queued successfully',
    });
    setPoll({ count: 0, build: null, done: false });
  }

  // Status polling: 2s, stop on terminal result, never exceed MAX_POLLS.
  React.useEffect(() => {
    if (!poll || poll.done || !selected) return;
    if (poll.count >= MAX_POLLS) {
      setPoll((p) => (p ? { ...p, done: true } : p));
      return;
    }
    const t = setTimeout(async () => {
      const r = await jenkinsApi.read<unknown>(serverId, `${selected.path}/api/json`, {
        tree: 'builds[number,result,timestamp,duration,url,building]{0,1}',
      });
      const parsed = r.ok ? JenkinsJobDetailSchema.safeParse(r.data) : null;
      const latest = parsed?.success ? (parsed.data.builds[0] ?? null) : null;
      setPoll((p) => {
        if (!p) return p;
        const done = !!latest && !latest.building && isTerminalResult(latest.result);
        return {
          count: p.count + 1,
          build: latest
            ? {
                number: latest.number,
                result: latest.result ?? null,
                building: latest.building,
                url: latest.url,
              }
            : p.build,
          done,
        };
      });
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(t);
  }, [poll, selected, serverId]);

  const visibleJobs = React.useMemo(() => {
    if (!jobs) return null;
    const f = jobFilter.trim().toLowerCase();
    return f ? jobs.filter((j) => j.name.toLowerCase().includes(f)) : jobs;
  }, [jobs, jobFilter]);

  const activeServer = servers?.find((s) => s.id === serverId) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <PulseHeader
        title="Jenkins Build"
        subtitle={
          activeServer
            ? `${activeServer.display} · ${activeServer.base_url}`
            : 'Pick a server, choose a job, fill parameters, trigger'
        }
        live={!!poll && !poll.done}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadJobs(serverId, folderPath)}
            disabled={!serverId}
          >
            <Icon name="refresh" size={14} /> Reload jobs
          </Button>
        }
      />

      {/* Command Center 3-column grid, à la service-performance.html */}
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))] lg:[grid-template-columns:16rem_minmax(0,1fr)_22rem]">
        {/* ── Pane 1 — servers ─────────────────────────────────────────────── */}
        <section
          aria-label="Jenkins servers"
          className="rounded-[var(--radius-card,10px)] border p-3"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}
        >
          <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            <Icon name="server" size={13} /> Servers
          </h2>
          {servers === null ? (
            <SkeletonList rows={4} />
          ) : servers.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">
              No enabled servers for your team.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {servers.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setServerId(s.id);
                      setCrumbs([]);
                    }}
                    className={cn(
                      'w-full truncate rounded-[var(--radius)] px-2 py-1.5 text-left text-sm',
                      "font-[inherit]",
                      serverId === s.id
                        ? 'bg-[var(--bg-active,var(--bg-raised))] font-medium text-[var(--text-strong)]'
                        : 'text-[var(--text)] hover:bg-[var(--bg-raised)]',
                    )}
                    title={s.base_url}
                  >
                    {s.display}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Pane 2 — jobs ────────────────────────────────────────────────── */}
        <section
          aria-label="Jobs"
          className="min-w-0 rounded-[var(--radius-card,10px)] border p-3"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
              <Icon name="hammer" size={13} /> Jobs
            </h2>
            <Input
              value={jobFilter}
              onChange={(e) => setJobFilter(e.target.value)}
              placeholder="Filter jobs…"
              aria-label="Filter jobs"
              className="h-8 w-44 text-xs"
            />
          </div>

          {/* breadcrumb for folder drill-down */}
          <nav className="mb-2 flex flex-wrap items-center gap-1 text-xs text-[var(--text-muted)]">
            <button
              type="button"
              className="font-[inherit] underline-offset-2 hover:underline"
              onClick={() => setCrumbs([])}
            >
              root
            </button>
            {crumbs.map((c, i) => (
              <React.Fragment key={c.path}>
                <Icon name="chevron-right" size={11} />
                <button
                  type="button"
                  className="font-[inherit] underline-offset-2 hover:underline"
                  onClick={() => setCrumbs((cur) => cur.slice(0, i + 1))}
                >
                  {c.name}
                </button>
              </React.Fragment>
            ))}
          </nav>

          {jobsErr ? (
            <Alert variant="destructive">
              <AlertDescription>{jobsErr}</AlertDescription>
            </Alert>
          ) : visibleJobs === null ? (
            <SkeletonList rows={8} />
          ) : visibleJobs.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">No jobs here.</p>
          ) : (
            <ul className="max-h-[26rem] overflow-y-auto">
              {visibleJobs.map((j) => (
                <li key={j.path}>
                  <button
                    type="button"
                    onClick={() => void selectJob(j)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-[var(--radius)] px-2 py-1.5 text-left text-sm',
                      'font-[inherit]',
                      selected?.path === j.path
                        ? 'bg-[var(--bg-active,var(--bg-raised))] font-medium'
                        : 'hover:bg-[var(--bg-raised)]',
                    )}
                  >
                    <Icon name={j.isFolder ? 'layers' : 'circle-dot'} size={13} />
                    <span className="min-w-0 flex-1 truncate">{j.name}</span>
                    {j.isFolder ? <Icon name="chevron-right" size={12} /> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Pane 3 — params + trigger ────────────────────────────────────── */}
        <section
          aria-label="Parameters"
          className="min-w-0 rounded-[var(--radius-card,10px)] border p-3"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}
        >
          <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            <Icon name="play" size={13} /> Trigger
          </h2>

          {!selected ? (
            <p className="text-xs text-[var(--text-muted)]">
              Select a job to see its parameters.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="break-all text-sm font-medium text-[var(--text-strong)]">
                {selected.name}
              </p>
              <code className="break-all text-[11px] text-[var(--text-muted)]">
                {selected.path}
              </code>

              {detailErr ? (
                <Alert variant="destructive">
                  <AlertDescription>{detailErr}</AlertDescription>
                </Alert>
              ) : loadingDetail ? (
                <SkeletonList rows={3} />
              ) : params.length === 0 ? (
                <Badge variant="neutral">No parameters</Badge>
              ) : (
                <div className="flex flex-col gap-2">
                  {params.map((p) => (
                    <label key={p.name} className="flex flex-col gap-1 text-xs">
                      <span className="font-medium text-[var(--text)]">{p.name}</span>
                      {p.choices?.length ? (
                        <select
                          value={values[p.name] ?? ''}
                          onChange={(e) =>
                            setValues((v) => ({ ...v, [p.name]: e.target.value }))
                          }
                          className="h-8 rounded-[var(--radius)] border px-2 font-[inherit] text-xs"
                          style={{
                            borderColor: 'var(--border)',
                            background: 'var(--bg-input,var(--bg-card))',
                            color: 'var(--text)',
                          }}
                        >
                          {p.choices.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          value={values[p.name] ?? ''}
                          onChange={(e) =>
                            setValues((v) => ({ ...v, [p.name]: e.target.value }))
                          }
                          className="h-8 text-xs"
                        />
                      )}
                      {p.description ? (
                        <span className="text-[11px] text-[var(--text-muted)]">
                          {p.description}
                        </span>
                      ) : null}
                    </label>
                  ))}
                </div>
              )}

              <Button onClick={() => void trigger()} disabled={triggering || !!detailErr}>
                {triggering ? (
                  <Icon name="loader" size={14} className="animate-spin" />
                ) : (
                  <Icon name="play" size={14} />
                )}
                {triggering ? 'Triggering…' : 'Trigger build'}
              </Button>

              {notice ? (
                <Alert variant={notice.kind === 'ok' ? 'success' : 'destructive'}>
                  <AlertDescription>{notice.text}</AlertDescription>
                </Alert>
              ) : null}

              {poll ? (
                <div
                  className="rounded-[var(--radius)] border p-2 text-xs"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[var(--text-muted)]">
                      Polling {poll.count}/{MAX_POLLS}
                    </span>
                    <StatusChip
                      status={resultToChip(poll.build?.result, poll.build?.building)}
                      label={
                        poll.build?.building
                          ? 'Building'
                          : (poll.build?.result ?? 'Queued')
                      }
                    />
                  </div>
                  {poll.build ? (
                    <p className="text-[var(--text-muted)]">
                      Build #{poll.build.number}
                      {poll.done ? ' — final' : ''}
                    </p>
                  ) : (
                    <p className="text-[var(--text-muted)]">Waiting for Jenkins to start…</p>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
