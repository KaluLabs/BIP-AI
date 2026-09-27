import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export class ProjectRegistry {
  constructor(filename = '.bipai/projects.json') {
    this.filename = filename;
    mkdirSync(dirname(filename), { recursive: true });
    if (!existsSync(filename)) writeFileSync(filename, '{\n  "projects": []\n}\n');
  }

  read() {
    const value = JSON.parse(readFileSync(this.filename, 'utf8'));
    if (!Array.isArray(value.projects)) throw new TypeError('project registry must contain a projects array');
    return value.projects;
  }

  list() { return this.read(); }

  get(id) { return this.read().find((project) => project.id === id) ?? null; }

  add({ id, path, name = null }) {
    if (!id || !String(id).trim()) throw new TypeError('project id is required');
    if (!path || !String(path).trim()) throw new TypeError('project path is required');
    const projects = this.read();
    if (projects.some((project) => project.id === id)) throw new Error(`project already exists: ${id}`);
    const project = { id: String(id).trim(), name: name ? String(name).trim() : String(id).trim(), path: resolve(path) };
    projects.push(project);
    writeFileSync(this.filename, `${JSON.stringify({ projects }, null, 2)}\n`);
    return project;
  }
}
