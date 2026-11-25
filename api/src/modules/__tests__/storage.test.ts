import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vite-plus/test';
import { PERMISSIONS } from '#/core.ts';
import { clientAs, epc, key, newOrg } from '#/test/client.ts';

const box = { packaging: 'box', quantity: 1 } as const;

describe('zones and locations', () => {
  it('creates, renames, refuses a taken name and keeps organisations apart', async () => {
    const client = newOrg();
    const zone = await client.zones.create({ name: 'Main warehouse' });

    expect(zone).toMatchObject({ name: 'Main warehouse' });
    expect(zone).not.toHaveProperty('orgId');
    await expect(client.zones.create({ name: 'main WAREHOUSE' })).rejects.toMatchObject({
      code: 'ZONE_NAME_TAKEN',
    });
    await expect(client.zones.rename({ id: zone.id, name: 'Hall A' })).resolves.toMatchObject({
      name: 'Hall A',
    });
    await expect(newOrg().zones.list()).resolves.toEqual([]);
  });

  it('keeps a zone that has tags, and removes an empty one', async () => {
    const client = newOrg();
    const zone = await client.zones.create({ name: 'Hall' });

    await client.tags.register({ productId: 'p1', zoneId: zone.id, ...box, count: 2 });
    await expect(client.zones.remove({ id: zone.id })).rejects.toMatchObject({
      code: 'ZONE_IN_USE',
      data: { tags: 2 },
    });

    const empty = await client.zones.create({ name: 'Empty' });

    await expect(client.zones.remove({ id: empty.id })).resolves.toEqual({ id: empty.id });
  });

  it('keeps codes unique in a zone, refuses a foreign location and keeps a used one', async () => {
    const client = newOrg();
    const hall = await client.zones.create({ name: 'Hall' });
    const yard = await client.zones.create({ name: 'Yard' });
    const shelf = await client.locations.create({ zoneId: hall.id, code: 'A-01' });

    await expect(client.locations.create({ zoneId: hall.id, code: 'a-01' })).rejects.toMatchObject({
      code: 'LOCATION_CODE_TAKEN',
    });
    await expect(client.locations.create({ zoneId: yard.id, code: 'A-01' })).resolves.toMatchObject(
      { code: 'A-01' },
    );
    await expect(client.locations.list({ zoneId: hall.id })).resolves.toMatchObject([
      { id: shelf.id },
    ]);

    // A location belongs to its zone: tags of another zone can't use it.
    await expect(
      client.tags.register({
        productId: 'p1',
        zoneId: yard.id,
        locationId: shelf.id,
        ...box,
        count: 1,
      }),
    ).rejects.toMatchObject({ status: 404 });

    await client.tags.register({
      productId: 'p1',
      zoneId: hall.id,
      locationId: shelf.id,
      ...box,
      count: 1,
    });
    await expect(client.locations.remove({ id: shelf.id })).rejects.toMatchObject({
      code: 'LOCATION_IN_USE',
      data: { tags: 1, counts: 0 },
    });
  });
});

