import { describe, expect, it } from 'vite-plus/test';
import { epc, key, newOrg } from '#/test/client.ts';

describe('issuing', () => {
  it('takes part of a drum, then the rest, and refuses more than is left', async () => {
    const client = newOrg();
    const zone = await client.zones.create({ name: 'Hall' });

    await client.tags.register({
      productId: 'cable',
      zoneId: zone.id,
      packaging: 'drum',
      quantity: 300,
      epcIds: [epc(1)],
    });

    const part = await client.movements.issue({
      lines: [{ epcId: epc(1), amount: 50.25 }],
      requestKey: key(),
    });

    expect(part).toMatchObject({
      type: 'issue',
      items: [{ productId: 'cable', packs: 1, units: 50.25 }],
    });
    await expect(client.tags.find({ epcId: epc(1) })).resolves.toMatchObject({
      status: 'opened',
      quantity: 300,
      remaining: 249.75,
    });

    await expect(
      client.movements.issue({ lines: [{ epcId: epc(1), amount: 300 }], requestKey: key() }),
    ).rejects.toMatchObject({ code: 'NOT_ENOUGH', data: { epcId: epc(1), remaining: 249.75 } });

    // No amount takes all that is left, and the tag is then empty.
    await client.movements.issue({ lines: [{ epcId: epc(1) }], requestKey: key() });
    await expect(client.tags.find({ epcId: epc(1) })).resolves.toMatchObject({
      status: 'empty',
      remaining: 0,
    });
    await expect(
      client.movements.issue({ lines: [{ epcId: epc(1) }], requestKey: key() }),
    ).rejects.toMatchObject({ code: 'NO_STOCK', data: { epcIds: [epc(1)] } });
  });
});

describe('relabelling', () => {
  it('moves the stock to a new EPC and marks the old one replaced', async () => {
    const client = newOrg();
    const zone = await client.zones.create({ name: 'Hall' });
    const shelf = await client.locations.create({ zoneId: zone.id, code: 'C-3' });

    await client.tags.register({
      productId: 'cable',
      zoneId: zone.id,
      locationId: shelf.id,
      packaging: 'drum',
      quantity: 100,
      epcIds: [epc(1), epc(2)],
    });
    await client.movements.issue({ lines: [{ epcId: epc(1), amount: 40 }], requestKey: key() });

    const movement = await client.movements.relabel({
      epcId: epc(1),
      newEpcId: epc(5),
      requestKey: key(),
    });

    expect(movement).toMatchObject({ type: 'relabel', items: [] });

    const fresh = await client.tags.find({ epcId: epc(5) });

    expect(fresh).toMatchObject({
      productId: 'cable',
      packaging: 'drum',
      quantity: 100,
      remaining: 60,
      status: 'opened',
      locationId: shelf.id,
    });
    await expect(client.tags.find({ epcId: epc(1) })).resolves.toMatchObject({
      status: 'replaced',
      replacedBy: fresh.id,
    });
    await expect(
      client.movements.relabel({ epcId: epc(2), newEpcId: epc(5), requestKey: key() }),
    ).rejects.toMatchObject({ code: 'EPC_TAKEN' });
    await expect(
      client.movements.relabel({ epcId: epc(1), newEpcId: epc(6), requestKey: key() }),
    ).rejects.toMatchObject({ code: 'NO_STOCK' });
  });
});

