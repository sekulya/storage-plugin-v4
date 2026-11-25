import { randomUUID } from 'node:crypto';
import { compileFilter, type FilterFields, FilterParam } from '@erxes/plugin-sdk/filter';
import { ORPCError } from '@orpc/server';
import { and, desc, eq, getTableColumns, inArray, notExists, sql } from 'drizzle-orm';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { PERMISSIONS } from '#/core.ts';
import { uniqueViolation } from '#/db/client.ts';
import {
  LIVE_STATUSES,
  movementTags,
  PACKAGINGS,
  rfidTags,
  TAG_EPC_INDEX,
  TAG_STATUSES,
  zones,
} from '#/db/schema.ts';
import { reads, writes } from '#/orpc.ts';
import {
  after,
  Amount,
  EpcList,
  Id,
  LIMITS,
  locationIn,
  newEpcId,
  OneEpc,
  Page,
  pageOf,
} from './shared.ts';

// `unitsInPack` and `movementId` are retired columns: nothing reads or returns them.
const { orgId, unitsInPack, movementId, ...columns } = getTableColumns(rfidTags);

const Tag = createSelectSchema(rfidTags).omit({
  orgId: true,
  unitsInPack: true,
  movementId: true,
});

/** What the tags list's filter bar filters by (`TagsPage.tsx`), with the column each compares. */
const FILTER_FIELDS = {
  'subject.zoneId': { type: 'select', expr: rfidTags.zoneId },
  'subject.locationId': { type: 'select', expr: rfidTags.locationId },
  'subject.productId': { type: 'product', expr: rfidTags.productId },
  'subject.packaging': { type: 'select', expr: rfidTags.packaging },
  'subject.status': { type: 'select', expr: rfidTags.status },
  'subject.createdAt': { type: 'date', expr: rfidTags.createdAt },
  'subject.createdBy': { type: 'member', expr: rfidTags.createdBy },
} satisfies FilterFields;

const registerErrors = {
  EPC_TAKEN: {
    status: 409,
    message: 'Some of these EPCs are registered already: nothing was registered',
  },
};

const placeErrors = {
  TAGS_NOT_PLACEABLE: {
    status: 409,
    message: 'Some tags are not registered, hold no stock, or are in another zone',
    data: z.object({ epcIds: z.array(z.string()).max(5) }),
  },
};

/** Tags, newest first, narrowed to a zone, a location, a product or a status. */
const list = reads(PERMISSIONS.view)
  .route({ method: 'GET' })
  .input(
    z.object({
      zoneId: Id.optional(),
      locationId: Id.optional(),
      productId: Id.optional(),
      status: z.enum(TAG_STATUSES).optional(),
      filter: FilterParam.optional(),
      ...Page,
    }),
  )
  .output(z.object({ items: z.array(Tag), nextCursor: z.string().nullable() }))
  .handler(async ({ input, context: { tx, member } }) => {
    const rows = await tx
      .select(columns)
      .from(rfidTags)
      .where(
        and(
          input.zoneId ? eq(rfidTags.zoneId, input.zoneId) : undefined,
          input.locationId ? eq(rfidTags.locationId, input.locationId) : undefined,
          input.productId ? eq(rfidTags.productId, input.productId) : undefined,
          input.status ? eq(rfidTags.status, input.status) : undefined,
          compileFilter(FILTER_FIELDS, input.filter, { me: member.userId }),
          after(input.cursor, rfidTags),
        ),
      )
      .orderBy(desc(rfidTags.createdAt), desc(rfidTags.id))
      .limit(input.limit + 1);

    return pageOf(rows, input.limit);
  });

/** One tag, for its panel. */
const get = reads(PERMISSIONS.view)
  .route({ method: 'GET' })
  .input(z.object({ id: Id }))
  .output(Tag)
  .handler(async ({ input, context: { tx } }) => {
    const [tag] = await tx.select(columns).from(rfidTags).where(eq(rfidTags.id, input.id));

    if (!tag) throw new ORPCError('NOT_FOUND', { message: 'No such tag' });

    return tag;
  });

/** The tag a reader just read: what it is and where it should be. */
const find = reads(PERMISSIONS.view)
  .route({ method: 'GET' })
  .input(z.object({ epcId: OneEpc }))
  .output(Tag)
  .handler(async ({ input, context: { tx } }) => {
    const [tag] = await tx.select(columns).from(rfidTags).where(eq(rfidTags.epcId, input.epcId));

    if (!tag) throw new ORPCError('NOT_FOUND', { message: 'No tag has this EPC' });

    return tag;
  });

