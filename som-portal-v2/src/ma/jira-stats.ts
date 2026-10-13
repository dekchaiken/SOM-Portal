// som-portal-v2/src/ma/jira-stats.ts
// Read Jira stats per MA service per year.
// Port of api/ma-services/jira-stats.php.
import { readSharedFile } from '@/team/scope';
import { JiraStatsFileSchema, type JiraStatsFile } from './types';

/** Read yearly Jira stats file (e.g. ma-services-jira-stats-2026.json). */
export async function readJiraStats(year: number): Promise<JiraStatsFile> {
  const file = `ma-services-jira-stats-${year}.json`;
  return readSharedFile(file, JiraStatsFileSchema);
}
