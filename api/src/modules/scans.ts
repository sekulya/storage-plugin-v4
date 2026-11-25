import { compileFilter, type FilterFields, FilterParam } from '@erxes/plugin-sdk/filter';
import { ORPCError } from '@orpc/server';
import { and, desc, eq, getTableColumns, inArray } from 'drizzle-orm';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { PERMISSIONS } from '#/core.ts';
import type { Tx } from '#/db/client.ts';
import { LIVE_STATUSES, rfidTags, SCAN_STATUSES, scanProducts, scans, zones } from '#/db/schema.ts';
import { reads, writes } from '#/orpc.ts';
import { after, EpcList, Id, LIMITS, locationIn, Page, pageOf } from './shared.ts';

const { orgId, ...columns } = getTableColumns(scans);

export const scanColumns = columns;

const Product = createSelectSchema(scanProducts).pick({
  productId: true,
  expectedPacks: true,
  scannedPacks: true,
  expectedQuantity: true,
  scannedQuantity: true,
});

/** A count with its result per product. */
export const Scan = createSelectSchema(scans)
  .omit({ orgId: true })
  .extend({ products: z.array(Product) });

/** What the counts list's filter bar filters by (`CountsPage.tsx`). */
const FILTER_FIELDS = {
  'subject.zoneId': { type: 'select', expr: scans.zoneId },
  'subject.locationId': { type: 'select', expr: scans.locationId },
  'subject.status': { type: 'select', expr: scans.status },
  'subject.createdAt': { type: 'date', expr: scans.createdAt },
  'subject.createdBy': { type: 'member', expr: scans.createdBy },
} satisfies FilterFields;

type Tag = {
  epcId: string;
  productId: string;
  zoneId: string;
  locationId: string | null;
  status: (typeof rfidTags.$inferSelect)['status'];
  remaining: number;
};

const sample = (epcIds: string[]) => epcIds.slice(0, LIMITS.scanSample);

const add = (a: number, b: number) => Math.round((a + b) * 1000) / 1000;

/** Per product: tags expected in the counted place and what they hold, and those read. */
const productsOf = (expected: Tag[], read: Set<string>) =>
  [
    ...expected
      .reduce((rows, tag) => {
        const row = rows.get(tag.productId) ?? {
          productId: tag.productId,
          expectedPacks: 0,
          scannedPacks: 0,
          expectedQuantity: 0,
          scannedQuantity: 0,
        };

        const seen = read.has(tag.epcId);

        return rows.set(tag.productId, {
          ...row,
          expectedPacks: row.expectedPacks + 1,
          scannedPacks: row.scannedPacks + (seen ? 1 : 0),
          expectedQuantity: add(row.expectedQuantity, tag.remaining),
          scannedQuantity: add(row.scannedQuantity, seen ? tag.remaining : 0),
        });
      }, new Map<string, z.output<typeof Product>>())
      .values(),
  ].toSorted((a, b) => a.productId.localeCompare(b.productId));

/**
 * What a read means for the counted place (a zone, or one location in it):
 * matched — read, holds stock, belongs here; missing — belongs here, not read; unknown — read,
 * never registered; no stock — read, but empty or replaced; other zone — read, holds stock,
 * registered at another zone or location. Missing and other-zone lists are complete, since
 * approving acts on them; the others are samples.
 */
const compareCount = (read: string[], expected: Tag[], known: Tag[], here: (t: Tag) => boolean) => {
  const readSet = new Set(read);
  const knownIds = new Set(known.map((tag) => tag.epcId));
  const live = (tag: Tag) => LIVE_STATUSES.some((status) => status === tag.status);
  const missing = expected.filter((tag) => !readSet.has(tag.epcId)).map((tag) => tag.epcId);
  const unknown = read.filter((epcId) => !knownIds.has(epcId));
  const noStock = known.filter((tag) => !live(tag)).map((tag) => tag.epcId);
  const otherZone = known.filter((tag) => live(tag) && !here(tag)).map((tag) => tag.epcId);

  return {
    counts: {
      scannedCount: read.length,
      matchedCount: expected.length - missing.length,
      missingCount: missing.length,
      unknownCount: unknown.length,
      noStockCount: noStock.length,
      otherZoneCount: otherZone.length,
      missingEpcIds: missing,
      unknownEpcIds: sample(unknown),
      noStockEpcIds: sample(noStock),
      otherZoneEpcIds: otherZone,
    },
    products: productsOf(expected, readSet),
  };
};

