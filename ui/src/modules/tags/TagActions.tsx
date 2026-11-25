import { IconLayoutGrid, IconPackageExport, IconTagStarred } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, PanelFormRow, PanelSection, textOf, toast } from 'erxes-ui';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { orpc } from '~/orpc.ts';
import { LocationSelect, NO_LOCATION, type Tag } from '~/shared.tsx';

/** After any action the tag, the lists and the movements change: read them again. */
const useRefresh = () => {
  const queryClient = useQueryClient();

  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.tags.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.movements.key() }),
    ]);
};

const ErrorLine = ({ error }: { error: Error | null }) =>
  error ? (
    <p role="alert" className="px-2 text-xs text-destructive">
      {error.message}
    </p>
  ) : null;

/** Takes an amount out of the tag. The amount is required; All fills in what is left. */
const IssueForm = ({ tag }: { tag: Tag }) => {
  const { t } = useTranslation('storage');
  const id = useId();
  const refresh = useRefresh();
  const [amount, setAmount] = useState('');

  const issue = useMutation(
    orpc.movements.issue.mutationOptions({
      onSuccess: async (movement) => {
        await refresh();
        setAmount('');
        toast({ title: t('issued', 'Issued {{units}}', { units: movement.items[0]?.units ?? 0 }) });
      },
    }),
  );

  const save = () =>
    issue.mutate({
      lines: [{ epcId: tag.epcId, amount: Number(amount) }],
      requestKey: crypto.randomUUID(),
    });

  return (
    <form action={save} className="flex flex-col gap-2">
      <PanelFormRow
        label={t('issue-amount', 'Amount')}
        icon={IconPackageExport}
        htmlFor={id}
        hint={t('issue-hint', '{{remaining}} left.', { remaining: tag.remaining })}
        required
      >
        <div className="flex gap-2">
          <Input
            id={id}
            name="amount"
            type="number"
            min={0.001}
            max={tag.remaining}
            step={0.001}
            required
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            variant="bordered"
            text="sm"
          />
          <Button type="button" variant="ghost" onClick={() => setAmount(String(tag.remaining))}>
            {t('all', 'All')}
          </Button>
        </div>
      </PanelFormRow>
      <ErrorLine error={issue.error} />
      <Button type="submit" variant="outline" disabled={issue.isPending}>
        {t('issue', 'Issue')}
      </Button>
    </form>
  );
};

/** Moves the tag's stock to a new label, for a damaged or lost one. */
const RelabelForm = ({ tag }: { tag: Tag }) => {
  const { t } = useTranslation('storage');
  const id = useId();
  const refresh = useRefresh();

  const relabel = useMutation(
    orpc.movements.relabel.mutationOptions({
      onSuccess: async () => {
        await refresh();
        toast({ title: t('relabelled', 'The new label holds the stock now') });
      },
    }),
  );

  const save = (form: FormData) =>
    relabel.mutate({
      epcId: tag.epcId,
      newEpcId: textOf(form.get('newEpcId')),
      requestKey: crypto.randomUUID(),
    });

  return (
    <form action={save} className="flex flex-col gap-2">
      <PanelFormRow label={t('new-epc', 'New EPC')} icon={IconTagStarred} htmlFor={id} required>
        <Input id={id} name="newEpcId" required variant="bordered" text="sm" />
      </PanelFormRow>
      <ErrorLine error={relabel.error} />
      <Button type="submit" variant="outline" disabled={relabel.isPending}>
        {t('relabel', 'Relabel')}
      </Button>
    </form>
  );
};

/** Puts the tag on a shelf of its zone, or takes it off. */
const PlaceForm = ({ tag }: { tag: Tag }) => {
  const { t } = useTranslation('storage');
  const id = useId();
  const refresh = useRefresh();
  const [locationId, setLocationId] = useState(tag.locationId ?? NO_LOCATION);

  const place = useMutation(
    orpc.tags.place.mutationOptions({
      onSuccess: async () => {
        await refresh();
        toast({ title: t('placed', 'Moved') });
      },
    }),
  );

  return (
    <div className="flex flex-col gap-2">
      <PanelFormRow label={t('location', 'Location')} icon={IconLayoutGrid} htmlFor={id}>
        <LocationSelect
          id={id}
          zoneId={tag.zoneId}
          value={locationId}
          onValueChange={setLocationId}
        />
      </PanelFormRow>
      <ErrorLine error={place.error} />
      <Button
        variant="outline"
        disabled={place.isPending || locationId === (tag.locationId ?? NO_LOCATION)}
        onClick={() =>
          place.mutate({
            epcIds: [tag.epcId],
            zoneId: tag.zoneId,
            locationId: locationId === NO_LOCATION ? null : locationId,
          })
        }
      >
        {t('move', 'Move')}
      </Button>
    </div>
  );
};

/** What can be done with a tag that holds stock. */
export const TagActions = ({ tag }: { tag: Tag }) => {
  const { t } = useTranslation('storage');

  return (
    <>
      <PanelSection title={t('issue-title', 'Issue stock')}>
        <IssueForm tag={tag} />
      </PanelSection>
      <PanelSection title={t('place-title', 'Location')}>
        <PlaceForm tag={tag} />
      </PanelSection>
      <PanelSection title={t('relabel-title', 'Replace the label')}>
        <RelabelForm tag={tag} />
      </PanelSection>
    </>
  );
};