describe('counts', () => {
  it('sorts reads into matched, missing, unknown, no stock and elsewhere, as a draft', async () => {
    const client = newOrg();
    const hall = await client.zones.create({ name: 'Hall' });
    const yard = await client.zones.create({ name: 'Yard' });
    const drum = { packaging: 'drum', quantity: 10 } as const;

    await client.tags.register({
      productId: 'p1',
      zoneId: hall.id,
      ...drum,
      epcIds: [epc(1), epc(2), epc(3), epc(6)],
    });
    await client.tags.register({ productId: 'p2', zoneId: yard.id, ...drum, epcIds: [epc(4)] });
    await client.movements.breakBoxes({ epcIds: [epc(3)], requestKey: key() });
    await client.movements.issue({ lines: [{ epcId: epc(6) }], requestKey: key() });

    const scan = await client.scans.submit({
      zoneId: hall.id,
      epcIds: [epc(1), epc(3), epc(4), epc(5), epc(6)],
    });

    expect(scan).toMatchObject({
      status: 'draft',
      scannedCount: 5,
      matchedCount: 2,
      missingCount: 1,
      unknownCount: 1,
      noStockCount: 1,
      otherZoneCount: 1,
      missingEpcIds: [epc(2)],
      unknownEpcIds: [epc(5)],
      noStockEpcIds: [epc(6)],
      otherZoneEpcIds: [epc(4)],
      products: [
        {
          productId: 'p1',
          expectedPacks: 3,
          scannedPacks: 2,
          expectedQuantity: 30,
          scannedQuantity: 20,
        },
      ],
    });
    await expect(client.scans.list({ zoneId: hall.id })).resolves.toMatchObject({
      items: [{ id: scan.id }],
    });
    await expect(client.scans.get({ id: scan.id })).resolves.toEqual(scan);

    // A draft changes nothing yet.
    await expect(client.tags.find({ epcId: epc(2) })).resolves.toMatchObject({ status: 'sealed' });
  });

  it('applies an approved count: missing written off, found moved here, once', async () => {
    const client = newOrg();
    const hall = await client.zones.create({ name: 'Hall' });
    const yard = await client.zones.create({ name: 'Yard' });
    const shelf = await client.locations.create({ zoneId: hall.id, code: 'A-1' });
    const box = { packaging: 'box', quantity: 6 } as const;

    await client.tags.register({
      productId: 'p1',
      zoneId: hall.id,
      locationId: shelf.id,
      ...box,
      epcIds: [epc(1), epc(2)],
    });
    await client.tags.register({ productId: 'p1', zoneId: hall.id, ...box, epcIds: [epc(3)] });
    await client.tags.register({ productId: 'p1', zoneId: yard.id, ...box, epcIds: [epc(4)] });

    // A shelf count: epc(3) sits in the hall but not on this shelf; epc(4) is in the yard.
    const scan = await client.scans.submit({
      zoneId: hall.id,
      locationId: shelf.id,
      epcIds: [epc(1), epc(3), epc(4)],
    });

    expect(scan).toMatchObject({
      matchedCount: 1,
      missingEpcIds: [epc(2)],
      otherZoneEpcIds: [epc(3), epc(4)],
    });

    const approved = await client.scans.approve({ id: scan.id });

    expect(approved.status).toBe('approved');
    expect(approved.reviewedBy).toMatch(/^user-org-/u);
    expect(approved.movementId).toBeTruthy();
    await expect(client.tags.find({ epcId: epc(2) })).resolves.toMatchObject({
      status: 'empty',
      remaining: 0,
    });
    await expect(client.tags.find({ epcId: epc(4) })).resolves.toMatchObject({
      zoneId: hall.id,
      locationId: shelf.id,
    });
    await expect(client.movements.get({ id: approved.movementId ?? '' })).resolves.toMatchObject({
      type: 'count_adjustment',
      items: [{ productId: 'p1', packs: 1, units: 6 }],
    });
    await expect(client.scans.approve({ id: scan.id })).rejects.toMatchObject({
      code: 'NOT_DRAFT',
      data: { status: 'approved' },
    });
  });

  it('rejects a draft and leaves the stock as it was', async () => {
    const client = newOrg();
    const zone = await client.zones.create({ name: 'Hall' });

    await client.tags.register({
      productId: 'p1',
      zoneId: zone.id,
      packaging: 'piece',
      quantity: 1,
      epcIds: [epc(1)],
    });

    const scan = await client.scans.submit({ zoneId: zone.id, epcIds: [epc(9)] });

    await expect(client.scans.reject({ id: scan.id })).resolves.toMatchObject({
      status: 'rejected',
      movementId: null,
    });
    await expect(client.tags.find({ epcId: epc(1) })).resolves.toMatchObject({ status: 'sealed' });
  });
});