describe('tags', () => {
  it('makes new EPCs or takes the ones read, all or nothing', async () => {
    const client = newOrg();
    const zone = await client.zones.create({ name: 'Hall' });

    const made = await client.tags.register({
      productId: 'p1',
      zoneId: zone.id,
      packaging: 'box',
      quantity: 12,
      count: 3,
    });

    expect(made.epcIds).toHaveLength(3);
    expect(made.epcIds.every((id) => /^[0-9A-F]{24}$/u.test(id))).toBe(true);

    // Read EPCs come in any case and with repeats; a drum holds metres, with decimals.
    const read = await client.tags.register({
      productId: 'p2',
      zoneId: zone.id,
      packaging: 'drum',
      quantity: 300.5,
      epcIds: [epc(1).toLowerCase(), epc(1), epc(2)],
    });

    expect(read.epcIds).toEqual([epc(1), epc(2)]);

    // One taken EPC registers nothing.
    await expect(
      client.tags.register({ productId: 'p3', zoneId: zone.id, ...box, epcIds: [epc(3), epc(2)] }),
    ).rejects.toMatchObject({ code: 'EPC_TAKEN' });
    await expect(client.tags.list({ productId: 'p3' })).resolves.toMatchObject({ items: [] });

    await expect(
      client.tags.register({ productId: 'p3', zoneId: zone.id, ...box, epcIds: ['NOT-AN-EPC'] }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      client.tags.register({ productId: 'p3', zoneId: zone.id, ...box }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      client.tags.register({ productId: 'p3', zoneId: zone.id, ...box, quantity: 0, count: 1 }),
    ).rejects.toMatchObject({ status: 400 });

    // The filter bar's conditions, as core's condition group.
    const byProduct = JSON.stringify({
      match: 'all',
      rules: [{ path: 'subject.productId', op: 'in', value: ['p2'] }],
    });

    await expect(client.tags.list({ filter: byProduct })).resolves.toMatchObject({
      items: [
        { productId: 'p2', packaging: 'drum', quantity: 300.5, remaining: 300.5 },
        { productId: 'p2', packaging: 'drum', quantity: 300.5, remaining: 300.5 },
      ],
    });
    await expect(client.tags.find({ epcId: epc(1).toLowerCase() })).resolves.toMatchObject({
      epcId: epc(1),
      zoneId: zone.id,
    });
    await expect(client.tags.find({ epcId: epc(9) })).rejects.toMatchObject({ status: 404 });

    await expect(client.tags.summary({ zoneId: zone.id })).resolves.toEqual([
      { productId: 'p1', sealedPacks: 3, sealedQuantity: 36, openedPacks: 0, openedQuantity: 0 },
      { productId: 'p2', sealedPacks: 2, sealedQuantity: 601, openedPacks: 0, openedQuantity: 0 },
    ]);
  });

  it('lists in pages, places on shelves and removes only untouched sealed tags', async () => {
    const client = newOrg();
    const zone = await client.zones.create({ name: 'Hall' });
    const shelf = await client.locations.create({ zoneId: zone.id, code: 'B-02' });

    await client.tags.register({
      productId: 'p1',
      zoneId: zone.id,
      ...box,
      epcIds: [epc(1), epc(2), epc(3)],
    });

    const first = await client.tags.list({ limit: 2 });
    const rest = await client.tags.list({ limit: 2, cursor: first.nextCursor ?? '' });

    expect(first.items).toHaveLength(2);
    expect(rest).toMatchObject({ items: [expect.anything()], nextCursor: null });

    await expect(
      client.tags.place({ epcIds: [epc(2), epc(3)], zoneId: zone.id, locationId: shelf.id }),
    ).resolves.toEqual({ placed: 2 });
    await expect(client.tags.list({ locationId: shelf.id })).resolves.toMatchObject({
      items: [expect.anything(), expect.anything()],
    });
    await expect(
      client.tags.place({ epcIds: [epc(2), epc(9)], zoneId: zone.id, locationId: null }),
    ).rejects.toMatchObject({ code: 'TAGS_NOT_PLACEABLE', data: { epcIds: [epc(9)] } });

    await client.movements.breakBoxes({ epcIds: [epc(1)], requestKey: key() });
    await expect(client.tags.remove({ epcIds: [epc(1), epc(2)] })).resolves.toEqual({ removed: 1 });

    // Tags registered together share a time, so compare them in EPC order.
    const left = (await client.tags.list({})).items
      .map((tag) => `${tag.epcId} ${tag.status}`)
      .toSorted();

    expect(left).toEqual([`${epc(1)} opened`, `${epc(3)} sealed`]);
  });
});

describe('breaking packs', () => {
  it('opens packs where they are, keeping what they hold, once per request', async () => {
    const client = newOrg();
    const zone = await client.zones.create({ name: 'Hall' });

    await client.tags.register({
      productId: 'p1',
      zoneId: zone.id,
      packaging: 'box',
      quantity: 12,
      epcIds: [epc(1), epc(2)],
    });
    await client.tags.register({
      productId: 'p2',
      zoneId: zone.id,
      packaging: 'pack',
      quantity: 5,
      epcIds: [epc(3)],
    });

    const requestKey = randomUUID();

    const movement = await client.movements.breakBoxes({
      epcIds: [epc(1), epc(2), epc(3)],
      requestKey,
    });

    expect(movement).toMatchObject({
      type: 'break_box',
      zoneId: zone.id,
      items: [
        { productId: 'p1', packs: 2, units: 24 },
        { productId: 'p2', packs: 1, units: 5 },
      ],
    });

    // A retry returns the first movement; a new request finds the packs opened.
    await expect(
      client.movements.breakBoxes({ epcIds: [epc(1)], requestKey }),
    ).resolves.toMatchObject({ id: movement.id });
    await expect(
      client.movements.breakBoxes({ epcIds: [epc(1)], requestKey: key() }),
    ).rejects.toMatchObject({ code: 'PACKS_OPENED', data: { epcIds: [epc(1)] } });

    // Opening moves nothing out: the stock and its cost stay.
    await expect(client.tags.summary({ zoneId: zone.id })).resolves.toEqual([
      { productId: 'p1', sealedPacks: 0, sealedQuantity: 0, openedPacks: 2, openedQuantity: 24 },
      { productId: 'p2', sealedPacks: 0, sealedQuantity: 0, openedPacks: 1, openedQuantity: 5 },
    ]);
    await expect(client.movements.get({ id: movement.id })).resolves.toMatchObject({
      ...movement,
      tags: [
        { epcId: epc(1), taken: 0 },
        { epcId: epc(2), taken: 0 },
        { epcId: epc(3), taken: 0 },
      ],
    });
  });

  it('refuses unknown EPCs and packs of two zones, changing nothing', async () => {
    const client = newOrg();
    const a = await client.zones.create({ name: 'A' });
    const b = await client.zones.create({ name: 'B' });

    await client.tags.register({ productId: 'p1', zoneId: a.id, ...box, epcIds: [epc(1)] });
    await client.tags.register({ productId: 'p1', zoneId: b.id, ...box, epcIds: [epc(2)] });

    await expect(
      client.movements.breakBoxes({ epcIds: [epc(1), epc(9)], requestKey: key() }),
    ).rejects.toMatchObject({ code: 'EPC_UNKNOWN', data: { epcIds: [epc(9)] } });
    await expect(
      client.movements.breakBoxes({ epcIds: [epc(1), epc(2)], requestKey: key() }),
    ).rejects.toMatchObject({ code: 'ZONES_MIXED' });
    await expect(client.tags.list({ status: 'opened' })).resolves.toMatchObject({ items: [] });
    await expect(client.movements.list({})).resolves.toMatchObject({ items: [] });
  });

  it('opens a pack once when two requests break it at the same time', async () => {
    const client = newOrg();
    const zone = await client.zones.create({ name: 'Hall' });

    await client.tags.register({ productId: 'p1', zoneId: zone.id, ...box, epcIds: [epc(1)] });

    const results = await Promise.allSettled([
      client.movements.breakBoxes({ epcIds: [epc(1)], requestKey: key() }),
      client.movements.breakBoxes({ epcIds: [epc(1)], requestKey: key() }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    await expect(client.movements.list({})).resolves.toMatchObject({ items: [expect.anything()] });
  });
});

describe('permissions', () => {
  it('lets a viewer read and nothing more, and a worker not approve counts', async () => {
    const orgId = `org-${randomUUID()}`;
    const zone = await clientAs(orgId).zones.create({ name: 'Hall' });
    const viewer = clientAs(orgId, [PERMISSIONS.view]);

    await expect(viewer.zones.list()).resolves.toHaveLength(1);
    await expect(viewer.zones.create({ name: 'Other' })).rejects.toMatchObject({ status: 403 });
    await expect(
      viewer.tags.register({ productId: 'p1', zoneId: zone.id, ...box, count: 1 }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      viewer.movements.breakBoxes({ epcIds: [epc(1)], requestKey: key() }),
    ).rejects.toMatchObject({ status: 403 });

    const worker = clientAs(orgId, [PERMISSIONS.view, PERMISSIONS.tags, PERMISSIONS.movements]);
    const scan = await worker.scans.submit({ zoneId: zone.id, epcIds: [epc(1)] });

    await expect(worker.scans.approve({ id: scan.id })).rejects.toMatchObject({ status: 403 });
    await expect(worker.locations.create({ zoneId: zone.id, code: 'A' })).rejects.toMatchObject({
      status: 403,
    });
  });
});
