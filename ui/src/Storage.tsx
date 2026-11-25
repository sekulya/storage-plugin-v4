import { IconArrowsExchange, IconListCheck, IconSettings, IconTag } from '@tabler/icons-react';
import {
  addPluginStyles,
  AppLayout,
  AppLayoutFooterLink,
  NavigationMenuLinkItem,
  RecordPage,
} from 'erxes-ui';
import { useTranslation } from 'react-i18next';
import { Route, Routes, useParams } from 'react-router-dom';
import { CountsPage } from '@/counts/CountsPage.tsx';
import { MovementsPage } from '@/movements/MovementsPage.tsx';
import { TagsPage } from '@/tags/TagsPage.tsx';
import { ZonesSettingsPage } from '@/zones/ZonesSettingsPage.tsx';
import { PLUGIN } from '~/orpc.ts';
import { TYPES } from '~/shared.tsx';
import css from './styles.css?inline';

addPluginStyles(PLUGIN, css);

/** Where each record's panel expands to: core draws it full size. */
const Expanded = ({ contentType, listPath }: { contentType: string; listPath: string }) => (
  <RecordPage contentType={contentType} contentId={useParams().id ?? ''} listPath={listPath} />
);

const StorageNav = () => {
  const { t } = useTranslation('storage');

  return (
    <>
      <NavigationMenuLinkItem name={t('tags', 'RFID tags')} icon={IconTag} to={`/${PLUGIN}`} />
      <NavigationMenuLinkItem
        name={t('movements', 'Movements')}
        icon={IconArrowsExchange}
        to={`/${PLUGIN}/movements`}
      />
      <NavigationMenuLinkItem
        name={t('counts', 'Counts')}
        icon={IconListCheck}
        to={`/${PLUGIN}/counts`}
      />
    </>
  );
};

/** The page module web renders under `/storage/*` (loaded as `storage_ui/storage`). */
export const Storage = () => {
  const { t } = useTranslation('storage');

  return (
    <AppLayout
      id={PLUGIN}
      title={t('storage', 'Storage')}
      sidebar={<StorageNav />}
      footer={
        <AppLayoutFooterLink
          to={`/${PLUGIN}/settings/zones`}
          name={t('settings', 'Settings')}
          icon={IconSettings}
        />
      }
    >
      <Routes>
        <Route index element={<TagsPage />} />
        <Route
          path="tags/:id"
          element={<Expanded contentType={TYPES.tag} listPath={`/${PLUGIN}`} />}
        />
        <Route path="movements" element={<MovementsPage />} />
        <Route
          path="movements/:id"
          element={<Expanded contentType={TYPES.movement} listPath={`/${PLUGIN}/movements`} />}
        />
        <Route path="counts" element={<CountsPage />} />
        <Route
          path="counts/:id"
          element={<Expanded contentType={TYPES.count} listPath={`/${PLUGIN}/counts`} />}
        />
        <Route path="settings/zones" element={<ZonesSettingsPage />} />
        <Route
          path="settings/zones/:id"
          element={<Expanded contentType={TYPES.zone} listPath={`/${PLUGIN}/settings/zones`} />}
        />
      </Routes>
    </AppLayout>
  );
};
