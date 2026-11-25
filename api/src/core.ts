import type { PluginManifest } from '@erxes/core-contract';
import { createCoreClient } from '@erxes/plugin-sdk';
import { config, PLUGIN } from '#/config.ts';
import { manifestJobs } from '#/jobs.ts';

/**
 * Core, called as this plugin: `core.forOrg(orgId).customers.get({ id })`.
 * Tokens last 15 minutes and carry the scopes the organisation granted.
 * Call core from the API only, outside request transactions.
 */
export const core = createCoreClient({
  coreUrl: config.coreUrl,
  plugin: PLUGIN,
  clientSecret: config.pluginSecret,
});

/** The actions members can be granted in core's roles. */
export const PERMISSIONS = {
  view: 'storage.view',
  zones: 'storage.zones.manage',
  tags: 'storage.tags.manage',
  movements: 'storage.movements.manage',
  counts: 'storage.counts.approve',
} as const;

/**
 * What the plugin adds to core, sent on every start. Every permission,
 * event and kind it names starts with `storage.`; job names are its own.
 * A new scope waits for the owner's approval.
 */
export const manifest = {
  title: 'Storage',
  description:
    'RFID warehouse: zones and shelves, RFID-tagged stock by piece, box or drum, counts and movements',
  version: config.version,
  ui: { remote: 'storage_ui', entry: config.uiEntryUrl },
  // `server.ts` serves the REST routes at /api/v1 and their document here.
  api: {
    url: `${config.publicUrl}/api`,
    docs: [{ audience: 'member', path: '/openapi/member.json' }],
  },
  scopes: [],
  permissions: [
    {
      action: PERMISSIONS.view,
      label: 'View zones, locations, RFID tags, counts and movements',
      group: 'Storage',
    },
    {
      action: PERMISSIONS.zones,
      label: 'Create, rename and remove zones and their locations',
      group: 'Storage',
    },
    {
      action: PERMISSIONS.tags,
      label: 'Register and remove RFID tags, and submit counts',
      group: 'Storage',
    },
    {
      action: PERMISSIONS.movements,
      label: 'Break packs, issue stock and replace labels',
      group: 'Storage',
    },
    {
      action: PERMISSIONS.counts,
      label: 'Approve or reject counts, which changes the stock',
      group: 'Storage',
    },
  ],
  // Ready-made sets owners add to roles; core gives Members the first when the plugin is installed.
  permissionSets: [
    {
      key: 'member',
      label: 'Storage worker',
      description: 'Registers tags, counts zones and breaks packs',
      permissions: [PERMISSIONS.view, PERMISSIONS.tags, PERMISSIONS.movements],
      defaultRoles: ['member'],
    },
    {
      key: 'manager',
      label: 'Storage manager',
      description: 'Everything a worker does, sets up zones and approves counts',
      permissions: Object.values(PERMISSIONS),
    },
  ],
  jobs: manifestJobs,
} satisfies PluginManifest;
