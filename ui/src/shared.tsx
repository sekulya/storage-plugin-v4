import { productSearchQueries } from '@erxes/core-contract/client';
import type { InferClientOutputs } from '@orpc/client';
import type { Client } from '@storage/api';
import { useQuery } from '@tanstack/react-query';
import { Select, Skeleton, Textarea, useProductOptions } from 'erxes-ui';
import { useTranslation } from 'react-i18next';
import { orpc, PLUGIN } from '~/orpc.ts';

type Outputs = InferClientOutputs<Client>;

export type Zone = Outputs['zones']['create'];

export type Tag = Outputs['tags']['get'];

export type Movement = Outputs['movements']['list']['items'][number];

export type Count = Outputs['scans']['get'];

/** Records core's side panel opens: `useOpenRecord().open({ contentType, contentId })`. */
export const TYPES = {
  zone: `${PLUGIN}:zone`,
  tag: `${PLUGIN}:tag`,
  movement: `${PLUGIN}:movement`,
  count: `${PLUGIN}:count`,
} as const;

export type Packaging = Tag['packaging'];

/** The packagings, in the order forms list them. */
export const PACKAGINGS = ['piece', 'box', 'pack', 'drum', 'roll'] as const satisfies Packaging[];

/** What each enum value reads as, translated once for every page. */
export const useLabels = () => {
  const { t } = useTranslation('storage');

  return {
    packaging: {
      piece: t('piece', 'Piece'),
      box: t('box', 'Box'),
      pack: t('pack', 'Pack'),
      drum: t('drum', 'Drum'),
      roll: t('roll', 'Roll'),
    } satisfies Record<Packaging, string>,
    status: {
      sealed: t('sealed', 'Sealed'),
      opened: t('opened', 'Opened'),
      empty: t('empty', 'Empty'),
      replaced: t('replaced', 'Replaced'),
    } satisfies Record<Tag['status'], string>,
    movement: {
      break_box: t('break-box', 'Break packs'),
      issue: t('issue', 'Issue'),
      relabel: t('relabel', 'Relabel'),
      count_adjustment: t('count-adjustment', 'Count adjustment'),
    } satisfies Record<Movement['type'], string>,
    count: {
      draft: t('draft', 'Draft'),
      approved: t('approved', 'Approved'),
      rejected: t('rejected', 'Rejected'),
    } satisfies Record<Count['status'], string>,
  };
};

/** A zone's locations, by code; every location when no zone is given. */
export const useLocations = (zoneId?: string) =>
  useQuery(orpc.locations.list.queryOptions({ input: zoneId ? { zoneId } : {} }));

/** A location's code by id, or a dash for none. */
export const LocationName = ({ id }: { id: string | null }) => {
  const locations = useLocations();

  if (!id) return <span className="text-muted-foreground">—</span>;

  if (locations.isPending) return <Skeleton className="h-4 w-16" />;

  return (
    <span className="truncate">
      {locations.data?.find((location) => location.id === id)?.code ?? id}
    </span>
  );
};

/** No location, in the location select. Radix Select can't take an empty value. */
export const NO_LOCATION = 'none';

/** A location of the zone, or none, as a form field. */
export const LocationSelect = ({
  id,
  zoneId,
  value,
  onValueChange,
}: {
  id: string;
  zoneId: string;
  value: string;
  onValueChange: (value: string) => void;
}) => {
  const { t } = useTranslation('storage');
  const locations = useLocations(zoneId);

  return (
    <Select value={value} onValueChange={onValueChange} disabled={!zoneId || locations.isPending}>
      <Select.Trigger id={id}>
        <Select.Value placeholder={t('pick-location', 'No location')} />
      </Select.Trigger>
      <Select.Content>
        <Select.Item value={NO_LOCATION}>{t('no-location', 'No location')}</Select.Item>
        {(locations.data ?? []).map((location) => (
          <Select.Item key={location.id} value={location.id}>
            {location.code}
          </Select.Item>
        ))}
      </Select.Content>
    </Select>
  );
};

/** How an item is packed, as a form field. */
export const PackagingSelect = ({
  id,
  value,
  onValueChange,
}: {
  id: string;
  value: Packaging;
  onValueChange: (value: Packaging) => void;
}) => {
  const labels = useLabels();

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        const found = PACKAGINGS.find((packaging) => packaging === next);

        if (found) onValueChange(found);
      }}
    >
      <Select.Trigger id={id}>
        <Select.Value />
      </Select.Trigger>
      <Select.Content>
        {PACKAGINGS.map((packaging) => (
          <Select.Item key={packaging} value={packaging}>
            {labels.packaging[packaging]}
          </Select.Item>
        ))}
      </Select.Content>
    </Select>
  );
};

/** The organisation's zones, by name. */
export const useZones = () => useQuery(orpc.zones.list.queryOptions());

/** A zone's name by id, from the one zone list every page shares. */
export const ZoneName = ({ id }: { id: string }) => {
  const zones = useZones();

  if (zones.isPending) return <Skeleton className="h-4 w-20" />;

  return <span className="truncate">{zones.data?.find((zone) => zone.id === id)?.name ?? id}</span>;
};

/** Products from core's catalog, by id: storage keeps only their ids. */
const useProductNames = (ids: readonly string[]) => {
  const products = useQuery({ ...productSearchQueries.byIds([...ids]), enabled: ids.length > 0 });

  return new Map(
    (products.data?.data ?? []).map((product) => [
      product.id,
      product.code ? `${product.name} · ${product.code}` : product.name,
    ]),
  );
};

export const ProductName = ({ id }: { id: string }) => (
  <span className="truncate">{useProductNames([id]).get(id) ?? id}</span>
);

/** A product from core's catalog, as a form field. */
export const ProductSelect = ({
  id,
  value,
  onValueChange,
}: {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
}) => {
  const { t } = useTranslation('storage');
  const { options, loading } = useProductOptions(productSearchQueries, true, value ? [value] : []);

  return (
    <Select value={value} onValueChange={onValueChange} disabled={loading}>
      <Select.Trigger id={id}>
        <Select.Value placeholder={t('pick-product', 'Pick a product')} />
      </Select.Trigger>
      <Select.Content>
        {options.map((option) => (
          <Select.Item key={option.value} value={option.value}>
            {option.label}
          </Select.Item>
        ))}
      </Select.Content>
    </Select>
  );
};

/** A zone, as a form field. */
export const ZoneSelect = ({
  id,
  value,
  onValueChange,
}: {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
}) => {
  const { t } = useTranslation('storage');
  const zones = useZones();

  return (
    <Select value={value} onValueChange={onValueChange} disabled={zones.isPending}>
      <Select.Trigger id={id}>
        <Select.Value placeholder={t('pick-zone', 'Pick a zone')} />
      </Select.Trigger>
      <Select.Content>
        {(zones.data ?? []).map((zone) => (
          <Select.Item key={zone.id} value={zone.id}>
            {zone.name}
          </Select.Item>
        ))}
      </Select.Content>
    </Select>
  );
};

/** The EPCs in what a reader exported or a member pasted: one per line, comma or space. */
export const epcsOf = (text: string) => text.split(/[\s,;]+/u).filter(Boolean);

/** A box for EPCs, as an RFID reader exports them. */
export const EpcInput = ({ id, name }: { id: string; name: string }) => (
  <Textarea id={id} name={name} rows={8} />
);
