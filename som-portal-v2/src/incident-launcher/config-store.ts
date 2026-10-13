// som-portal-v2/src/incident-launcher/config-store.ts
// Read/write incident-launcher-config.json (team-scoped via readTeamFile).

import { readTeamFile } from "@/team/scope";
import { IncidentConfigSchema, type IncidentConfig } from "./types";

const FILE = "incident-launcher-config.json";

export async function getIncidentConfig(): Promise<IncidentConfig> {
  return readTeamFile(FILE, IncidentConfigSchema);
}
