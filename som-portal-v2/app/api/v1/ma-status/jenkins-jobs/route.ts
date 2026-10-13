// GET/POST /api/v1/ma-status/jenkins-jobs — Jenkins job list for MA Status
// Port of api/ma-status/jenkins-jobs.php
import { type NextRequest } from 'next/server';
import { requireRole, ADMIN_ROLES } from '@/auth/policy';
import { handle, jsonOk, jsonErr } from '@/jenkins/route-helpers';
import { readTeamFile, writeTeamFile } from '@/team/scope';
import { logActivity } from '@/logging/activity';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JENKINS_FILE = 'ma-status-jenkins.json';

const JenkinsJobSchema = z.object({
  label: z.string().min(1),
  server: z.string().min(1),
  path: z.string().min(1),
  state_param: z.string().min(1),
  on_values: z.array(z.union([z.string(), z.number(), z.boolean()])).min(1),
  critical: z.boolean().default(false),
  extra_param: z.string().nullable().default(null),
  note: z.string().nullable().default(null),
});

const JenkinsJobsFileSchema = z.array(JenkinsJobSchema).default([]);
type JenkinsJob = z.infer<typeof JenkinsJobSchema>;

/** Hardcoded default job list (matches v1 _lib.php ma_default_jenkins_jobs). */
function defaultJobs(): JenkinsJob[] {
  return [
    {
      label: 'Wallet Login MA',
      server: 'TMN-OPS',
      path: '/view/V1%20Maintenance%20page/job/wallet-maintenance_login',
      state_param: 'IS_MAINTENANCE',
      on_values: ['1', 'true', 'True'],
      critical: true,
      extra_param: null,
      note: null,
    },
    {
      label: 'Register SAVING Service',
      server: 'TMN-OPS',
      path: '/view/V1%20Maintenance%20page/job/maintenance-register-SAVING-SERVICE',
      state_param: 'IS_MAINTENANCE',
      on_values: ['true', 'True', '1'],
      critical: false,
      extra_param: null,
      note: null,
    },
    {
      label: 'SAVING Service',
      server: 'TMN-OPS',
      path: '/view/V1%20Maintenance%20page/job/maintenance-SAVING-SERVICE',
      state_param: 'IS_MAINTENANCE',
      on_values: ['true', 'True', '1'],
      critical: false,
      extra_param: null,
      note: null,
    },
    {
      label: 'TMN Mobile Gateway Feature Toggle (last set)',
      server: 'TMN-OPS',
      path: '/view/Config%20Service/job/acm-tmn-mobile-gateway-feature-toggle',
      state_param: 'enable_feature',
      on_values: ['false', 'False', '0'],
      critical: false,
      extra_param: 'feature_name',
      note: 'Shows last feature toggle set; ground truth in acm-config-server',
    },
  ];
}

export async function GET(): Promise<Response> {
  return handle(async () => {
    await requireRole(...ADMIN_ROLES);

    const override = await readTeamFile(JENKINS_FILE, JenkinsJobsFileSchema);
    const isOverride = override.length > 0;

    return jsonOk({
      jobs: isOverride ? override : defaultJobs(),
      source: isOverride ? 'override' : 'default',
    });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(async () => {
    const session = await requireRole(...ADMIN_ROLES);

    const body = await req.json();
    const jobs = body?.jobs;
    if (!Array.isArray(jobs)) {
      return jsonErr('jobs must be an array', 400);
    }

    // Empty array -> clear override, revert to defaults
    if (jobs.length === 0) {
      await writeTeamFile(JENKINS_FILE, [], JenkinsJobsFileSchema);
      await logActivity({
        user: session.sub,
        team: session.team,
        action: 'ma_status_jobs_reset',
        meta: { count: 0 },
      });
      return jsonOk({ jobs: defaultJobs(), source: 'default', reset: true });
    }

    // Validate each entry
    const clean: JenkinsJob[] = [];
    for (let i = 0; i < jobs.length; i++) {
      const parsed = JenkinsJobSchema.safeParse(jobs[i]);
      if (!parsed.success) {
        const msg = parsed.error.issues[0]?.message ?? 'Invalid entry';
        return jsonErr(`Job #${i}: ${msg}`, 400);
      }
      clean.push(parsed.data);
    }

    await writeTeamFile(JENKINS_FILE, clean, JenkinsJobsFileSchema);

    await logActivity({
      user: session.sub,
      team: session.team,
      action: 'ma_status_jobs_saved',
      meta: { count: clean.length },
    });

    return jsonOk({ jobs: clean, source: 'override', saved: clean.length });
  });
}
