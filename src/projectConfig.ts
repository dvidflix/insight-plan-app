/** Project-specific naming (the prefix on resource ids and names). The values
    in this file are neutral; the real ones live in src/project.local.json,
    which is git-ignored so project names never reach the repository.
    Example project.local.json: { "projectPrefix": "ABC" } */
interface ProjectConfig {
  projectPrefix: string;
}

const local = import.meta.glob<Partial<ProjectConfig>>('./project.local.json', { eager: true, import: 'default' });

export const projectConfig: ProjectConfig = { projectPrefix: 'PRJ', ...Object.values(local)[0] };
