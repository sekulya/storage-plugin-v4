import { ORPCError } from '@orpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS } from '#/core.ts';
import type { Tx } from '#/db/client.ts';
import { LIVE_STATUSES, rfidTags, scans } from '#/db/schema.ts';
import { writes } from '#/orpc.ts';
import { linesOf, recordMovement } from './movements.ts';
import { Scan, scanColumns, withProducts } from './scans.ts';
import { Id } from './shared.ts';

const reviewErrors = {
  NOT_DRAFT: {
    status: 409,
    message: 'This count was approved or rejected already',
    data: z.object({ status: z.string() }),
  },
};

/** The draft count, locked so two reviewers can't both act on it. */
const lockDraft = async (
  tx: Tx,
  id: string,
  notDraft: (status: string) => Error,
): Promise<typeof scans.$inferSelect> => {
  const [scan] = await tx.select().from(scans).where(eq(scans.id, id)).for('update');

  if (!scan) throw new ORPCError('NOT_FOUND', { message: 'No such count' });

  if (scan.status !== 'draft') throw notDraft(scan.status);

  return scan;
};

const reviewed = async (
  tx: Tx,
  id: string,
  change: Pick<typeof scans.$inferInsert, 'status' | 'reviewedBy' | 'movementId'>,
) => {
  const rows = await tx
    .update(scans)
    .set({ ...change, reviewedAt: new Date() })
    .where(eq(scans.id, id))
    .returning(scanColumns);

  const [scan] = await withProducts(tx, rows);

  if (!scan) throw new ORPCError('NOT_FOUND', { message: 'No such count' });

  return scan;
};

/**
 * Applies a draft count to the stock, in one transaction: missing tags that still hold stock at
 * the counted place are written off (`empty`), and tags read here but registered elsewhere move
 * here. Tags changed since the count are left alone. One `count_adjustment` movement records it.
 */
const approve = writes(PERMISSIONS.counts)
  .errors(reviewErrors)
  .input(z.object({ id: Id }))
  .output(Scan)
  .handler(async ({ input, context: { tx, member }, errors }) => {
    const scan = await lockDraft(tx, input.id, (status) => errors.NOT_DRAFT({ data: { status } }));

    const live = inArray(rfidTags.status, LIVE_STATUSES);

    const missing = scan.missingEpcIds.length
      ? await tx
          .select()
          .from(rfidTags)
          .where(
            and(
              inArray(rfidTags.epcId, scan.missingEpcIds),
              eq(rfidTags.zoneId, scan.zoneId),
              scan.locationId ? eq(rfidTags.locationId, scan.locationId) : undefined,
              live,
            ),
          )
          .for('update')
      : [];

    const found = scan.otherZoneEpcIds.length
      ? await tx
          .select()
          .from(rfidTags)
          .where(and(inArray(rfidTags.epcId, scan.otherZoneEpcIds), live))
          .for('update')
      : [];

    if (!missing.length && !found.length)
      return reviewed(tx, scan.id, { status: 'approved', reviewedBy: member.userId });

    const { movement } = await recordMovement(
      tx,
      member,
      { requestKey: `count:${scan.id}`, type: 'count_adjustment', zoneId: scan.zoneId },
      linesOf(missing.map((tag) => ({ productId: tag.productId, amount: tag.remaining }))),
      [
        ...missing.map((tag) => ({
          tagId: tag.id,
          productId: tag.productId,
          taken: tag.remaining,
        })),
        ...found.map((tag) => ({ tagId: tag.id, productId: tag.productId, taken: 0 })),
      ],
    );

    if (missing.length)
      await tx
        .update(rfidTags)
        .set({ remaining: 0, status: 'empty' })
        .where(
          inArray(
            rfidTags.id,
            missing.map((tag) => tag.id),
          ),
        );

    // A whole-zone count can't tell which shelf a found tag sits on: it keeps none.
    if (found.length)
      await tx
        .update(rfidTags)
        .set({ zoneId: scan.zoneId, locationId: scan.locationId })
        .where(
          inArray(
            rfidTags.id,
            found.map((tag) => tag.id),
          ),
        );

    return reviewed(tx, scan.id, {
      status: 'approved',
      reviewedBy: member.userId,
      movementId: movement.id,
    });
  });

/** Turns a draft count down: the stock stays as it was. */
const reject = writes(PERMISSIONS.counts)
  .errors(reviewErrors)
  .input(z.object({ id: Id }))
  .output(Scan)
  .handler(async ({ input, context: { tx, member }, errors }) => {
    const scan = await lockDraft(tx, input.id, (status) => errors.NOT_DRAFT({ data: { status } }));

    return reviewed(tx, scan.id, { status: 'rejected', reviewedBy: member.userId });
  });

export const scanReview = { approve, reject };
