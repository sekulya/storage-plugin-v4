import { isDefinedError } from '@orpc/client';
import { IconLayoutGrid, IconTrash } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, PanelField, Spinner, textOf } from 'erxes-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { orpc } from '~/orpc.ts';
import { useLocations } from '~/shared.tsx';

/** A zone's shelves and bins: add one by its code, remove one nothing uses. */
export const ZoneLocations = ({ zoneId }: { zoneId: string }) => {
  const { t } = useTranslation('storage');
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const locations = useLocations(zoneId);

  const onSuccess = () => queryClient.invalidateQueries({ queryKey: orpc.locations.key() });

  const create = useMutation(
    orpc.locations.create.mutationOptions({
      onSuccess: async () => {
        await onSuccess();
        setCode('');
      },
    }),
  );

  const remove = useMutation(orpc.locations.remove.mutationOptions({ onSuccess }));

  const problem = (() => {
    if (isDefinedError(create.error))
      return t('location-taken', 'This zone has {{code}} already.', {
        code: create.error.data.code,
      });

    if (isDefinedError(remove.error))
      return t('location-in-use', 'Tags sit there or counts were made there: it stays.');

    return (create.error ?? remove.error)?.message ?? null;
  })();

  if (locations.isPending) return <Spinner />;

  return (
    <div className="flex flex-col gap-2">
      {(locations.data ?? []).map((location) => (
        <PanelField key={location.id} label={location.code} icon={IconLayoutGrid}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('remove-location', 'Remove {{code}}', { code: location.code })}
            disabled={remove.isPending}
            onClick={() => remove.mutate({ id: location.id })}
          >
            <IconTrash />
          </Button>
        </PanelField>
      ))}
      <form
        action={(form) => create.mutate({ zoneId, code: textOf(form.get('code')) })}
        className="flex gap-2 px-2"
      >
        <Input
          name="code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          required
          placeholder={t('location-code', 'Code, e.g. A-01-03')}
          aria-label={t('location-code', 'Code, e.g. A-01-03')}
          variant="bordered"
          text="sm"
        />
        <Button type="submit" variant="outline" disabled={create.isPending}>
          {t('add', 'Add')}
        </Button>
      </form>
      {problem && (
        <p role="alert" className="px-2 text-xs text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
};
