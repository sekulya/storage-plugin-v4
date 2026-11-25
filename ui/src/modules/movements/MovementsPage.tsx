import { memberQueries } from '@erxes/core-contract/client';
import { IconArrowsExchange, IconPackageExport } from '@tabler/icons-react';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
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
import { type Movement, TYPES, useLabels, useZones, ZoneName } from '~/shared.tsx';

const NumberCell = ({ movement }: { movement: Movement }) => {
  const { open } = useOpenRecord();

  return (
    <Button
      variant="ghost"
      className="w-full justify-start"
      onClick={() => open({ contentType: TYPES.movement, contentId: movement.id })}
    >
      {movement.number}
    </Button>
  );
};

/** Tags and amount across the movement's lines; a relabel has none. */
const TotalsCell = ({ movement }: { movement: Movement }) => {
  const { t } = useTranslation('storage');
  const format = useFormat();
  const tags = movement.items.reduce((sum, item) => sum + item.packs, 0);
  const units = movement.items.reduce((sum, item) => sum + item.units, 0);

  if (!tags) return <span className="px-2 text-muted-foreground">—</span>;

  return (
    <span className="px-2">
      {t('line', {
        count: tags,
        units: format.number(units),
        defaultValue_one: '1 tag, {{units}}',
        defaultValue_other: '{{count}} tags, {{units}}',
      })}
    </span>
  );
};

const TypeCell = ({ movement }: { movement: Movement }) => (
  <span className="px-2">{useLabels().movement[movement.type]}</span>
);

const WhenCell = ({ movement }: { movement: Movement }) => (
  <span className="px-2">{useFormat().dateTime(movement.createdAt)}</span>
);

const columns: RecordTableColumnDef<Movement>[] = [
  {
    id: 'number',
    header: 'Number',
    size: 220,
    cell: ({ row }) => <NumberCell movement={row.original} />,
  },
  {
    id: 'type',
    header: 'Type',
    size: 150,
    cell: ({ row }) => <TypeCell movement={row.original} />,
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
    id: 'totals',
    header: 'Amount',
    size: 200,
    cell: ({ row }) => <TotalsCell movement={row.original} />,
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
  {
    id: 'createdAt',
    header: 'When',
    size: 180,
    cell: ({ row }) => <WhenCell movement={row.original} />,
  },
];

/** Movements, newest first: packs broken, stock issued, labels replaced, counts applied. */
export const MovementsPage = () => {
  const { t } = useTranslation('storage');
  const { openNew } = useOpenRecord();
  const filters = useListFilterParams();
  const zones = useZones();
  const labels = useLabels();

  const movements = useInfiniteQuery(
    orpc.movements.list.infiniteOptions({
      input: (cursor: string | undefined) => ({ cursor, ...filters }),
      initialPageParam: undefined,
      getNextPageParam: (page) => page.nextCursor ?? undefined,
    }),
  );

  const list = movements.data?.pages.flatMap((page) => page.items) ?? [];

  const fields: TListFilterField[] = [
    {
      path: 'subject.zoneId',
      label: t('zone', 'Zone'),
      type: 'select',
      options: (zones.data ?? []).map((zone) => ({ value: zone.id, label: zone.name })),
    },
    {
      path: 'subject.type',
      label: t('type', 'Type'),
      type: 'select',
      options: Object.entries(labels.movement).map(([value, label]) => ({ value, label })),
    },
    { path: 'subject.createdAt', label: t('when', 'When'), type: 'date' },
    { path: 'subject.createdBy', label: t('by', 'By'), type: 'member' },
  ];

  return (
    <PageContainer>
      <PageHeader>
        <PageHeader.Start>
          <IconArrowsExchange />
          <h1 className="text-sm font-semibold">{t('movements', 'Movements')}</h1>
        </PageHeader.Start>
        <PageHeader.End>
          <Button onClick={() => openNew(TYPES.movement)}>
            <IconPackageExport />
            {t('break', 'Break packs')}
          </Button>
        </PageHeader.End>
      </PageHeader>
      <ViewBar recordType={TYPES.movement} allLabel={t('all-movements', 'All movements')}>
        <ListFilter
          id="storage-movements"
          recordType={TYPES.movement}
          fields={fields}
          members={memberQueries}
          totalCount={movements.isPending ? undefined : list.length}
          totalCapped={movements.hasNextPage}
        />
      </ViewBar>
      <ListTable
        tableId="storage_movements"
        columns={columns}
        rows={list}
        pending={movements.isPending}
        error={movements.error}
        hasNextPage={movements.hasNextPage}
        fetchNextPage={() => void movements.fetchNextPage()}
        emptyTitle={t('no-movements', 'No movements yet')}
        emptyHint={t('no-movements-hint', 'Break packs, or issue stock from a tag.')}
      />
    </PageContainer>
  );
};
