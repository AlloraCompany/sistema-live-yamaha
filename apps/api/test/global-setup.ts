import type { TestProject } from 'vitest/node';
import { createMigratedTemplate, startPostgres } from './support/postgres.js';

declare module 'vitest' {
  export interface ProvidedContext {
    pgBaseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const pg = await startPostgres({ fast: true });
  await createMigratedTemplate(pg.baseUrl);
  project.provide('pgBaseUrl', pg.baseUrl);
  return async () => {
    await pg.stop();
  };
}
