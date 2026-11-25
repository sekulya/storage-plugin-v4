import { isDefinedError } from '@orpc/client';
import {
  IconArrowsExchange,
  IconCalendar,
  IconMapPin,
  IconPackage,
  IconTag,
  IconUser,
} from '@tabler/icons-react';
import { memberQueries } from '@erxes/core-contract/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MemberInline,
  PanelField,
  PanelFormLayout,
  PanelFormRow,
  PanelSection,
  Skeleton,
  Spinner,
  textOf,
  type TRecordDraftProps,
  type TRecordSlotProps,
  useFormat,
} from 'erxes-ui';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { orpc } from '~/orpc.ts';
import { EpcInput, epcsOf, ProductName, useLabels, ZoneName } from '~/shared.tsx';

/**
 * Opens sealed packs where they are, keeping what they hold: the EPCs read from the packs, all
 * of one zone. A key per form keeps a double click or a retry from making a second movement.
 */
export const MovementNew = ({ onCreated, onCancel }: TRecordDraftProps) => {
  const { t } = useTranslation('storage');
  const id = useId();
  const [requestKey] = useState(() => crypto.randomUUID());
  const queryClient = useQueryClient();

  const breakBoxes = useMutation(
    orpc.movements.breakBoxes.mutationOptions({
      onSuccess: (movement) => {
        void queryClient.invalidateQueries({ queryKey: orpc.movements.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.tags.key() });
        onCreated(movement.id);
      },
    }),
  );

  const { error } = breakBoxes;

  const problem = (() => {
    if (!isDefinedError(error)) return undefined;

    switch (error.code) {
      case 'EPC_UNKNOWN':
        return t('epc-unknown', 'Not registered: {{epcs}}', { epcs: error.data.epcIds.join(', ') });
      case 'PACKS_OPENED':
        return t('packs-opened', 'Opened already: {{epcs}}', {
          epcs: error.data.epcIds.join(', '),
        });
      case 'NO_STOCK':
        return t('no-stock', 'Empty or replaced: {{epcs}}', { epcs: error.data.epcIds.join(', ') });
      case 'ZONES_MIXED':
        return t('zones-mixed', 'These packs are in different zones: break one zone at a time.');
      default:
        return undefined;
    }
  })();

  return (
    <form
      action={(form) =>
        breakBoxes.mutate({
          epcIds: epcsOf(textOf(form.get('epcIds'))),
          requestKey,
        })
      }
      className="flex min-h-0 flex-1 flex-col"
    >
      <PanelFormLayout
        onCancel={onCancel}
        saving={breakBoxes.isPending}
        saveLabel={t('break', 'Break packs')}
      >
        <PanelFormRow
          label={t('epcs-of-packs', 'EPCs of the packs')}
          icon={IconTag}
          htmlFor={id}
          required
          hint={t('epcs-hint', 'From the reader: one per line, or separated by commas or spaces.')}
          error={problem}
        >
          <EpcInput id={id} name="epcIds" />
        </PanelFormRow>
        {error && !isDefinedError(error) && (
          <p role="alert" className="text-xs text-destructive">
            {error.message}
          </p>
        )}
      </PanelFormLayout>
    </form>
  );
};

const useMovement = (contentId: string) =>
  useQuery(orpc.movements.get.queryOptions({ input: { id: contentId } }));

export const MovementTitle = ({ contentId }: TRecordSlotProps) => {
  const movement = useMovement(contentId);

  if (movement.isPending) return <Skeleton className="h-4 w-32" />;

  return <span className="truncate">{movement.data?.number ?? movement.error?.message}</span>;
};

/** The movement, its lines per product, and every tag it touched. */
export const MovementDetail = ({ contentId }: TRecordSlotProps) => {
  const { t } = useTranslation('storage');
  const format = useFormat();
  const labels = useLabels();
  const movement = useMovement(contentId);

  if (movement.isPending) return <Spinner area="lg" />;

  if (movement.isError)
    return (
      <p role="alert" className="p-3 text-xs text-destructive">
        {movement.error.message}
      </p>
    );

  const { data } = movement;

  return (
    <>
      <PanelSection title={t('movement', 'Movement')}>
        <PanelField label={t('type', 'Type')} icon={IconArrowsExchange}>
          <span className="px-2 text-sm">{labels.movement[data.type]}</span>
        </PanelField>
        <PanelField label={t('zone', 'Zone')} icon={IconMapPin}>
          <span className="px-2 text-sm">
            <ZoneName id={data.zoneId} />
          </span>
        </PanelField>
        <PanelField label={t('when', 'When')} icon={IconCalendar}>
          <span className="px-2 text-sm">{format.dateTime(data.createdAt)}</span>
        </PanelField>
        <PanelField label={t('by', 'By')} icon={IconUser}>
          <MemberInline memberId={data.createdBy} members={memberQueries} />
        </PanelField>
      </PanelSection>
      {data.items.length > 0 && (
        <PanelSection title={t('lines', 'By product')}>
          {data.items.map((item) => (
            <PanelField
              key={item.productId}
              label={<ProductName id={item.productId} />}
              icon={IconPackage}
            >
              <span className="px-2 text-sm">
                {t('line', {
                  count: item.packs,
                  units: format.number(item.units),
                  defaultValue_one: '1 tag, {{units}}',
                  defaultValue_other: '{{count}} tags, {{units}}',
                })}
              </span>
            </PanelField>
          ))}
        </PanelSection>
      )}
      <PanelSection title={t('tags', 'RFID tags')}>
        {data.tags.map((tag) => (
          <PanelField
            key={tag.epcId}
            label={<span className="font-mono text-xs">{tag.epcId}</span>}
            icon={IconTag}
          >
            <span className="px-2 text-sm">
              {tag.taken > 0
                ? t('taken', 'took {{amount}}', { amount: format.number(tag.taken) })
                : '—'}
            </span>
          </PanelField>
        ))}
      </PanelSection>
    </>
  );
};
