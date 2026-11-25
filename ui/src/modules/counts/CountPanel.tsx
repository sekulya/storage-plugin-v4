import {
  type Icon,
  IconAlertTriangle,
  IconCheck,
  IconHelp,
  IconLayoutGrid,
  IconMapPin,
  IconPackage,
  IconPackageOff,
  IconRoute,
  IconTag,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
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
import {
  type Count,
  EpcInput,
  epcsOf,
  LocationName,
  LocationSelect,
  NO_LOCATION,
  ProductName,
  ZoneName,
  ZoneSelect,
} from '~/shared.tsx';
import { CountReview } from './CountReview.tsx';

/** A count: the zone, optionally one shelf in it, and the EPCs the RFID reader read there. */
export const CountNew = ({ onCreated, onCancel }: TRecordDraftProps) => {
  const { t } = useTranslation('storage');
  const ids = { zone: useId(), location: useId(), epcs: useId() };
  const [zoneId, setZoneId] = useState('');
  const [locationId, setLocationId] = useState(NO_LOCATION);
  const queryClient = useQueryClient();

  const submit = useMutation(
    orpc.scans.submit.mutationOptions({
      onSuccess: (count) => {
        void queryClient.invalidateQueries({ queryKey: orpc.scans.key() });
        onCreated(count.id);
      },
    }),
  );

  return (
    <form
      action={(form) =>
        submit.mutate({
          zoneId,
          ...(locationId === NO_LOCATION ? {} : { locationId }),
          epcIds: epcsOf(textOf(form.get('epcIds'))),
        })
      }
      className="flex min-h-0 flex-1 flex-col"
    >
      <PanelFormLayout
        onCancel={onCancel}
        saving={submit.isPending}
        saveLabel={t('count', 'Count')}
      >
        <PanelFormRow label={t('zone', 'Zone')} icon={IconMapPin} htmlFor={ids.zone} required>
          <ZoneSelect
            id={ids.zone}
            value={zoneId}
            onValueChange={(next) => {
              setZoneId(next);
              setLocationId(NO_LOCATION);
            }}
          />
        </PanelFormRow>
        <PanelFormRow
          label={t('location', 'Location')}
          icon={IconLayoutGrid}
          htmlFor={ids.location}
          hint={t('count-location-hint', 'Count one shelf, or leave empty for the whole zone.')}
        >
          <LocationSelect
            id={ids.location}
            zoneId={zoneId}
            value={locationId}
            onValueChange={setLocationId}
          />
        </PanelFormRow>
        <PanelFormRow
          label={t('epcs-read', 'EPCs read')}
          icon={IconTag}
          htmlFor={ids.epcs}
          required
          hint={t('epcs-hint', 'From the reader: one per line, or separated by commas or spaces.')}
        >
          <EpcInput id={ids.epcs} name="epcIds" />
        </PanelFormRow>
        {submit.error && (
          <p role="alert" className="text-xs text-destructive">
            {submit.error.message}
          </p>
        )}
      </PanelFormLayout>
    </form>
  );
};

const useCount = (contentId: string) =>
  useQuery(orpc.scans.get.queryOptions({ input: { id: contentId } }));

export const CountTitle = ({ contentId }: TRecordSlotProps) => {
  const { t } = useTranslation('storage');
  const format = useFormat();
  const count = useCount(contentId);

  if (count.isPending) return <Skeleton className="h-4 w-32" />;

  return (
    <span className="truncate">
      {count.data
        ? t('count-of', 'Count of {{when}}', { when: format.dateTime(count.data.createdAt) })
        : count.error?.message}
    </span>
  );
};

/** One kind of result: how many, and a sample of the EPCs. */
const Outcome = ({
  label,
  icon,
  total,
  epcIds,
}: {
  label: string;
  icon: Icon;
  total: number;
  epcIds?: string[];
}) => (
  <PanelField label={label} icon={icon}>
    <span className="flex flex-col gap-1 px-2 text-sm">
      <span>{total}</span>
      {epcIds && epcIds.length > 0 && (
        <span className="font-mono text-xs text-muted-foreground">{epcIds.join(' ')}</span>
      )}
    </span>
  </PanelField>
);

const Outcomes = ({ count }: { count: Count }) => {
  const { t } = useTranslation('storage');

  return (
    <PanelSection title={t('result', 'Result')}>
      <Outcome label={t('read', 'Read')} icon={IconTag} total={count.scannedCount} />
      <Outcome label={t('matched', 'Matched')} icon={IconCheck} total={count.matchedCount} />
      <Outcome
        label={t('missing', 'Missing: here, not read')}
        icon={IconAlertTriangle}
        total={count.missingCount}
        epcIds={count.missingEpcIds}
      />
      <Outcome
        label={t('unknown', 'Unknown: never registered')}
        icon={IconHelp}
        total={count.unknownCount}
        epcIds={count.unknownEpcIds}
      />
      <Outcome
        label={t('no-stock-read', 'No stock: empty or replaced')}
        icon={IconPackageOff}
        total={count.noStockCount}
        epcIds={count.noStockEpcIds}
      />
      <Outcome
        label={t('other-zone', 'Registered elsewhere')}
        icon={IconRoute}
        total={count.otherZoneCount}
        epcIds={count.otherZoneEpcIds}
      />
    </PanelSection>
  );
};

/** The count's result and review, then what was expected and read per product. */
export const CountDetail = ({ contentId }: TRecordSlotProps) => {
  const { t } = useTranslation('storage');
  const format = useFormat();
  const count = useCount(contentId);

  if (count.isPending) return <Spinner area="lg" />;

  if (count.isError)
    return (
      <p role="alert" className="p-3 text-xs text-destructive">
        {count.error.message}
      </p>
    );

  return (
    <>
      <PanelSection title={t('zone', 'Zone')}>
        <PanelField label={t('zone', 'Zone')} icon={IconMapPin}>
          <span className="px-2 text-sm">
            <ZoneName id={count.data.zoneId} />
          </span>
        </PanelField>
        <PanelField label={t('location', 'Location')} icon={IconLayoutGrid}>
          <span className="px-2 text-sm">
            <LocationName id={count.data.locationId} />
          </span>
        </PanelField>
      </PanelSection>
      <CountReview count={count.data} />
      <Outcomes count={count.data} />
      <PanelSection title={t('by-product', 'By product')}>
        {count.data.products.map((row) => (
          <PanelField
            key={row.productId}
            label={<ProductName id={row.productId} />}
            icon={IconPackage}
          >
            <span className="px-2 text-sm">
              {t('read-of', '{{read}} of {{expected}} tags read ({{readAmount}} of {{amount}})', {
                read: row.scannedPacks,
                expected: row.expectedPacks,
                readAmount: format.number(row.scannedQuantity),
                amount: format.number(row.expectedQuantity),
              })}
            </span>
          </PanelField>
        ))}
      </PanelSection>
    </>
  );
};
