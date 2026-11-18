import { openDB } from 'idb';
import type { V6Project } from './types';

const db = openDB('mia-studio-v6', 1, { upgrade(d) { d.createObjectStore('projects', { keyPath: 'id' }); } });

export async function saveProject(p: V6Project) { await (await db).put('projects', structuredClone(p)); }
export async function listProjects(): Promise<V6Project[]> {
  return ((await (await db).getAll('projects')) as V6Project[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function deleteProject(id: string) { await (await db).delete('projects', id); }
