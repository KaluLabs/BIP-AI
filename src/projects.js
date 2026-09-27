import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const GITHUB_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function githubConfig(repository, visibility = 'private') {
  if (repository == null || repository === '') return null;
  const repo = String(repository).trim();
  const mode = String(visibility || 'private').trim().toLowerCase();
  if (!GITHUB_REPOSITORY.test(repo)) throw new TypeError('GitHub repository must be owner/repo');
  if (!['public', 'private'].includes(mode)) throw new TypeError('GitHub visibility must be public or private');
  return { repository: repo, visibility: mode };
}

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

  write(projects) {
    writeFileSync(this.filename, `${JSON.stringify({ projects }, null, 2)}\n`);
  }

  list() { return this.read(); }

  get(id) { return this.read().find((project) => project.id === id) ?? null; }

  add({
    id,
    path,
    name = null,
    github = null,
    githubRepository = null,
    githubVisibility = 'private'
  }) {
    if (!id || !String(id).trim()) throw new TypeError('project id is required');
    if (!path || !String(path).trim()) throw new TypeError('project path is required');
    const projects = this.read();
    if (projects.some((project) => project.id === id)) throw new Error(`project already exists: ${id}`);
    const suppliedGithub = github && typeof github === 'object'
      ? githubConfig(github.repository, github.visibility)
      : githubConfig(githubRepository, githubVisibility);
    const project = {
      id: String(id).trim(),
      name: name ? String(name).trim() : String(id).trim(),
      path: resolve(path),
      ...(suppliedGithub ? { github: suppliedGithub } : {})
    };
    projects.push(project);
    this.write(projects);
    return project;
  }

  setGithub(id, { repository, visibility = 'private' } = {}) {
    const projects = this.read();
    const index = projects.findIndex((project) => project.id === id);
    if (index < 0) throw new Error(`project not found: ${id}`);
    projects[index] = { ...projects[index], github: githubConfig(repository, visibility) };
    this.write(projects);
    return projects[index];
  }

  clearGithub(id) {
    const projects = this.read();
    const index = projects.findIndex((project) => project.id === id);
    if (index < 0) throw new Error(`project not found: ${id}`);
    const { github, ...project } = projects[index];
    projects[index] = project;
    this.write(projects);
    return project;
  }
}

export function validateProjectGithub(repository, visibility = 'private') {
  return githubConfig(repository, visibility);
}
