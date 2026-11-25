import { randomUUID } from 'node:crypto';
import type { ORPCErrorConstructorMap } from '@orpc/server';
import { eq, getTableColumns, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS } from '#/core.ts';
import type { Tx } from '#/db/client.ts';
import { uniqueViolation } from '#/db/client.ts';
import { LIVE_STATUSES, rfidTags, TAG_EPC_INDEX } from '#/db/schema.ts';
import { writes } from '#/orpc.ts';
import { byRequest, linesOf, Movement, recordMovement, RequestKey } from './movements.ts';
import { Amount, EpcList, LIMITS, OneEpc } from './shared.ts';

/** At most five EPCs, to name in a message without flooding it. */
const sample = z.array(z.string()).max(5);

const tagErrors = {
  EPC_UNKNOWN: {
    status: 409,
    message: 'Some EPCs are not registered',
    data: z.object({ epcIds: sample }),
  },
  NO_STOCK: {
    status: 409,
    message: 'Some tags hold no stock: emptied or replaced',
    data: z.object({ epcIds: sample }),
  },
  ZONES_MIXED: {
    status: 409,
    message: 'Work on tags of one zone at a time',
  },
};

const breakErrors = {
  ...tagErrors,
  PACKS_OPENED: {
    status: 409,
    message: 'Some packs were opened already',
    data: z.object({ epcIds: sample }),
  },
};

const issueErrors = {
  ...tagErrors,
  NOT_ENOUGH: {
    status: 409,
    message: 'A tag holds less than asked',
    data: z.object({ epcId: z.string(), remaining: z.number() }),
  },
};

const relabelErrors = {
  ...tagErrors,
  EPC_TAKEN: { status: 409, message: 'The new EPC is registered already' },
};

const { orgId, unitsInPack, movementId, ...tagColumns } = getTableColumns(rfidTags);

/**
 * The tags with these EPCs, locked for the change, once each is known and holds stock and all are
 * in one zone. Their zone comes back with them.
 */
const lockLive = async (
  tx: Tx,
  epcIds: string[],
  errors: ORPCErrorConstructorMap<typeof tagErrors>,
) => {
  const tags = await tx
    .select(tagColumns)
    .from(rfidTags)
    .where(inArray(rfidTags.epcId, epcIds))
    .for('update');

  const found = new Set(tags.map((tag) => tag.epcId));
  const unknown = epcIds.filter((epcId) => !found.has(epcId));
  const dead = tags.filter((tag) => !LIVE_STATUSES.some((status) => status === tag.status));
  const zoneIds = new Set(tags.map((tag) => tag.zoneId));

  if (unknown.length) throw errors.EPC_UNKNOWN({ data: { epcIds: unknown.slice(0, 5) } });

  if (dead.length)
    throw errors.NO_STOCK({ data: { epcIds: dead.map((tag) => tag.epcId).slice(0, 5) } });

  const [zoneId] = zoneIds;

  if (zoneIds.size !== 1 || !zoneId) throw errors.ZONES_MIXED();

  return { tags, zoneId };
};

/**
 * Opens sealed packs where they are: each tag stays with all it holds, now `opened`, so the stock
 * and its cost don't change. One transaction; the client's `requestKey` (one per action) makes a
 * retry return the first movement instead of a second.
 */
const breakBoxes = writes(PERMISSIONS.movements)
  .errors(breakErrors)
  .input(z.object({ epcIds: EpcList(LIMITS.breakBoxes), requestKey: RequestKey }))
  .output(Movement)
  .handler(async ({ input, context: { tx, member }, errors }) => {
    const replay = await byRequest(tx, input.requestKey);

    if (replay) return replay;

    const { tags, zoneId } = await lockLive(tx, input.epcIds, errors);
    const opened = tags.filter((tag) => tag.status !== 'sealed').map((tag) => tag.epcId);

    if (opened.length) throw errors.PACKS_OPENED({ data: { epcIds: opened.slice(0, 5) } });

    const { movement, recorded } = await recordMovement(
      tx,
      member,
      { requestKey: input.requestKey, type: 'break_box', zoneId },
      linesOf(tags.map((tag) => ({ productId: tag.productId, amount: tag.remaining }))),
      tags.map((tag) => ({ tagId: tag.id, productId: tag.productId, taken: 0 })),
    );

    if (recorded)
      await tx
        .update(rfidTags)
        .set({ status: 'opened' })
        .where(inArray(rfidTags.epcId, input.epcIds));

    return movement;
  });

