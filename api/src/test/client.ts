import { randomUUID } from 'node:crypto';
import type { PluginMember } from '@erxes/plugin-sdk';
import { createRouterClient } from '@orpc/server';
import { PERMISSIONS } from '#/core.ts';
import { router } from '#/router.ts';

/** The typed client the UI uses, served in-process as this member. */
export const clientAs = (orgId: string, permissions: string[] = Object.values(PERMISSIONS)) => {
  const member: PluginMember = {
    userId: `user-${orgId}`,
    orgId,
    role: 'member',
    permissions,
    can: (action) => permissions.includes(action),
    tier: 'pro',
    access: 'full',
    canChange: () => true,
    saas: false,
    bundles: [],
  };

  return createRouterClient(router, { context: { member } });
};

/** A fresh organisation, so tests never see each other's EPCs. */
export const newOrg = () => clientAs(`org-${randomUUID()}`);

/** The EPC numbered `n`: 24 hex characters. */
export const epc = (n: number) => n.toString(16).toUpperCase().padStart(24, '0');

/** One request key per action. */
export const key = () => randomUUID();
