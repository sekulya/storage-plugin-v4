import { randomBytes } from 'node:crypto';
import { ORPCError } from '@orpc/server';
import { and, eq, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { Tx } from '#/db/client.ts';
import { locations } from '#/db/schema.ts';

/** Upper bounds that keep one request from exhausting memory or the database. */
export const LIMITS = {
  registerTags: 5000,
  breakBoxes: 200,
  scanEpcs: 50_000,
  /** The most one tag holds, in the product's unit. */
  quantity: 1_000_000_000,
  /** How many EPCs of each kind a count keeps; its counts stay exact. */
  scanSample: 200,
} as const;

/** A 96-bit EPC as a reader sends it: 24 hex characters, any case, trimmed. */
const Epc = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9A-F]{24}$/u, '24 hex characters (a 96-bit EPC)');

/** A list of EPCs, without repeats, of at least one and at most `max`. */
export const EpcList = (max: number) =>
  z
    .array(Epc)
    .min(1)
    .max(max)
    .transform((epcIds) => [...new Set(epcIds)]);

/** A single EPC, as `EpcList` takes them. */
export const OneEpc = Epc;

/**
 * An amount in the product's unit, rounded to the three decimals the database keeps (300.5 m of
 * cable, 12 pieces), above zero and at most `LIMITS.quantity`.
 */
export const Amount = z
  .number()
  .transform((value) => Math.round(value * 1000) / 1000)
  .pipe(z.number().positive().max(LIMITS.quantity));

/** The location, if it is in `zoneId`; a missing or foreign one is a 404. */
export const locationIn = async (tx: Tx, locationId: string, zoneId: string) => {
  const [location] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.id, locationId), eq(locations.zoneId, zoneId)));

  if (!location) throw new ORPCError('NOT_FOUND', { message: 'No such location in this zone' });

  return location;
};

/** A new 96-bit EPC, to encode on a blank tag. */
export const newEpcId = () => randomBytes(12).toString('hex').toUpperCase();

export const Id = z.string().trim().min(1).max(100);

/** Keyset paging, newest first: the cursor is the last row's id. */
export const Page = {
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
};

/** Rows after `cursor` in (created_at, id) descending order. */
export const after = (
  cursor: string | undefined,
  rows: PgTable & { createdAt: AnyPgColumn; id: AnyPgColumn },
): SQL | undefined =>
  cursor
    ? sql`(${rows.createdAt}, ${rows.id}) < (select created_at, id from ${rows} where id = ${cursor})`
    : undefined;

/** One page of `limit + 1` rows read: the page and the cursor for the next one. */
export const pageOf = <T extends { id: string }>(rows: T[], limit: number) => {
  const page = rows.slice(0, limit);

  return { items: page, nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null };
};