/**
 * Takes stock out of tags: `amount` from each line's tag, or all it has left when the line gives
 * none. A tag left with nothing is `empty`; one with some left is `opened`. All lines or none.
 */
const issue = writes(PERMISSIONS.movements)
  .errors(issueErrors)
  .input(
    z.object({
      lines: z
        .array(z.object({ epcId: OneEpc, amount: Amount.optional() }))
        .min(1)
        .max(LIMITS.breakBoxes)
        .refine((lines) => new Set(lines.map((line) => line.epcId)).size === lines.length, {
          message: 'One line per tag',
        }),
      requestKey: RequestKey,
    }),
  )
  .output(Movement)
  .handler(async ({ input, context: { tx, member }, errors }) => {
    const replay = await byRequest(tx, input.requestKey);

    if (replay) return replay;

    const { tags, zoneId } = await lockLive(
      tx,
      input.lines.map((line) => line.epcId),
      errors,
    );

    const taken = tags.map((tag) => {
      const amount = input.lines.find((line) => line.epcId === tag.epcId)?.amount ?? tag.remaining;

      if (amount > tag.remaining)
        throw errors.NOT_ENOUGH({ data: { epcId: tag.epcId, remaining: tag.remaining } });

      return { tag, amount };
    });

    const { movement, recorded } = await recordMovement(
      tx,
      member,
      { requestKey: input.requestKey, type: 'issue', zoneId },
      linesOf(taken.map(({ tag, amount }) => ({ productId: tag.productId, amount }))),
      taken.map(({ tag, amount }) => ({ tagId: tag.id, productId: tag.productId, taken: amount })),
    );

    if (recorded)
      await Promise.all(
        taken.map(({ tag, amount }) => {
          const remaining = Math.round((tag.remaining - amount) * 1000) / 1000;

          return tx
            .update(rfidTags)
            .set({ remaining, status: remaining > 0 ? 'opened' : 'empty' })
            .where(eq(rfidTags.id, tag.id));
        }),
      );

    return movement;
  });

/**
 * Moves a tag's stock to a new label: the new EPC gets the product, packaging, amounts, status and
 * place, and the old tag becomes `replaced`, pointing at it. Nothing leaves the stock.
 */
const relabel = writes(PERMISSIONS.movements)
  .errors(relabelErrors)
  .input(z.object({ epcId: OneEpc, newEpcId: OneEpc, requestKey: RequestKey }))
  .output(Movement)
  .handler(async ({ input, context: { tx, member }, errors }) => {
    const replay = await byRequest(tx, input.requestKey);

    if (replay) return replay;

    const {
      tags: [old],
      zoneId,
    } = await lockLive(tx, [input.epcId], errors);

    if (!old) throw errors.EPC_UNKNOWN({ data: { epcIds: [input.epcId] } });

    const { id, epcId, createdAt, status, replacedBy, ...kept } = old;

    const [fresh] = await tx
      .insert(rfidTags)
      .values({
        ...kept,
        orgId: member.orgId,
        epcId: input.newEpcId,
        status: status === 'sealed' ? 'sealed' : 'opened',
        batchId: randomUUID(),
        createdBy: member.userId,
      })
      .returning({ id: rfidTags.id })
      .catch((error: unknown) => {
        if (uniqueViolation(error) === TAG_EPC_INDEX) throw errors.EPC_TAKEN();

        throw error;
      });

    if (!fresh) throw errors.EPC_UNKNOWN({ data: { epcIds: [input.newEpcId] } });

    const { movement } = await recordMovement(
      tx,
      member,
      { requestKey: input.requestKey, type: 'relabel', zoneId },
      [],
      [
        { tagId: old.id, productId: old.productId, taken: 0 },
        { tagId: fresh.id, productId: old.productId, taken: 0 },
      ],
    );

    await tx
      .update(rfidTags)
      .set({ status: 'replaced', replacedBy: fresh.id })
      .where(eq(rfidTags.id, old.id));

    return movement;
  });

export const stockActions = { breakBoxes, issue, relabel };
