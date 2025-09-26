import type { QueryAnalysis } from './analyze';
import type { Table } from '../table';

export function normalizeQueryAnalysisToRuntime(
  analysis: QueryAnalysis,
  schema: Record<string, Table<any, any>>
): QueryAnalysis {
  const tableByDbName = new Map<string, Table<any, any>>();
  Object.values(schema).forEach((table) => {
    tableByDbName.set(table.__meta__.dbName, table);
  });

  const normalizedTables = analysis.accessedTables.map((entry) => {
    const table = tableByDbName.get(entry.name);
    if (!table) {
      return entry;
    }

    const columnByDbName = new Map<string, string>();
    Object.values(table.__meta__.columns).forEach((col) => {
      columnByDbName.set(col.dbName, col.name);
    });

    const columns = entry.columns.map((col) => columnByDbName.get(col) ?? col);

    const filterBranches = entry.filterBranches.map((branch) =>
      branch.map((filter) => ({
        ...filter,
        column: columnByDbName.get(filter.column) ?? filter.column,
      }))
    );

    return {
      ...entry,
      name: table.__meta__.name,
      columns,
      filterBranches,
    };
  });

  return {
    ...analysis,
    accessedTables: normalizedTables,
  };
}
