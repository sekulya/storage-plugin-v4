import { pgTableCreator } from 'drizzle-orm/pg-core';

/**
 * Every table is `storage_<name>`: the plugin shares core's database, and core
 * gives its role rights on its own tables only. Name indexes and constraints
 * in full (`storage_items_org_created_idx`).
 */
export const table = pgTableCreator((name) => `storage_${name}`);
