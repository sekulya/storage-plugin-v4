import { ORPCError } from '@orpc/server';
import { asc, count, eq, getTableColumns } from 'drizzle-orm';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { PERMISSIONS } from '#/core.ts';
import { uniqueViolation } from '#/db/client.ts';
import { LOCATION_CODE_INDEX, locations, rfidTags, scans, zones } from '#/db/schema.ts';
import { reads, writes } from '#/orpc.ts';
import { Id } from './shared.ts';

const { orgId, ...columns } = getTableColumns(locations);

const Location = createSelectSchema(locations).omit({ orgId: true });

const Code = z.string().trim().min(1).max(100);

const createErrors = {
  LOCATION_CODE_TAKEN: {
    status: 409,
    message: 'This zone has a location with this code',
    data: z.object({ code: z.string() }),
  },
};

const removeErrors = {
  LOCATION_IN_USE: {
    status: 409,
    message: 'RFID tags sit at this location, or counts were made there',
    data: z.object({ tags: z.number(), counts: z.number() }),
  },
};

/** A zone's locations, or every location, by code. */
const list = reads(PERMISSIONS.view)
  .route({ method: 'GET' })
  .input(z.object({ zoneId: Id.optional() }))
  .output(z.array(Location))
  .handler(({ input, context: { tx } }) =>
    tx
      .select(columns)
      .from(locations)
      .where(input.zoneId ? eq(locations.zoneId, input.zoneId) : undefined)
      .orderBy(asc(locations.code)),
  );

/** A shelf or bin in a zone, by a code unique in that zone. */
const create = writes(PERMISSIONS.zones)
  .errors(createErrors)
  .input(z.object({ zoneId: Id, code: Code }))
  .output(Location)
  .handler(async ({ input, context: { tx, member }, errors }) => {
    const [zone] = await tx.select({ id: zones.id }).from(zones).where(eq(zones.id, input.zoneId));

    if (!zone) throw new ORPCError('NOT_FOUND', { message: 'No such zone' });

    const [location] = await tx
      .insert(locations)
      .values({ ...input, orgId: member.orgId, createdBy: member.userId })
      .returning(columns)
      .catch((error: unknown) => {
        if (uniqueViolation(error) === LOCATION_CODE_INDEX)
          throw errors.LOCATION_CODE_TAKEN({ data: { code: input.code } });

        throw error;
      });

    if (!location) throw new ORPCError('INTERNAL_SERVER_ERROR');

    return location;
  });

/** A location where tags sit, or that was counted, stays; an unused one goes. */
const remove = writes(PERMISSIONS.zones)
  .errors(removeErrors)
  .input(z.object({ id: Id }))
  .output(z.object({ id: z.string() }))
  .handler(async ({ input, context: { tx }, errors }) => {
    const [tags] = await tx
      .select({ count: count() })
      .from(rfidTags)
      .where(eq(rfidTags.locationId, input.id));

    const [counted] = await tx
      .select({ count: count() })
      .from(scans)
      .where(eq(scans.locationId, input.id));

    if (tags?.count || counted?.count)
      throw errors.LOCATION_IN_USE({
        data: { tags: tags?.count ?? 0, counts: counted?.count ?? 0 },
      });

    const [location] = await tx
      .delete(locations)
      .where(eq(locations.id, input.id))
      .returning({ id: locations.id });

    if (!location) throw new ORPCError('NOT_FOUND', { message: 'No such location' });

    return location;
  });

export const locationProcedures = { list, create, remove };
