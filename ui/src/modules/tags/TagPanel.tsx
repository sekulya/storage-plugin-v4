import {
  IconBox,
  IconLayoutGrid,
  IconMapPin,
  IconPackage,
  IconRuler,
  IconStack2,
  IconTag,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import {
  PanelField,
  PanelSection,
  Skeleton,
  Spinner,
  type TRecordSlotProps,
  useFormat,
} from 'erxes-ui';
import { useTranslation } from 'react-i18next';
import { orpc } from '~/orpc.ts';
import { LocationName, ProductName, useLabels, ZoneName } from '~/shared.tsx';
import { TagActions } from './TagActions.tsx';

const useTag = (contentId: string) =>
  useQuery(orpc.tags.get.queryOptions({ input: { id: contentId } }));

export const TagTitle = ({ contentId }: TRecordSlotProps) => {
  const tag = useTag(contentId);

  if (tag.isPending) return <Skeleton className="h-4 w-32" />;

  return <span className="truncate font-mono">{tag.data?.epcId ?? tag.error?.message}</span>;
};

export const TagDetail = ({ contentId }: TRecordSlotProps) => {
  const { t } = useTranslation('storage');
  const format = useFormat();
  const labels = useLabels();
  const tag = useTag(contentId);

  if (tag.isPending) return <Spinner area="lg" />;

  if (tag.isError)
    return (
      <p role="alert" className="p-3 text-xs text-destructive">
        {tag.error.message}
      </p>
    );

  const { data } = tag;

  return (
    <>
      <PanelSection title={t('tag', 'RFID tag')}>
        <PanelField label={t('epc', 'EPC')} icon={IconTag}>
          <span className="px-2 font-mono text-sm">{data.epcId}</span>
        </PanelField>
        <PanelField label={t('product', 'Product')} icon={IconPackage}>
          <span className="px-2 text-sm">
            <ProductName id={data.productId} />
          </span>
        </PanelField>
        <PanelField label={t('packaging', 'Packaging')} icon={IconStack2}>
          <span className="px-2 text-sm">{labels.packaging[data.packaging]}</span>
        </PanelField>
        <PanelField label={t('left', 'Left')} icon={IconRuler}>
          <span className="px-2 text-sm">
            {t('left-of', '{{remaining}} of {{quantity}}', {
              remaining: format.number(data.remaining),
              quantity: format.number(data.quantity),
            })}
          </span>
        </PanelField>
        <PanelField label={t('zone', 'Zone')} icon={IconMapPin}>
          <span className="px-2 text-sm">
            <ZoneName id={data.zoneId} />
          </span>
        </PanelField>
        <PanelField label={t('location', 'Location')} icon={IconLayoutGrid}>
          <span className="px-2 text-sm">
            <LocationName id={data.locationId} />
          </span>
        </PanelField>
        <PanelField label={t('status', 'Status')} icon={IconBox}>
          <span className="px-2 text-sm">{labels.status[data.status]}</span>
        </PanelField>
      </PanelSection>
      {(data.status === 'sealed' || data.status === 'opened') && <TagActions tag={data} />}
    </>
  );
};
