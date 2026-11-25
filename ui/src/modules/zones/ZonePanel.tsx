import { isDefinedError } from '@orpc/client';
import { IconLetterCase } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Input,
  PanelField,
  PanelFormLayout,
  PanelFormRow,
  PanelSection,
  Skeleton,
  Spinner,
  textOf,
  type TRecordDraftProps,
  type TRecordSlotProps,
} from 'erxes-ui';
import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { orpc } from '~/orpc.ts';
import { ProductName, useZones, type Zone } from '~/shared.tsx';
import { ZoneLocations } from './ZoneLocations.tsx';

/** A zone's name: a new zone (`zone` undefined) or a new name for one. */
const ZoneForm = ({
  zone,
  onSaved,
  onCancel,
}: {
  zone?: Zone;
  onSaved?: (zone: Zone) => void;
  onCancel?: () => void;
}) => {
  const { t } = useTranslation('storage');
  const id = useId();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);

  const onSuccess = (saved: Zone) => {
    void queryClient.invalidateQueries({ queryKey: orpc.zones.key() });
    onSaved?.(saved);
  };

  const create = useMutation(orpc.zones.create.mutationOptions({ onSuccess }));
  const rename = useMutation(orpc.zones.rename.mutationOptions({ onSuccess }));
  const { error, isPending } = zone ? rename : create;
  const taken = isDefinedError(error) && error.code === 'ZONE_NAME_TAKEN' ? error.data.name : null;

  const save = (form: FormData) => {
    const name = textOf(form.get('name'));

    if (zone) rename.mutate({ id: zone.id, name });
    else create.mutate({ name });
  };

  return (
    <form ref={formRef} action={save} className="flex min-h-0 flex-1 flex-col">
      <PanelFormLayout
        onCancel={onCancel ?? (() => formRef.current?.reset())}
        saving={isPending}
        saveLabel={zone ? t('save', 'Save') : t('add-zone', 'Add zone')}
      >
        <PanelFormRow
          label={t('name', 'Name')}
          icon={IconLetterCase}
          htmlFor={id}
          required
          error={
            taken === null
              ? undefined
              : t('zone-taken', 'Another zone is already called {{name}}.', { name: taken })
          }
        >
          <Input
            id={id}
            name="name"
            required
            defaultValue={zone?.name}
            aria-invalid={taken !== null}
            variant="bordered"
            text="sm"
          />
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

export const ZoneNew = ({ onCreated, onCancel }: TRecordDraftProps) => (
  <ZoneForm onSaved={(zone) => onCreated(zone.id)} onCancel={onCancel} />
);

const useZone = (contentId: string) => {
  const zones = useZones();

  return { ...zones, zone: zones.data?.find((zone) => zone.id === contentId) };
};

export const ZoneTitle = ({ contentId }: TRecordSlotProps) => {
  const { isPending, zone } = useZone(contentId);

  if (isPending) return <Skeleton className="h-4 w-32" />;

  return <span className="truncate">{zone?.name ?? contentId}</span>;
};

/** Sealed and opened tags per product in the zone, and what they hold, straight from its tags. */
const ZoneStock = ({ zoneId }: { zoneId: string }) => {
  const { t } = useTranslation('storage');
  const summary = useQuery(orpc.tags.summary.queryOptions({ input: { zoneId } }));

  if (summary.isPending) return <Spinner />;

  if (summary.isError)
    return (
      <p role="alert" className="text-xs text-destructive">
        {summary.error.message}
      </p>
    );

  if (!summary.data.length)
    return <p className="text-sm text-muted-foreground">{t('no-tags', 'No tags yet')}</p>;

  return summary.data.map((row) => (
    <PanelField key={row.productId} label={<ProductName id={row.productId} />}>
      <span className="px-2 text-sm">
        {t(
          'stock-row',
          '{{sealed}} sealed ({{sealedAmount}}), {{opened}} opened ({{openedAmount}} left)',
          {
            sealed: row.sealedPacks,
            sealedAmount: row.sealedQuantity,
            opened: row.openedPacks,
            openedAmount: row.openedQuantity,
          },
        )}
      </span>
    </PanelField>
  ));
};

export const ZoneDetail = ({ contentId }: TRecordSlotProps) => {
  const { t } = useTranslation('storage');
  const { isPending, error, zone } = useZone(contentId);

  if (isPending) return <Spinner area="lg" />;

  if (!zone)
    return (
      <p role="alert" className="p-3 text-xs text-destructive">
        {error?.message ?? t('no-zone', 'No such zone')}
      </p>
    );

  return (
    <>
      <PanelSection title={t('zone', 'Zone')}>
        <ZoneForm zone={zone} />
      </PanelSection>
      <PanelSection title={t('locations', 'Locations')}>
        <ZoneLocations zoneId={zone.id} />
      </PanelSection>
      <PanelSection title={t('stock', 'Stock by product')}>
        <ZoneStock zoneId={zone.id} />
      </PanelSection>
    </>
  );
};
