import type { RouterClient } from '@orpc/server';
import { locationProcedures } from '#/modules/locations.ts';
import { movementReads } from '#/modules/movements.ts';
import { scanReview } from '#/modules/scanReview.ts';
import { scanReads } from '#/modules/scans.ts';
import { stockActions } from '#/modules/stock.ts';
import { tagProcedures } from '#/modules/tags.ts';
import { zoneProcedures } from '#/modules/zones.ts';

/** Every procedure, served at `/api/rpc/<group>/<name>`. */
export const router = {
  zones: zoneProcedures,
  locations: locationProcedures,
  tags: tagProcedures,
  movements: { ...movementReads, ...stockActions },
  scans: { ...scanReads, ...scanReview },
};

/** The typed client the UI builds (`ui/src/orpc.ts`). */
export type Client = RouterClient<typeof router>;
