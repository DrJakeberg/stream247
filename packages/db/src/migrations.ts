import type { PoolClient } from "pg";

export type MigrationDefinition = {
  id: string;
  description: string;
  apply: (client: PoolClient) => Promise<void>;
};

export const schemaMigrations: MigrationDefinition[] = [];