const tagColumns = {
  epcId: rfidTags.epcId,
  productId: rfidTags.productId,
  zoneId: rfidTags.zoneId,
  locationId: rfidTags.locationId,
  status: rfidTags.status,
  remaining: rfidTags.remaining,
};

export const withProducts = async (tx: Tx, rows: Omit<z.output<typeof Scan>, 'products'>[]) => {
  const products = rows.length
    ? await tx
        .select({
          scanId: scanProducts.scanId,
          productId: scanProducts.productId,
          expectedPacks: scanProducts.expectedPacks,
          scannedPacks: scanProducts.scannedPacks,
          expectedQuantity: scanProducts.expectedQuantity,
          scannedQuantity: scanProducts.scannedQuantity,
        })
        .from(scanProducts)
        .where(
          inArray(
            scanProducts.scanId,
            rows.map((row) => row.id),
          ),
        )
        .orderBy(scanProducts.productId)
    : [];

  return rows.map((row) => ({
    ...row,
    products: products.flatMap(({ scanId, ...product }) => (scanId === row.id ? [product] : [])),
  }));
};

/** Counts, newest first, of one zone or all, with their result per product. */
const list = reads(PERMISSIONS.view)
  .route({ method: 'GET' })
  .input(
    z.object({
      zoneId: Id.optional(),
      status: z.enum(SCAN_STATUSES).optional(),
      filter: FilterParam.optional(),
      ...Page,
    }),
  )
  .output(z.object({ items: z.array(Scan), nextCursor: z.string().nullable() }))
  .handler(async ({ input, context: { tx, member } }) => {
    const rows = await tx
      .select(columns)
      .from(scans)
      .where(
        and(
          input.zoneId ? eq(scans.zoneId, input.zoneId) : undefined,
          input.status ? eq(scans.status, input.status) : undefined,
          compileFilter(FILTER_FIELDS, input.filter, { me: member.userId }),
          after(input.cursor, scans),
        ),
      )
      .orderBy(desc(scans.createdAt), desc(scans.id))
      .limit(input.limit + 1);

    const page = pageOf(rows, input.limit);

    return { items: await withProducts(tx, page.items), nextCursor: page.nextCursor };
  });

/** One count with its result, for its panel. */
const get = reads(PERMISSIONS.view)
  .route({ method: 'GET' })
  .input(z.object({ id: Id }))
  .output(Scan)
  .handler(async ({ input, context: { tx } }) => {
    const [scan] = await withProducts(
      tx,
      await tx.select(columns).from(scans).where(eq(scans.id, input.id)),
    );

    if (!scan) throw new ORPCError('NOT_FOUND', { message: 'No such count' });

    return scan;
  });

/**
 * The EPCs a reader read in a zone, or at one location in it, compared with the tags there that
 * hold stock. The count is a draft: the stock changes only when someone approves it.
 */
const submit = writes(PERMISSIONS.tags)
  .input(z.object({ zoneId: Id, locationId: Id.optional(), epcIds: EpcList(LIMITS.scanEpcs) }))
  .output(Scan)
  .handler(async ({ input, context: { tx, member } }) => {
    const [zone] = await tx.select({ id: zones.id }).from(zones).where(eq(zones.id, input.zoneId));

    if (!zone) throw new ORPCError('NOT_FOUND', { message: 'No such zone' });

    if (input.locationId) await locationIn(tx, input.locationId, input.zoneId);

    const here = (tag: Pick<Tag, 'zoneId' | 'locationId'>) =>
      tag.zoneId === input.zoneId &&
      (input.locationId === undefined || tag.locationId === input.locationId);

    const expected = await tx
      .select(tagColumns)
      .from(rfidTags)
      .where(
        and(
          eq(rfidTags.zoneId, input.zoneId),
          input.locationId ? eq(rfidTags.locationId, input.locationId) : undefined,
          inArray(rfidTags.status, LIVE_STATUSES),
        ),
      );

    const known = await tx
      .select(tagColumns)
      .from(rfidTags)
      .where(inArray(rfidTags.epcId, input.epcIds));

    const { counts, products } = compareCount(input.epcIds, expected, known, here);

    const [scan] = await tx
      .insert(scans)
      .values({
        ...counts,
        orgId: member.orgId,
        zoneId: input.zoneId,
        locationId: input.locationId ?? null,
        createdBy: member.userId,
      })
      .returning(columns);

    if (!scan) throw new ORPCError('INTERNAL_SERVER_ERROR');

    if (products.length)
      await tx
        .insert(scanProducts)
        .values(products.map((row) => ({ ...row, orgId: member.orgId, scanId: scan.id })));

    return { ...scan, products };
  });

export const scanReads = { list, get, submit };
