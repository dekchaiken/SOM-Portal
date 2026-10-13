// app/api/service-performance/refresh/route.ts
// POST ?service=X&runway=Y: manual cache invalidation trigger (admin only)
// Matches v1 api/service-performance/refresh.php
import { type NextRequest, NextResponse } from 'next/server';
import { requireRole, ADMIN_ROLES } from '@/auth/policy';
import { __clearMemCache } from '@/service-performance/cache';
import { getEnabledSources } from '@/service-performance/sources';
import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDirAbsolute } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Remove disk cache files for a specific source slug, or all if no slug. */
async function invalidateDiskCache(slug?: string): Promise<void> {
  const dir = path.join(dataDirAbsolute(), 'sm', 'service-performance', 'cache');
  try {
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      // If a slug is provided, only remove cache files that start with that slug
      if (slug && !file.startsWith(slug.replace(/[^a-z0-9._-]/gi, '_'))) continue;
      await fs.unlink(path.join(dir, file)).catch(() => {});
    }
  } catch {
    // Cache directory may not exist yet — nothing to invalidate
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    await requireRole(...ADMIN_ROLES);
    const q = new URL(req.url).searchParams;
    const service = q.get('service') ?? '';
    const runway = q.get('runway') ?? '';

    // Clear in-memory cache (all keys — process-wide)
    __clearMemCache();

    // Clear disk cache for the specified runway/source or all
    if (runway) {
      const sources = await getEnabledSources(runway);
      for (const src of sources) {
        await invalidateDiskCache(src.slug);
      }
    } else {
      await invalidateDiskCache();
    }

    return NextResponse.json({
      success: true,
      data: {
        message: 'Cache refreshed',
        service: service || undefined,
        runway: runway || undefined,
      },
    });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json(
      { success: false, message: (e as Error).message },
      { status },
    );
  }
}
