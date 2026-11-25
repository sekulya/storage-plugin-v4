import { isDefinedError } from '@orpc/client';
import { IconMapPin, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Empty,
  PageContainer,
  PageHeader,
  RecordTable,
  type RecordTableColumnDef,
  toast,
  useConfirm,
  useFormat,
  useOpenRecord,
} from 'erxes-ui';
import { useTranslation } from 'react-i18next';
import { orpc } from '~/orpc.ts';
import { TYPES, useZones, type Zone } from '~/shared.tsx';

const NameCell = ({ zone }: { zone: Zone }) => {
  const { open } = useOpenRecord();

  return (
    <Button
      variant="ghost"
      className="w-full justify-start"
      onClick={() => open({ contentType: TYPES.zone, contentId: zone.id })}
    >
      {zone.name}
    </Button>
  );
};

const CreatedCell = ({ zone }: { zone: Zone }) => (
  <span className="px-2">{useFormat().dateTime(zone.createdAt)}</span>
);

/** Removes a zone after asking; one with tags stays, and says why. */
const RemoveCell = ({ zone }: { zone: Zone }) => {
  const { t } = useTranslation('storage');
  const { confirm } = useConfirm();
  const queryClient = useQueryClient();

  const remove = useMutation(
    orpc.zones.remove.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.zones.key() }),
      onError: (error) =>
        toast({
          variant: 'destructive',
          title: t('remove-failed', 'Could not remove {{name}}', { name: zone.name }),
          description:
            isDefinedError(error) && error.code === 'ZONE_IN_USE'
              ? t('zone-in-use', '{{count}} RFID tags are registered in it. Remove them first.', {
                  count: error.data.tags,
                })
              : error.message,
        }),
    }),
  );

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t('remove-zone', 'Remove {{name}}', { name: zone.name })}
      onClick={() =>
        void confirm({
          message: t('remove-zone-confirm', 'Remove {{name}} and its counts?', { name: zone.name }),
        }).then(() => remove.mutate({ id: zone.id }))
      }
    >
      <IconTrash />
    </Button>
  );
};

const columns: RecordTableColumnDef<Zone>[] = [
  { id: 'name', header: 'Name', size: 320, cell: ({ row }) => <NameCell zone={row.original} /> },
  {
    id: 'createdAt',
    header: 'Created',
    size: 200,
    cell: ({ row }) => <CreatedCell zone={row.original} />,
  },
  { id: 'remove', header: '', size: 48, cell: ({ row }) => <RemoveCell zone={row.original} /> },
];

/** Storage › Settings › Zones: the warehouse's zones; each opens with its packs by product. */
export const ZonesSettingsPage = () => {
  const { t } = useTranslation('storage');
  const { openNew } = useOpenRecord();
  const zones = useZones();
  const list = zones.data ?? [];

  return (
    <PageContainer>
      <PageHeader>
        <PageHeader.Start>
          <IconMapPin />
          <h1 className="text-sm font-semibold">{t('zones', 'Zones')}</h1>
        </PageHeader.Start>
        <PageHeader.End>
          <Button onClick={() => openNew(TYPES.zone)}>
            <IconPlus />
            {t('add-zone', 'Add zone')}
          </Button>
        </PageHeader.End>
      </PageHeader>
      {zones.isError ? (
        <p className="m-3 text-sm text-destructive">{zones.error.message}</p>
      ) : (
        <RecordTable.Provider columns={columns} data={list} className="m-3" tableId="storage_zones">
          <RecordTable>
            <RecordTable.Header />
            <RecordTable.Body>
              {zones.isPending ? <RecordTable.RowSkeleton rows={4} /> : <RecordTable.RowList />}
            </RecordTable.Body>
          </RecordTable>
          {!zones.isPending && !list.length && (
            <Empty className="absolute inset-x-0 top-1/4">
              <Empty.Header>
                <Empty.Title>{t('no-zones', 'No zones yet')}</Empty.Title>
                <Empty.Description>
                  {t('no-zones-hint', 'Add the warehouse zones RFID tags are registered in.')}
                </Empty.Description>
              </Empty.Header>
            </Empty>
          )}
        </RecordTable.Provider>
      )}
    </PageContainer>
  );
};
