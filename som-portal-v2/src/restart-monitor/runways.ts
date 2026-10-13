// src/restart-monitor/runways.ts
// Read grafana-runways.json (SM-shared) and resolve runway configs.
import { readSharedFile } from '@/team/scope';
import { RunwaysFile, type RunwayConfig } from './types';

export async function listRunways(): Promise<RunwayConfig[]> {
  const file = await readSharedFile('grafana-runways.json', RunwaysFile);
  return file.runways;
}

export async function findRunway(name: string): Promise<RunwayConfig | null> {
  const runways = await listRunways();
  return runways.find((r) => r.name === name) ?? null;
}

export async function findRunwayBySlug(slug: string): Promise<RunwayConfig | null> {
  const runways = await listRunways();
  return runways.find((r) => r.slug === slug) ?? null;
}

export function slugForRunway(runways: RunwayConfig[], name: string): string {
  return runways.find((r) => r.name === name)?.slug ?? '';
}
