import { memberQueries } from '@erxes/core-contract/client';
import { IconCalendar, IconCircleCheck, IconUser } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, MemberInline, PanelField, PanelSection, useFormat } from 'erxes-ui';
import { useTranslation } from 'react-i18next';
import { orpc } from '~/orpc.ts';
import { type Count, useLabels } from '~/shared.tsx';

/**
 * A draft count's approve and reject buttons, or who reviewed it and when. Approving writes the
 * missing tags off and moves the ones registered elsewhere here; it needs the approve permission.
 */
export const CountReview = ({ count }: { count: Count }) => {
  const { t } = useTranslation('storage');
  const format = useFormat();
  const labels = useLabels();
  const queryClient = useQueryClient();

  const refresh = () =>
    Promise.all(
      [orpc.scans.key(), orpc.tags.key(), orpc.movements.key()].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );

  const approve = useMutation(orpc.scans.approve.mutationOptions({ onSuccess: refresh }));
  const reject = useMutation(orpc.scans.reject.mutationOptions({ onSuccess: refresh }));
  const busy = approve.isPending || reject.isPending;
  const error = approve.error ?? reject.error;

  return (
    <PanelSection title={t('review', 'Review')}>
      <PanelField label={t('status', 'Status')} icon={IconCircleCheck}>
        <span className="px-2 text-sm">{labels.count[count.status]}</span>
      </PanelField>
      {count.status === 'draft' ? (
        <div className="flex flex-col gap-2 px-2">
          <p className="text-xs text-muted-foreground">
            {t(
              'approve-hint',
              'Approving writes off the missing tags and moves the ones registered elsewhere here.',
            )}
          </p>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => approve.mutate({ id: count.id })}>
              {t('approve', 'Approve')}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => reject.mutate({ id: count.id })}
            >
              {t('reject', 'Reject')}
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error.message}
            </p>
          )}
        </div>
      ) : (
        <>
          {count.reviewedBy && (
            <PanelField label={t('reviewed-by', 'Reviewed by')} icon={IconUser}>
              <MemberInline memberId={count.reviewedBy} members={memberQueries} />
            </PanelField>
          )}
          {count.reviewedAt && (
            <PanelField label={t('reviewed-at', 'Reviewed')} icon={IconCalendar}>
              <span className="px-2 text-sm">{format.dateTime(count.reviewedAt)}</span>
            </PanelField>
          )}
        </>
      )}
    </PanelSection>
  );
};
