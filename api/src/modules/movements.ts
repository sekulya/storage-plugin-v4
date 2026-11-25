import type { PluginMember } from '@erxes/plugin-sdk';
import { compileFilter, type FilterFields, FilterParam } from '@erxes/plugin-sdk/filter';
import { ORPCError } from '@orpc/server';
import { and, desc, eq, getTableColumns, inArray } from 'drizzle-orm';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { PERMISSIONS } from '#/core.ts';
import type { Tx } from '#/db/client.ts';
import { MOVEMENT_TYPES, movementItems, movements, movementTags, rfidTags } from '#/db/schema.ts';
import { reads } from '#/orpc.ts';
import { after, Id, Page, pageOf } from './shared.ts';

const { orgId, ...columns } = getTableColumns(movements);

/** A line as the API returns it: tags touched and the amount, per product. */
const itemColumns = {
  productId: movementItems.productId,
  packs: movementItems.packs,
  units: movementItems.units,
};

export const Item = createSelectSchema(movementItems).pick({
  productId: true,
  packs: true,
  units: true,
});

/** A movement with its lines, one per product. */
export const Movement = createSelectSchema(movements)
  .omit({ orgId: true })
  .extend({ items: z.array(Item) });

/** A movement for its panel: its lines and every tag it touched, with what it took. */
const MovementDetail = Movement.extend({
  tags: z.array(z.object({ epcId: z.string(), productId: z.string(), taken: z.number() })),
});

/** The client's key for one action, so a retry finds the first movement. */
export const RequestKey = z.string().trim().min(8).max(100);

/** What the movements list's filter bar filters by (`MovementsPage.tsx`). */
const FILTER_FIELDS = {
  'subject.zoneId': { type: 'select', expr: movements.zoneId },
  'subject.type': { type: 'select', expr: movements.type },
  'subject.createdAt': { type: 'date', expr: movements.createdAt },
  'subject.createdBy': { type: 'member', expr: movements.createdBy },
} satisfies FilterFields;

const withItems = async (tx: Tx, rows: Omit<z.output<typeof Movement>, 'items'>[]) => {
  const ids = rows.map((row) => row.id);

  const items = ids.length
    ? await tx
        .select({ movementId: movementItems.movementId, ...itemColumns })
        .from(movementItems)
        .where(inArray(movementItems.movementId, ids))
        .orderBy(movementItems.productId)
    : [];

  return rows.map((row) => ({
    ...row,
    items: items.flatMap(({ movementId, ...item }) => (movementId === row.id ? [item] : [])),
  }));
};

/** The movement an earlier request with this key made, if any. */
export const byRequest = async (tx: Tx, requestKey: string) => {
  const rows = await tx.select(columns).from(movements).where(eq(movements.requestKey, requestKey));

  return (await withItems(tx, rows))[0];
};

type Taken = { tagId: string; productId: string; taken: number };

/** Lines per product: how many tags, and the amount taken from them (or held, for a break). */
export const linesOf = (tags: { productId: string; amount: number }[]) =>
  [
    ...tags
      .reduce((lines, tag) => {
        const line = lines.get(tag.productId) ?? { productId: tag.productId, packs: 0, units: 0 };

        return lines.set(tag.productId, {
          ...line,
          packs: line.packs + 1,
          units: Math.round((line.units + tag.amount) * 1000) / 1000,
        });
      }, new Map<string, z.output<typeof Item>>())
      .values(),
  ].toSorted((a, b) => a.productId.localeCompare(b.productId));

/**
 * Records a movement with its lines and the tags it touched, once per `requestKey`: a retry, or a
 * request that lost the race to the same key, gets the first movement back.
 */
export const recordMovement = async (
  tx: Tx,
  member: PluginMember,
  movement: { requestKey: string; type: (typeof MOVEMENT_TYPES)[number]; zoneId: string },
  lines: z.output<typeof Item>[],
  tags: Taken[],
) => {
  const [row] = await tx
    .insert(movements)
    .values({
      ...movement,
      orgId: member.orgId,
      number: `RFID-${Date.now().toString(36).toUpperCase()}-${movement.requestKey.slice(0, 4).toUpperCase()}`,
      createdBy: member.userId,
    })
    .onConflictDoNothing()
    .returning(columns);

  if (!row) {
    const first = await byRequest(tx, movement.requestKey);

    if (!first) throw new ORPCError('CONFLICT', { message: 'Try again' });

    return { movement: first, recorded: false };
  }

  if (lines.length)
    await tx
      .insert(movementItems)
      .values(lines.map((line) => ({ ...line, orgId: member.orgId, movementId: row.id })));

  if (tags.length)
    await tx.insert(movementTags).values(
      tags.map((tag) => ({
        orgId: member.orgId,
        movementId: row.id,
        tagId: tag.tagId,
        taken: tag.taken,
      })),
    );

  return { movement: { ...row, items: lines }, recorded: true };
};

/** Movements, newest first, with their lines. */
const list = reads(PERMISSIONS.view)
  .route({ method: 'GET' })
  .input(
    z.object({
      zoneId: Id.optional(),
      type: z.enum(MOVEMENT_TYPES).optional(),
      filter: FilterParam.optional(),
      ...Page,
    }),
  )
  .output(z.object({ items: z.array(Movement), nextCursor: z.string().nullable() }))
  .handler(async ({ input, context: { tx, member } }) => {
    const rows = await tx
      .select(columns)
      .from(movements)
      .where(
        and(
          input.zoneId ? eq(movements.zoneId, input.zoneId) : undefined,
          input.type ? eq(movements.type, input.type) : undefined,
          compileFilter(FILTER_FIELDS, input.filter, { me: member.userId }),
          after(input.cursor, movements),
        ),
      )
      .orderBy(desc(movements.createdAt), desc(movements.id))
      .limit(input.limit + 1);

    const page = pageOf(rows, input.limit);

    return { items: await withItems(tx, page.items), nextCursor: page.nextCursor };
  });

/** One movement with its lines and tags, for its panel. */
const get = reads(PERMISSIONS.view)
  .route({ method: 'GET' })
  .input(z.object({ id: Id }))
  .output(MovementDetail)
  .handler(async ({ input, context: { tx } }) => {
    const rows = await tx.select(columns).from(movements).where(eq(movements.id, input.id));
    const [movement] = await withItems(tx, rows);

    if (!movement) throw new ORPCError('NOT_FOUND', { message: 'No such movement' });

    const tags = await tx
      .select({ epcId: rfidTags.epcId, productId: rfidTags.productId, taken: movementTags.taken })
      .from(movementTags)
      .innerJoin(rfidTags, eq(rfidTags.id, movementTags.tagId))
      .where(eq(movementTags.movementId, movement.id))
      .orderBy(rfidTags.epcId);

    return { ...movement, tags };
  });

export const movementReads = { list, get };
