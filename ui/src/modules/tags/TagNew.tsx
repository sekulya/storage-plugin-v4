import { isDefinedError } from '@orpc/client';
import {
  IconHash,
  IconLayoutGrid,
  IconMapPin,
  IconPackage,
  IconRuler,
  IconStack2,
  IconTag,
} from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Input,
  PanelFormLayout,
  PanelFormRow,
  textOf,
  toast,
  type TRecordDraftProps,
} from 'erxes-ui';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { orpc } from '~/orpc.ts';
import {
  EpcInput,
  epcsOf,
  LocationSelect,
  NO_LOCATION,
  type Packaging,
  PackagingSelect,
  ProductSelect,
  ZoneSelect,
} from '~/shared.tsx';

/** Registers tags; says how many and closes the form, as the list shows them at the top. */
const useRegister = (close: () => void) => {
  const { t } = useTranslation('storage');
  const queryClient = useQueryClient();

  const register = useMutation(
    orpc.tags.register.mutationOptions({
      onSuccess: async (result) => {
        await queryClient.invalidateQueries({ queryKey: orpc.tags.key() });
        toast({
          title: t('registered', 'Registered {{count}} tags', { count: result.epcIds.length }),
          description: t('registered-hint', 'They are at the top of the tags list.'),
        });
        close();
      },
    }),
  );

  return register;
};

/** Where the EPCs come from: how many to make for blank tags, or the ones read. */
const TagSources = ({
  countId,
  epcsId,
  epcTaken,
}: {
  countId: string;
  epcsId: string;
  /** Some EPCs were registered already, so nothing was. */
  epcTaken: boolean;
}) => {
  const { t } = useTranslation('storage');

  return (
    <>
      <PanelFormRow
        label={t('new-tags', 'New tags')}
        icon={IconHash}
        htmlFor={countId}
        hint={t(
          'new-tags-hint',
          'How many EPCs to make for blank tags; leave empty to register EPCs read below.',
        )}
      >
        <Input id={countId} name="count" type="number" min={1} variant="bordered" text="sm" />
      </PanelFormRow>
      <PanelFormRow
        label={t('epcs-read', 'EPCs read')}
        icon={IconTag}
        htmlFor={epcsId}
        hint={t('epcs-hint', 'From the reader: one per line, or separated by commas or spaces.')}
        error={
          epcTaken
            ? t('epc-taken', 'Some of these EPCs are registered already. Nothing was registered.')
            : undefined
        }
      >
        <EpcInput id={epcsId} name="epcIds" />
      </PanelFormRow>
    </>
  );
};

/** The zone, and optionally a shelf in it: changing the zone clears the shelf. */
const ZonePlace = ({
  zoneId,
  setZoneId,
  locationId,
  setLocationId,
}: {
  zoneId: string;
  setZoneId: (value: string) => void;
  locationId: string;
  setLocationId: (value: string) => void;
}) => {
  const { t } = useTranslation('storage');
  const ids = { zone: useId(), location: useId() };

  return (
    <>
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
      <PanelFormRow label={t('location', 'Location')} icon={IconLayoutGrid} htmlFor={ids.location}>
        <LocationSelect
          id={ids.location}
          zoneId={zoneId}
          value={locationId}
          onValueChange={setLocationId}
        />
      </PanelFormRow>
    </>
  );
};

/** What every new tag gets: zone, shelf, product, packaging and the amount each holds. */
const TagFields = ({
  zoneId,
  setZoneId,
  locationId,
  setLocationId,
  productId,
  setProductId,
  packaging,
  setPackaging,
}: {
  zoneId: string;
  setZoneId: (value: string) => void;
  locationId: string;
  setLocationId: (value: string) => void;
  productId: string;
  setProductId: (value: string) => void;
  packaging: Packaging;
  setPackaging: (value: Packaging) => void;
}) => {
  const { t } = useTranslation('storage');

  const ids = { product: useId(), packaging: useId(), quantity: useId() };

  return (
    <>
      <ZonePlace
        zoneId={zoneId}
        setZoneId={setZoneId}
        locationId={locationId}
        setLocationId={setLocationId}
      />
      <PanelFormRow
        label={t('product', 'Product')}
        icon={IconPackage}
        htmlFor={ids.product}
        required
      >
        <ProductSelect id={ids.product} value={productId} onValueChange={setProductId} />
      </PanelFormRow>
      <PanelFormRow
        label={t('packaging', 'Packaging')}
        icon={IconStack2}
        htmlFor={ids.packaging}
        required
      >
        <PackagingSelect id={ids.packaging} value={packaging} onValueChange={setPackaging} />
      </PanelFormRow>
      <PanelFormRow
        label={t('quantity', 'Amount in each')}
        icon={IconRuler}
        htmlFor={ids.quantity}
        hint={t('quantity-hint', "In the product's unit: 12 pieces, 300.5 metres.")}
        required
      >
        <Input
          id={ids.quantity}
          name="quantity"
          type="number"
          min={0.001}
          step={0.001}
          required
          variant="bordered"
          text="sm"
        />
      </PanelFormRow>
    </>
  );
};

/**
 * New tags, one per packed item of a product in a zone, optionally on a shelf: how many new EPCs
 * to make (to encode on blank tags), or the EPCs read from tags already encoded. Each holds the
 * same amount, in the product's unit. All of them or none.
 */
export const TagNew = ({ onCancel }: TRecordDraftProps) => {
  const { t } = useTranslation('storage');

  const ids = {
    zone: useId(),
    location: useId(),
    product: useId(),
    packaging: useId(),
    quantity: useId(),
    count: useId(),
    epcs: useId(),
  };

  const [zoneId, setZoneId] = useState('');
  const [locationId, setLocationId] = useState(NO_LOCATION);
  const [productId, setProductId] = useState('');
  const [packaging, setPackaging] = useState<Packaging>('box');

  const register = useRegister(onCancel);

  const save = (form: FormData) => {
    const epcIds = epcsOf(textOf(form.get('epcIds')));
    const count = Number(textOf(form.get('count')));

    register.mutate({
      zoneId,
      ...(locationId === NO_LOCATION ? {} : { locationId }),
      productId,
      packaging,
      quantity: Number(textOf(form.get('quantity'))),
      ...(epcIds.length ? { epcIds } : { count }),
    });
  };

  const { error } = register;

  return (
    <form action={save} className="flex min-h-0 flex-1 flex-col">
      <PanelFormLayout
        onCancel={onCancel}
        saving={register.isPending}
        saveLabel={t('register', 'Register tags')}
      >
        <TagFields
          zoneId={zoneId}
          setZoneId={setZoneId}
          locationId={locationId}
          setLocationId={setLocationId}
          productId={productId}
          setProductId={setProductId}
          packaging={packaging}
          setPackaging={setPackaging}
        />
        <TagSources
          countId={ids.count}
          epcsId={ids.epcs}
          epcTaken={isDefinedError(error) && error.code === 'EPC_TAKEN'}
        />
        {error && !isDefinedError(error) && (
          <p role="alert" className="text-xs text-destructive">
            {error.message}
          </p>
        )}
      </PanelFormLayout>
    </form>
  );
};
