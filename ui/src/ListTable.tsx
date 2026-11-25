import { Empty, RecordTable, type RecordTableColumnDef } from 'erxes-ui';

/**
 * A list's table under its bar, loading more by cursor, with what the list is for when it is
 * empty. Each list page gives its rows and columns.
 */
export const ListTable = <T extends object>({
  tableId,
  columns,
  rows,
  pending,
  error,
  hasNextPage,
  fetchNextPage,
  emptyTitle,
  emptyHint,
}: {
  tableId: string;
  columns: RecordTableColumnDef<T>[];
  rows: T[];
  pending: boolean;
  error: Error | null;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  emptyTitle: string;
  emptyHint: string;
}) =>
  error ? (
    <p className="m-3 text-sm text-destructive">{error.message}</p>
  ) : (
    <RecordTable.Provider columns={columns} data={rows} className="m-3" tableId={tableId}>
      <RecordTable.CursorProvider dataLength={rows.length} hasNextPage={hasNextPage}>
        <RecordTable>
          <RecordTable.Header />
          <RecordTable.Body>
            {pending ? <RecordTable.RowSkeleton rows={8} /> : <RecordTable.RowList />}
            <RecordTable.CursorForwardSkeleton handleFetchMore={fetchNextPage} />
          </RecordTable.Body>
        </RecordTable>
      </RecordTable.CursorProvider>
      {!pending && !rows.length && (
        <Empty className="absolute inset-x-0 top-1/4">
          <Empty.Header>
            <Empty.Title>{emptyTitle}</Empty.Title>
            <Empty.Description>{emptyHint}</Empty.Description>
          </Empty.Header>
        </Empty>
      )}
    </RecordTable.Provider>
  );
