import {
  IconArrowsExchange,
  IconBuildingWarehouse,
  IconListCheck,
  IconMapPin,
  IconTag,
} from '@tabler/icons-react';
import type { IUIConfig } from 'erxes-ui';
import { lazy } from 'react';
import { PLUGIN } from '~/orpc.ts';
import { TYPES } from '~/shared.tsx';

// Loaded when a record first opens: web loads `./config` for every page.
const zone = () => import('@/zones/ZonePanel.tsx');
const tag = () => import('@/tags/TagPanel.tsx');
const tagNew = () => import('@/tags/TagNew.tsx');
const movement = () => import('@/movements/MovementPanel.tsx');
const count = () => import('@/counts/CountPanel.tsx');

const at = (path: string) => (id: string) => `/${PLUGIN}/${path}/${encodeURIComponent(id)}`;

/**
 * What web reads from `./config`: the app, the page module under `/storage/*`, its settings,
 * and the records core's side panel opens: zones, tags, movements and counts.
 */
export const CONFIG: IUIConfig = {
  name: PLUGIN,
  path: PLUGIN,
  icon: IconBuildingWarehouse,
  modules: [{ name: PLUGIN, path: PLUGIN, icon: IconBuildingWarehouse }],
  settings: [{ path: 'settings/zones', label: 'Zones', icon: IconMapPin }],
  recordTypes: [
    {
      contentType: TYPES.zone,
      title: 'Zone',
      icon: IconMapPin,
      detailPath: at('settings/zones'),
      Title: lazy(async () => ({ default: (await zone()).ZoneTitle })),
      Detail: lazy(async () => ({ default: (await zone()).ZoneDetail })),
      New: lazy(async () => ({ default: (await zone()).ZoneNew })),
    },
    {
      contentType: TYPES.tag,
      title: 'RFID tag',
      icon: IconTag,
      detailPath: at('tags'),
      Title: lazy(async () => ({ default: (await tag()).TagTitle })),
      Detail: lazy(async () => ({ default: (await tag()).TagDetail })),
      New: lazy(async () => ({ default: (await tagNew()).TagNew })),
    },
    {
      contentType: TYPES.movement,
      title: 'Movement',
      icon: IconArrowsExchange,
      detailPath: at('movements'),
      Title: lazy(async () => ({ default: (await movement()).MovementTitle })),
      Detail: lazy(async () => ({ default: (await movement()).MovementDetail })),
      New: lazy(async () => ({ default: (await movement()).MovementNew })),
    },
    {
      contentType: TYPES.count,
      title: 'Count',
      icon: IconListCheck,
      detailPath: at('counts'),
      Title: lazy(async () => ({ default: (await count()).CountTitle })),
      Detail: lazy(async () => ({ default: (await count()).CountDetail })),
      New: lazy(async () => ({ default: (await count()).CountNew })),
    },
  ],
};
