// som-portal-v2/src/opensearch/saved-searches.ts
// CRUD for team-shared saved search presets + folders.
import { randomBytes } from 'node:crypto';
import type { Session } from '@/auth/session';
import { readTeamFile, writeTeamFile } from '@/team/scope';
import { logActivity } from '@/logging/activity';
import {
  SavedSearchesFileSchema,
  SavedFoldersFileSchema,
  type SavedSearch,
  type SavedFolder,
} from './schema';

const SEARCHES_FILE = 'opensearch_saved_searches.json';
const FOLDERS_FILE = 'opensearch_saved_folders.json';

function genId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

// ─── Saved searches ─────────────────────────────────────────────────────────

export async function listSavedSearches(): Promise<SavedSearch[]> {
  const searches = await readTeamFile(SEARCHES_FILE, SavedSearchesFileSchema);
  return searches.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

export async function createSavedSearch(
  session: Session,
  name: string,
  params: Record<string, unknown>,
  folderId?: string | null,
): Promise<SavedSearch> {
  const searches = await readTeamFile(SEARCHES_FILE, SavedSearchesFileSchema);
  if (searches.length >= 200) {
    throw new Error('Maximum 200 shared saved searches reached');
  }

  // Validate folder exists if specified
  if (folderId) {
    const folders = await readTeamFile(FOLDERS_FILE, SavedFoldersFileSchema);
    if (!folders.some((f) => f.id === folderId)) {
      throw new Error('folder_id does not exist');
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const userName = session.username ?? session.sub;
  const entry: SavedSearch = {
    id: genId('ss'),
    name,
    folder_id: folderId ?? null,
    params: params as SavedSearch['params'],
    created_by: session.sub,
    created_by_name: userName,
    created_at: now,
    updated_by: session.sub,
    updated_by_name: userName,
    updated_at: now,
    history: [{ action: 'create', by: session.sub, by_name: userName, at: now, changes: [] }],
  };
  searches.push(entry);
  await writeTeamFile(SEARCHES_FILE, searches, SavedSearchesFileSchema);
  await logActivity({
    user: session.sub,
    team: session.team,
    action: 'opensearch_saved_search_create',
    meta: { id: entry.id, name },
  });
  return entry;
}

export async function updateSavedSearch(
  session: Session,
  id: string,
  updates: { name?: string; params?: Record<string, unknown>; folder_id?: string | null },
): Promise<SavedSearch> {
  const searches = await readTeamFile(SEARCHES_FILE, SavedSearchesFileSchema);
  const idx = searches.findIndex((s) => s.id === id);
  if (idx < 0) throw new Error('Saved search not found');

  const item = searches[idx];
  const changes: Array<Record<string, unknown>> = [];

  if (updates.name !== undefined && updates.name !== item.name) {
    changes.push({ field: 'name', from: item.name, to: updates.name });
    item.name = updates.name;
  }
  if (updates.folder_id !== undefined && updates.folder_id !== item.folder_id) {
    if (updates.folder_id) {
      const folders = await readTeamFile(FOLDERS_FILE, SavedFoldersFileSchema);
      if (!folders.some((f) => f.id === updates.folder_id)) {
        throw new Error('folder_id does not exist');
      }
    }
    changes.push({ field: 'folder_id', from: item.folder_id, to: updates.folder_id });
    item.folder_id = updates.folder_id;
  }
  if (updates.params !== undefined) {
    item.params = updates.params as SavedSearch['params'];
    changes.push({ field: 'params', from: 'previous', to: 'updated' });
  }

  if (changes.length === 0) throw new Error('No changes provided');

  const now = Math.floor(Date.now() / 1000);
  const userName = session.username ?? session.sub;
  item.updated_by = session.sub;
  item.updated_by_name = userName;
  item.updated_at = now;
  item.history.push({ action: 'edit', by: session.sub, by_name: userName, at: now, changes });
  if (item.history.length > 50) {
    item.history = [item.history[0], ...item.history.slice(-49)];
  }

  searches[idx] = item;
  await writeTeamFile(SEARCHES_FILE, searches, SavedSearchesFileSchema);
  await logActivity({
    user: session.sub,
    team: session.team,
    action: 'opensearch_saved_search_edit',
    meta: { id, changes },
  });
  return item;
}

export async function deleteSavedSearch(session: Session, id: string): Promise<void> {
  const searches = await readTeamFile(SEARCHES_FILE, SavedSearchesFileSchema);
  const item = searches.find((s) => s.id === id);
  if (!item) throw new Error('Saved search not found');

  const filtered = searches.filter((s) => s.id !== id);
  await writeTeamFile(SEARCHES_FILE, filtered, SavedSearchesFileSchema);
  await logActivity({
    user: session.sub,
    team: session.team,
    action: 'opensearch_saved_search_delete',
    meta: { id, name: item.name },
  });
}

// ─── Saved folders ──────────────────────────────────────────────────────────

export async function listSavedFolders(): Promise<SavedFolder[]> {
  const folders = await readTeamFile(FOLDERS_FILE, SavedFoldersFileSchema);
  return folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export async function createSavedFolder(
  session: Session,
  name: string,
  color?: string,
): Promise<SavedFolder> {
  const folders = await readTeamFile(FOLDERS_FILE, SavedFoldersFileSchema);
  if (folders.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('A folder with this name already exists');
  }
  if (folders.length >= 100) throw new Error('Maximum 100 folders reached');

  const now = Math.floor(Date.now() / 1000);
  const userName = session.username ?? session.sub;
  const entry: SavedFolder = {
    id: genId('fld'),
    name,
    color: color ?? '',
    created_by: session.sub,
    created_by_name: userName,
    created_at: now,
    updated_by: session.sub,
    updated_by_name: userName,
    updated_at: now,
  };
  folders.push(entry);
  await writeTeamFile(FOLDERS_FILE, folders, SavedFoldersFileSchema);
  await logActivity({
    user: session.sub,
    team: session.team,
    action: 'opensearch_saved_folder_create',
    meta: { id: entry.id, name },
  });
  return entry;
}

export async function updateSavedFolder(
  session: Session,
  id: string,
  updates: { name?: string; color?: string },
): Promise<SavedFolder> {
  const folders = await readTeamFile(FOLDERS_FILE, SavedFoldersFileSchema);
  const idx = folders.findIndex((f) => f.id === id);
  if (idx < 0) throw new Error('Folder not found');

  const item = folders[idx];
  if (updates.name !== undefined) {
    if (folders.some((f, i) => i !== idx && f.name.toLowerCase() === updates.name!.toLowerCase())) {
      throw new Error('A folder with this name already exists');
    }
    item.name = updates.name;
  }
  if (updates.color !== undefined) {
    item.color = updates.color;
  }
  item.updated_by = session.sub;
  item.updated_by_name = session.username ?? session.sub;
  item.updated_at = Math.floor(Date.now() / 1000);

  folders[idx] = item;
  await writeTeamFile(FOLDERS_FILE, folders, SavedFoldersFileSchema);
  await logActivity({
    user: session.sub,
    team: session.team,
    action: 'opensearch_saved_folder_update',
    meta: { id, name: item.name },
  });
  return item;
}

export async function deleteSavedFolder(session: Session, id: string): Promise<void> {
  const folders = await readTeamFile(FOLDERS_FILE, SavedFoldersFileSchema);
  const item = folders.find((f) => f.id === id);
  if (!item) throw new Error('Folder not found');

  const filtered = folders.filter((f) => f.id !== id);
  await writeTeamFile(FOLDERS_FILE, filtered, SavedFoldersFileSchema);

  // Un-folder any searches under this folder
  const searches = await readTeamFile(SEARCHES_FILE, SavedSearchesFileSchema);
  let changed = false;
  for (const s of searches) {
    if (s.folder_id === id) {
      s.folder_id = null;
      changed = true;
    }
  }
  if (changed) {
    await writeTeamFile(SEARCHES_FILE, searches, SavedSearchesFileSchema);
  }

  await logActivity({
    user: session.sub,
    team: session.team,
    action: 'opensearch_saved_folder_delete',
    meta: { id, name: item.name },
  });
}
