import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { check, index, integer, numeric, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { table } from './table.ts';

const id = () =>
  text()
    .primaryKey()
    .$defaultFn(() => randomUUID());

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/** An amount in the core product's own unit (pieces, metres, kilograms), to three decimals. */
const amount = () => numeric({ precision: 14, scale: 3, mode: 'number' });

/** How a tagged item is packed. The amount inside is in the core product's unit. */
export const PACKAGINGS = ['piece', 'box', 'pack', 'drum', 'roll'] as const;

/**
 * Sealed: unopened, all of it there. Opened: broken or partly issued, `remaining` left.
 * Empty: all issued or written off. Replaced: a new label took over (`replaced_by`).
 * A tag never goes back to sealed.
 */
export const TAG_STATUSES = ['sealed', 'opened', 'empty', 'replaced'] as const;

/** Tags that still hold stock: what counts, issues and breaks work on. */
export const LIVE_STATUSES = ['sealed', 'opened'] as const;

/**
 * What a movement did. break_box opens sealed packs and keeps their amount; issue takes an
 * amount out; relabel moves a tag's stock to a new EPC; count_adjustment applies an approved
 * count (missing tags written off, tags found elsewhere moved here).
 */
export const MOVEMENT_TYPES = ['break_box', 'issue', 'relabel', 'count_adjustment'] as const;

/** A count is a draft until someone who may approve counts approves or rejects it. */
export const SCAN_STATUSES = ['draft', 'approved', 'rejected'] as const;

/** Zone names are unique per organisation, ignoring case. */
export const ZONE_NAME_INDEX = 'storage_zones_org_name_key';

/** An EPC is registered once per organisation. */
export const TAG_EPC_INDEX = 'storage_rfid_tags_org_epc_key';

/** A retried request (same key) finds the first movement instead of making a second. */
export const MOVEMENT_REQUEST_INDEX = 'storage_movements_org_request_key';

/** A location code is unique within its zone, ignoring case. */
export const LOCATION_CODE_INDEX = 'storage_locations_zone_code_key';

/**
 * A warehouse zone, such as a hall. Its shelves and bins are `locations`. `org_id` is the core organisation; row-level security
 * (`core_enable_tenant_rls` in the migration) shows each transaction its organisation's rows.
 */
export const zones = table(
  'zones',
  {
    id: id(),
    orgId: text().notNull(),
    name: text().notNull(),
    createdBy: text().notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('storage_zones_org_created_idx').on(t.orgId, t.createdAt.desc(), t.id.desc()),
    uniqueIndex(ZONE_NAME_INDEX).on(t.orgId, sql`lower(${t.name})`),
  ],
);

/** A shelf or bin in a zone, by its code (A-01-03). Tags may sit at one. */
export const locations = table(
  'locations',
  {
    id: id(),
    orgId: text().notNull(),
    zoneId: text()
      .notNull()
      .references(() => zones.id, { onDelete: 'restrict' }),
    code: text().notNull(),
    createdBy: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('storage_locations_org_zone_idx').on(t.orgId, t.zoneId, t.code),
    uniqueIndex(LOCATION_CODE_INDEX).on(t.orgId, t.zoneId, sql`lower(${t.code})`),
  ],
);

/**
 * A stock movement storage decided (`MOVEMENT_TYPES`). Its lines are `movement_items`, one per
 * product, and the tags it touched are `movement_tags`.
 */
export const movements = table(
  'movements',
  {
    id: id(),
    orgId: text().notNull(),
    requestKey: text().notNull(),
    type: text({ enum: MOVEMENT_TYPES }).notNull(),
    number: text().notNull(),
    zoneId: text()
      .notNull()
      .references(() => zones.id, { onDelete: 'restrict' }),
    createdBy: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('storage_movements_org_created_idx').on(t.orgId, t.createdAt.desc(), t.id.desc()),
    uniqueIndex(MOVEMENT_REQUEST_INDEX).on(t.orgId, t.requestKey),
  ],
);

/** One line per product a movement moved: how many tags, and the amount in the product's unit. */
export const movementItems = table(
  'movement_items',
  {
    id: id(),
    orgId: text().notNull(),
    movementId: text()
      .notNull()
      .references(() => movements.id, { onDelete: 'cascade' }),
    productId: text().notNull(),
    packs: integer().notNull(),
    units: amount().notNull(),
  },
  (t) => [
    uniqueIndex('storage_movement_items_movement_product_key').on(t.movementId, t.productId),
    check('storage_movement_items_amounts_check', sql`${t.packs} > 0 and ${t.units} >= 0`),
  ],
);

/**
 * One RFID tag per packed item: a 96-bit EPC (24 hex characters), the core product inside, how
 * it is packed, its amount and what is left of it, in the product's unit. Tags registered
 * together share `batch_id`. `units_in_pack` and `movement_id` are retired: `quantity` and
 * `movement_tags` replaced them.
 */
export const rfidTags = table(
  'rfid_tags',
  {
    id: id(),
    orgId: text().notNull(),
    epcId: text().notNull(),
    productId: text().notNull(),
    unitsInPack: integer(),
    packaging: text({ enum: PACKAGINGS }).notNull(),
    quantity: amount().notNull(),
    remaining: amount().notNull(),
    zoneId: text()
      .notNull()
      .references(() => zones.id, { onDelete: 'restrict' }),
    locationId: text().references(() => locations.id, { onDelete: 'restrict' }),
    status: text({ enum: TAG_STATUSES }).notNull().default('sealed'),
    replacedBy: text(),
    batchId: text().notNull(),
    movementId: text().references(() => movements.id, { onDelete: 'restrict' }),
    createdBy: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex(TAG_EPC_INDEX).on(t.orgId, t.epcId),
    index('storage_rfid_tags_org_zone_status_idx').on(t.orgId, t.zoneId, t.status, t.productId),
    index('storage_rfid_tags_org_location_idx').on(t.orgId, t.locationId),
    index('storage_rfid_tags_org_created_idx').on(t.orgId, t.createdAt.desc(), t.id.desc()),
    index('storage_rfid_tags_movement_idx').on(t.movementId),
    check('storage_rfid_tags_epc_check', sql`${t.epcId} ~ '^[0-9A-F]{24}$'`),
    check(
      'storage_rfid_tags_amount_check',
      sql`${t.quantity} > 0 and ${t.remaining} >= 0 and ${t.remaining} <= ${t.quantity}`,
    ),
    check(
      'storage_rfid_tags_status_check',
      sql`${t.status} in ('sealed', 'opened', 'empty', 'replaced')
        and (${t.status} <> 'sealed' or ${t.remaining} = ${t.quantity})
        and (${t.status} <> 'empty' or ${t.remaining} = 0)
        and ((${t.status} = 'replaced') = (${t.replacedBy} is not null))`,
    ),
  ],
);

/** Which tags a movement touched, and the amount it took from each (0 when it took none). */
export const movementTags = table(
  'movement_tags',
  {
    id: id(),
    orgId: text().notNull(),
    movementId: text()
      .notNull()
      .references(() => movements.id, { onDelete: 'cascade' }),
    tagId: text()
      .notNull()
      .references(() => rfidTags.id, { onDelete: 'restrict' }),
    taken: amount().notNull(),
  },
  (t) => [
    uniqueIndex('storage_movement_tags_org_movement_tag_key').on(t.orgId, t.movementId, t.tagId),
    index('storage_movement_tags_org_tag_idx').on(t.orgId, t.tagId),
    check('storage_movement_tags_taken_check', sql`${t.taken} >= 0`),
  ],
);

/**
 * A count: what an RFID reader read in a zone, or at one location in it, compared with the tags
 * registered there that still hold stock. The counts are exact; the unknown and opened EPC lists
 * are samples (`LIMITS.scanSample`). Missing and other-zone lists are complete: approving the
 * count writes the missing tags off and moves the others here.
 */
export const scans = table(
  'scans',
  {
    id: id(),
    orgId: text().notNull(),
    zoneId: text()
      .notNull()
      .references(() => zones.id, { onDelete: 'cascade' }),
    locationId: text().references(() => locations.id, { onDelete: 'restrict' }),
    status: text({ enum: SCAN_STATUSES }).notNull().default('draft'),
    reviewedBy: text(),
    reviewedAt: timestamp({ withTimezone: true }),
    movementId: text().references(() => movements.id, { onDelete: 'restrict' }),
    scannedCount: integer().notNull(),
    matchedCount: integer().notNull(),
    missingCount: integer().notNull(),
    unknownCount: integer().notNull(),
    /** Read, but the tag holds no stock (empty or replaced). The column predates the rename. */
    noStockCount: integer('opened_count').notNull(),
    /** Read here, but registered at another zone or location. */
    otherZoneCount: integer().notNull(),
    missingEpcIds: text().array().notNull(),
    unknownEpcIds: text().array().notNull(),
    noStockEpcIds: text('opened_epc_ids').array().notNull(),
    otherZoneEpcIds: text().array().notNull(),
    createdBy: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('storage_scans_org_zone_created_idx').on(t.orgId, t.zoneId, t.createdAt.desc()),
    check(
      'storage_scans_review_check',
      sql`${t.status} in ('draft', 'approved', 'rejected')
        and ((${t.status} = 'draft') = (${t.reviewedBy} is null))
        and ((${t.status} = 'draft') = (${t.reviewedAt} is null))`,
    ),
  ],
);

/** A count's result per product: tags expected and read, and the amounts they hold. */
export const scanProducts = table(
  'scan_products',
  {
    id: id(),
    orgId: text().notNull(),
    scanId: text()
      .notNull()
      .references(() => scans.id, { onDelete: 'cascade' }),
    productId: text().notNull(),
    expectedPacks: integer().notNull(),
    scannedPacks: integer().notNull(),
    expectedQuantity: amount().notNull().default(0),
    scannedQuantity: amount().notNull().default(0),
  },
  (t) => [uniqueIndex('storage_scan_products_scan_product_key').on(t.scanId, t.productId)],
);
