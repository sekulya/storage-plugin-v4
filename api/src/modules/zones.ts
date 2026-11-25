import { type ORPCErrorConstructorMap, ORPCError } from '@orpc/server';
import { asc, count, eq, getTableColumns } from 'drizzle-orm';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { PERMISSIONS } from '#/core.ts';
import { uniqueViolation } from '#/db/client.ts';
import { rfidTags, ZONE_NAME_INDEX, zones } from '#/db/schema.ts';
import { reads, writes } from '#/orpc.ts';
import { Id } from './shared.ts';

const { orgId, ...columns } = getTableColumns(zones);

const Zone = createSelectSchema(zones).omit({ orgId: true });

const Name = z.string().trim().min(1).max(200);

const zoneErrors = {
  ZONE_NAME_TAKEN: {
    status: 409,
    message: 'Another zone has this name',
    data: z.object({ name: z.string() }),
  },
};

const removeErrors = {
  ZONE_IN_USE: {
    status: 409,
    message: 'RFID tags are registered in this zone: remove them first',
    data: z.object({ tags: z.number() }),
  },
};

/** The one place Postgres's 23505 on the name index becomes ZONE_NAME_TAKEN. */
const nameTaken =
  (errors: ORPCErrorConstructorMap<typeof zoneErrors>, name: string) =>
  (error: unknown): never => {
    if (uniqueViolation(error) === ZONE_NAME_INDEX)
      throw errors.ZONE_NAME_TAKEN({ data: { name } });

    throw error;
  };

/** Every zone, by name: an organisation has a handful. */
const list = reads(PERMISSIONS.view)
  .route({ method: 'GET' })
  .output(z.array(Zone))
  .handler(({ context: { tx } }) => tx.select(columns).from(zones).orderBy(asc(zones.name)));

const create = writes(PERMISSIONS.zones)
  .errors(zoneErrors)
  .input(z.object({ name: Name }))
  .output(Zone)
  .handler(async ({ input, context: { tx, member }, errors }) => {
    const [zone] = await tx
      .insert(zones)
      .values({ name: input.name, orgId: member.orgId, createdBy: member.userId })
      .returning(columns)
      .catch(nameTaken(errors, input.name));

    if (!zone) throw new ORPCError('INTERNAL_SERVER_ERROR');

    return zone;
  });

const rename = writes(PERMISSIONS.zones)
  .errors(zoneErrors)
  .input(z.object({ id: Id, name: Name }))
  .output(Zone)
  .handler(async ({ input, context: { tx }, errors }) => {
    const [zone] = await tx
      .update(zones)
      .set({ name: input.name })
      .where(eq(zones.id, input.id))
      .returning(columns)
      .catch(nameTaken(errors, input.name));

    if (!zone) throw new ORPCError('NOT_FOUND', { message: 'No such zone' });

    return zone;
  });

/** A zone with tags stays: its packs and movements need it. Its counts go with it. */
const remove = writes(PERMISSIONS.zones)
  .errors(removeErrors)
  .input(z.object({ id: Id }))
  .output(z.object({ id: z.string() }))
  .handler(async ({ input, context: { tx }, errors }) => {
    const [tags] = await tx
      .select({ count: count() })
      .from(rfidTags)
      .where(eq(rfidTags.zoneId, input.id));

    if (tags?.count) throw errors.ZONE_IN_USE({ data: { tags: tags.count } });

    const [zone] = await tx.delete(zones).where(eq(zones.id, input.id)).returning({ id: zones.id });

    if (!zone) throw new ORPCError('NOT_FOUND', { message: 'No such zone' });

    return zone;
  });

export const zoneProcedures = { list, create, rename, remove };
