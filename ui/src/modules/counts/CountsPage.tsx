import { memberQueries } from '@erxes/core-contract/client';
import { IconListCheck, IconScan } from '@tabler/icons-react';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  ListFilter,
  MemberInline,
  PageContainer,
  PageHeader,
  type RecordTableColumnDef,
  RecordTableInlineCell,
  type TListFilterField,
  useFormat,
  useListFilterParams,
  useOpenRecord,
  ViewBar,
} from 'erxes-ui';
import { useTranslation } from 'react-i18next';
import { ListTable } from '~/ListTable.tsx';
import { orpc } from '~/orpc.ts';
import { type Count, LocationName, TYPES, useLabels, useZones, ZoneName } from '~/shared.tsx';

const WhenCell = ({ count }: { count: Count }) => {
  const { open } = useOpenRecord();

  return (
    <Button
      variant="ghost"
      className="w-full justify-start"
      onClick={() => open({ contentType: TYPES.count, contentId: count.id })}
    >
      {useFormat().dateTime(count.createdAt)}
    </Button>
  );
};

/** Matched, then every kind of read that doesn't add up, leaving out the zeros. */
const ResultCell = ({ count }: { count: Count }) => {
  const { t } = useTranslation('storage');

  const parts = [
    t('n-matched', '{{n}} matched', { n: count.matchedCount }),
    count.missingCount && t('n-missing', '{{n}} missing', { n: count.missingCount }),
    count.unknownCount && t('n-unknown', '{{n}} unknown', { n: count.unknownCount }),
    count.noStockCount && t('n-no-stock', '{{n}} no stock', { n: count.noStockCount }),
    count.otherZoneCount && t('n-elsewhere', '{{n}} elsewhere', { n: count.otherZoneCount }),
  ].filter(Boolean);

  return <span className="truncate px-2">{parts.join(', ')}</span>;
};

const STATUS_BADGES = {
  draft: 'secondary',
  approved: 'success',
  rejected: 'default',
} as const satisfies Record<Count['status'], 'success' | 'secondary' | 'default'>;

const StatusCell = ({ count }: { count: Count }) => (
  <span className="px-2">
    <Badge variant={STATUS_BADGES[count.status]}>{useLabels().count[count.status]}</Badge>
  </span>
);

const columns: RecordTableColumnDef<Count>[] = [
  {
    id: 'createdAt',
    header: 'When',
    size: 200,
    cell: ({ row }) => <WhenCell count={row.original} />,
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
    id: 'result',
    header: 'Result',
    size: 360,
    cell: ({ row }) => <ResultCell count={row.original} />,
  },
  {
    id: 'status',
    header: 'Status',
    size: 110,
    cell: ({ row }) => <StatusCell count={row.original} />,
  },
  {
    id: 'createdBy',
    header: 'By',
    size: 200,
    cell: ({ row }) => (
      <RecordTableInlineCell>
        <MemberInline memberId={row.original.createdBy} members={memberQueries} />
      </RecordTableInlineCell>
    ),
  },
];

/** Counts, newest first: what an RFID reader read in a zone or on a shelf, against its stock. */
export const CountsPage = () => {
  const { t } = useTranslation('storage');
  const { openNew } = useOpenRecord();
  const filters = useListFilterParams();
  const zones = useZones();
  const labels = useLabels();

  const counts = useInfiniteQuery(
    orpc.scans.list.infiniteOptions({
      input: (cursor: string | undefined) => ({ cursor, ...filters }),
      initialPageParam: undefined,
      getNextPageParam: (page) => page.nextCursor ?? undefined,
    }),
  );

  const list = counts.data?.pages.flatMap((page) => page.items) ?? [];

  const fields: TListFilterField[] = [
    {
      path: 'subject.zoneId',
      label: t('zone', 'Zone'),
      type: 'select',
      options: (zones.data ?? []).map((zone) => ({ value: zone.id, label: zone.name })),
    },
    {
      path: 'subject.status',
      label: t('status', 'Status'),
      type: 'select',
      options: Object.entries(labels.count).map(([value, label]) => ({ value, label })),
    },
    { path: 'subject.createdAt', label: t('when', 'When'), type: 'date' },
    { path: 'subject.createdBy', label: t('by', 'By'), type: 'member' },
  ];

  return (
    <PageContainer>
      <PageHeader>
        <PageHeader.Start>
          <IconListCheck />
          <h1 className="text-sm font-semibold">{t('counts', 'Counts')}</h1>
        </PageHeader.Start>
        <PageHeader.End>
          <Button onClick={() => openNew(TYPES.count)}>
            <IconScan />
            {t('new-count', 'New count')}
          </Button>
        </PageHeader.End>
      </PageHeader>
      <ViewBar recordType={TYPES.count} allLabel={t('all-counts', 'All counts')}>
        <ListFilter
          id="storage-counts"
          recordType={TYPES.count}
          fields={fields}
          members={memberQueries}
          totalCount={counts.isPending ? undefined : list.length}
          totalCapped={counts.hasNextPage}
        />
      </ViewBar>
      <ListTable
        tableId="storage_counts"
        columns={columns}
        rows={list}
        pending={counts.isPending}
        error={counts.error}
        hasNextPage={counts.hasNextPage}
        fetchNextPage={() => void counts.fetchNextPage()}
        emptyTitle={t('no-counts', 'No counts yet')}
        emptyHint={t('no-counts-hint', 'Submit what an RFID reader read in a zone.')}
      />
    </PageContainer>
  );
};