/** Per product in a zone: sealed tags and what they hold, opened tags and what is left in them. */
const summary = reads(PERMISSIONS.view)
  .route({ method: 'GET' })
  .input(z.object({ zoneId: Id }))
  .output(
    z.array(
      z.object({
        productId: z.string(),
        sealedPacks: z.number(),
        sealedQuantity: z.number(),
        openedPacks: z.number(),
        openedQuantity: z.number(),
      }),
    ),
  )
  .handler(({ input, context: { tx } }) =>
    tx
      .select({
        productId: rfidTags.productId,
        sealedPacks: sql<number>`count(*) filter (where ${rfidTags.status} = 'sealed')::int`,
        sealedQuantity: sql<number>`coalesce(sum(${rfidTags.remaining}) filter (where ${rfidTags.status} = 'sealed'), 0)::float8`,
        openedPacks: sql<number>`count(*) filter (where ${rfidTags.status} = 'opened')::int`,
        openedQuantity: sql<number>`coalesce(sum(${rfidTags.remaining}) filter (where ${rfidTags.status} = 'opened'), 0)::float8`,
      })
      .from(rfidTags)
      .where(and(eq(rfidTags.zoneId, input.zoneId), inArray(rfidTags.status, LIVE_STATUSES)))
      .groupBy(rfidTags.productId)
      .orderBy(rfidTags.productId),
  );

/**
 * One tag per packed item of a core product, in a zone and optionally at one of its locations:
 * `count` new EPCs to encode on blank tags, or the `epcIds` read from tags already encoded.
 * `quantity` is what each holds, in the product's unit. All of them or none: one EPC already
 * registered leaves nothing registered.
 */
const register = writes(PERMISSIONS.tags)
  .errors(registerErrors)
  .input(
    z
      .object({
        productId: Id,
        zoneId: Id,
        locationId: Id.optional(),
        packaging: z.enum(PACKAGINGS),
        quantity: Amount,
        count: z.number().int().min(1).max(LIMITS.registerTags).optional(),
        epcIds: EpcList(LIMITS.registerTags).optional(),
      })
      .refine((input) => (input.count === undefined) !== (input.epcIds === undefined), {
        message: 'Give either how many tags to make, or the EPCs read, not both',
        path: ['epcIds'],
      }),
  )
  .output(z.object({ batchId: z.string(), epcIds: z.array(z.string()) }))
  .handler(async ({ input, context: { tx, member }, errors }) => {
    const [zone] = await tx.select({ id: zones.id }).from(zones).where(eq(zones.id, input.zoneId));

    if (!zone) throw new ORPCError('NOT_FOUND', { message: 'No such zone' });

    if (input.locationId) await locationIn(tx, input.locationId, input.zoneId);

    const epcIds = input.epcIds ?? Array.from({ length: input.count ?? 0 }, newEpcId);
    const batchId = randomUUID();

    await tx
      .insert(rfidTags)
      .values(
        epcIds.map((epcId) => ({
          orgId: member.orgId,
          epcId,
          productId: input.productId,
          packaging: input.packaging,
          quantity: input.quantity,
          remaining: input.quantity,
          zoneId: input.zoneId,
          locationId: input.locationId ?? null,
          batchId,
          createdBy: member.userId,
        })),
      )
      .catch((error: unknown) => {
        if (uniqueViolation(error) === TAG_EPC_INDEX) throw errors.EPC_TAKEN();

        throw error;
      });

    return { batchId, epcIds };
  });

/**
 * Puts tags at a location of their zone, or takes them off any location (`locationId: null`).
 * Only tags that hold stock move; one that can't leaves all of them where they were.
 */
const place = writes(PERMISSIONS.tags)
  .errors(placeErrors)
  .input(z.object({ epcIds: EpcList(LIMITS.registerTags), zoneId: Id, locationId: Id.nullable() }))
  .output(z.object({ placed: z.number() }))
  .handler(async ({ input, context: { tx }, errors }) => {
    if (input.locationId) await locationIn(tx, input.locationId, input.zoneId);

    const placed = await tx
      .update(rfidTags)
      .set({ locationId: input.locationId })
      .where(
        and(
          inArray(rfidTags.epcId, input.epcIds),
          eq(rfidTags.zoneId, input.zoneId),
          inArray(rfidTags.status, LIVE_STATUSES),
        ),
      )
      .returning({ epcId: rfidTags.epcId });

    if (placed.length !== input.epcIds.length) {
      const moved = new Set(placed.map((tag) => tag.epcId));

      throw errors.TAGS_NOT_PLACEABLE({
        data: { epcIds: input.epcIds.filter((epcId) => !moved.has(epcId)).slice(0, 5) },
      });
    }

    return { placed: placed.length };
  });

/** Tags registered by mistake: sealed ones no movement has touched. Others stay. */
const remove = writes(PERMISSIONS.tags)
  .input(z.object({ epcIds: EpcList(LIMITS.registerTags) }))
  .output(z.object({ removed: z.number() }))
  .handler(async ({ input, context: { tx } }) => {
    const removed = await tx
      .delete(rfidTags)
      .where(
        and(
          inArray(rfidTags.epcId, input.epcIds),
          eq(rfidTags.status, 'sealed'),
          notExists(
            tx
              .select({ id: movementTags.id })
              .from(movementTags)
              .where(eq(movementTags.tagId, rfidTags.id)),
          ),
        ),
      )
      .returning({ id: rfidTags.id });

    return { removed: removed.length };
  });

export const tagProcedures = { list, get, find, summary, register, place, remove };
