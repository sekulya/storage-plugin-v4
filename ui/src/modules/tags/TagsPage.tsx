import { memberQueries, productSearchQueries } from '@erxes/core-contract/client';
import { IconPlus, IconTag } from '@tabler/icons-react';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  ListFilter,
  PageContainer,
  PageHeader,
  type RecordTableColumnDef,
  type TListFilterField,
  useFormat,
  useListFilterParams,
  useOpenRecord,
  ViewBar,
} from 'erxes-ui';
import { useTranslation } from 'react-i18next';
import { ListTable } from '~/ListTable.tsx';
import { orpc } from '~/orpc.ts';
import {
  LocationName,
  PACKAGINGS,
  ProductName,
  type Tag,
  TYPES,
  useLabels,
  useLocations,
  useZones,
  ZoneName,
} from '~/shared.tsx';

const EpcCell = ({ tag }: { tag: Tag }) => {
  const { open } = useOpenRecord();

  return (
    <Button
      variant="ghost"
      className="w-full justify-start"
      onClick={() => open({ contentType: TYPES.tag, contentId: tag.id })}
    >
      <span className="font-mono text-xs">{tag.epcId}</span>
    </Button>
  );
};

const BADGES = {
  sealed: 'success',
  opened: 'secondary',
  empty: 'default',
  replaced: 'default',
} as const satisfies Record<Tag['status'], 'success' | 'secondary' | 'default'>;

const StatusCell = ({ tag }: { tag: Tag }) => (
  <span className="px-2">
    <Badge variant={BADGES[tag.status]}>{useLabels().status[tag.status]}</Badge>
  </span>
);

/** What is left of what the tag held, with its packaging: "249.75 / 300 · Drum". */
const AmountCell = ({ tag }: { tag: Tag }) => {
  const format = useFormat();
  const labels = useLabels();

  return (
    <span className="truncate px-2">
      {tag.remaining === tag.quantity
        ? format.number(tag.quantity)
        : `${format.number(tag.remaining)} / ${format.number(tag.quantity)}`}
      <span className="text-muted-foreground"> · {labels.packaging[tag.packaging]}</span>
    </span>
  );
};

const CreatedCell = ({ tag }: { tag: Tag }) => (
  <span className="px-2">{useFormat().dateTime(tag.createdAt)}</span>
);

const columns: RecordTableColumnDef<Tag>[] = [
  { id: 'epcId', header: 'EPC', size: 240, cell: ({ row }) => <EpcCell tag={row.original} /> },
  {
    id: 'productId',
    header: 'Product',
    size: 260,
    cell: ({ row }) => (
      <span className="px-2">
        <ProductName id={row.original.productId} />
      </span>
    ),
  },
  {
    id: 'remaining',
    header: 'Amount',
    size: 160,
    cell: ({ row }) => <AmountCell tag={row.original} />,
  },
  {
    id: 'zoneId',
    header: 'Zone',
    size: 160,
    cell: ({ row }) => (
      <span className="px-2">
        <ZoneName id={row.original.zoneId} />
      </span>
    ),
  },
  {
    id: 'locationId',
    header: 'Location',
    size: 110,
    cell: ({ row }) => (
      <span className="px-2">
        <LocationName id={row.original.locationId} />
      </span>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    size: 110,
    cell: ({ row }) => <StatusCell tag={row.original} />,
  },
  {
    id: 'createdAt',
    header: 'Registered',
    size: 180,
    cell: ({ row }) => <CreatedCell tag={row.original} />,
  },
];

/** What the filter bar filters tags by: the API's `FILTER_FIELDS` in `api/src/modules/tags.ts`. */
const useFilterFields = (): TListFilterField[] => {
  const { t } = useTranslation('storage');
  const zones = useZones();
  const locations = useLocations();
  const labels = useLabels();

  return [
    {
      path: 'subject.zoneId',
      label: t('zone', 'Zone'),
      type: 'select',
      options: (zones.data ?? []).map((zone) => ({ value: zone.id, label: zone.name })),
    },
    {
      path: 'subject.locationId',
      label: t('location', 'Location'),
      type: 'select',
      options: (locations.data ?? []).map((location) => ({
        value: location.id,
        label: location.code,
      })),
    },
    { path: 'subject.productId', label: t('product', 'Product'), type: 'product' },
    {
      path: 'subject.packaging',
      label: t('packaging', 'Packaging'),
      type: 'select',
      options: PACKAGINGS.map((packaging) => ({
        value: packaging,
        label: labels.packaging[packaging],
      })),
    },
    {
      path: 'subject.status',
      label: t('status', 'Status'),
      type: 'select',
      options: Object.entries(labels.status).map(([value, label]) => ({ value, label })),
    },
    { path: 'subject.createdAt', label: t('registered', 'Registered'), type: 'date' },
    { path: 'subject.createdBy', label: t('registered-by', 'Registered by'), type: 'member' },
  ];
};

/** Every RFID tag, newest first, under core's list bar. Register tags opens its form in the side panel. */
export const TagsPage = () => {
  const { t } = useTranslation('storage');
  const { openNew } = useOpenRecord();
  const filters = useListFilterParams();

  const tags = useInfiniteQuery(
    orpc.tags.list.infiniteOptions({
      input: (cursor: string | undefined) => ({ cursor, ...filters }),
      initialPageParam: undefined,
      getNextPageParam: (page) => page.nextCursor ?? undefined,
    }),
  );

  const list = tags.data?.pages.flatMap((page) => page.items) ?? [];

  const fields = useFilterFields();

  return (
    <PageContainer>
      <PageHeader>
        <PageHeader.Start>
          <IconTag />
          <h1 className="text-sm font-semibold">{t('tags', 'RFID tags')}</h1>
        </PageHeader.Start>
        <PageHeader.End>
          <Button onClick={() => openNew(TYPES.tag)}>
            <IconPlus />
            {t('register', 'Register tags')}
          </Button>
        </PageHeader.End>
      </PageHeader>
      <ViewBar recordType={TYPES.tag} allLabel={t('all-tags', 'All tags')}>
        <ListFilter
          id="storage-tags"
          recordType={TYPES.tag}
          fields={fields}
          members={memberQueries}
          products={productSearchQueries}
          totalCount={tags.isPending ? undefined : list.length}
          totalCapped={tags.hasNextPage}
        />
      </ViewBar>
      <ListTable
        tableId="storage_tags"
        columns={columns}
        rows={list}
        pending={tags.isPending}
        error={tags.error}
        hasNextPage={tags.hasNextPage}
        fetchNextPage={() => void tags.fetchNextPage()}
        emptyTitle={t('no-tags', 'No tags yet')}
        emptyHint={t('no-tags-hint', 'Register one RFID tag per box, drum or piece.')}
      />
    </PageContainer>
  );
};
