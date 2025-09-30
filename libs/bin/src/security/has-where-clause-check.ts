import { QueryAnalysis } from '../true-sql/analyze';
import type { SecurityCheckContext } from '../schema/types';

/**
 * Checks if a WHERE clause contains the required security condition.
 *
 * This function inspects the precomputed query analysis and verifies that for the specified table,
 * there are no execution branches that would bypass the required security check.
 *
 * @param analysis - The analyzed query metadata
 * @param securityCheck - The required security condition (e.g., from column.equalityCheck)
 * @returns true if all execution paths include the security check, false otherwise
 */
export function hasWhereClauseCheck(
  analysis: QueryAnalysis,
  securityCheck: SecurityCheckContext,
  message?: string
): void {
  const targetTable = analysis.accessedTables.find(table => table.name === securityCheck.tableName);
  if (!targetTable) return; // If the table isn't accessed, no security check is needed

  // Check that ALL filter branches contain the required security condition
  // If there are no filter branches, or empty filter branches, it means there's no WHERE clause
  if (targetTable.filterBranches.length === 0 || (targetTable.filterBranches.length === 1 && targetTable.filterBranches[0].length === 0)) {
    // For INSERT queries, we don't need to check WHERE clauses since they don't have them
    if (analysis.type === 'insert') {
      return;
    }
    const baseMessage =
      message ?? `Missing WHERE clause enforcing ${securityCheck.tableName}.${securityCheck.columnName} ${securityCheck.operator} ${String(securityCheck.value)}`;
    throw new Error(`${baseMessage} (table: ${securityCheck.tableName})`);
  }

  // Each branch represents an OR condition, and within each branch are AND conditions
  // For security, we need the security check to be present in ALL branches
  for (const branch of targetTable.filterBranches) {
    const hasSecurityCondition = branch.some(filter =>
      filter.column === securityCheck.columnName &&
      filter.operator === securityCheck.operator &&
      filter.value === securityCheck.value
    );

    if (!hasSecurityCondition) {
      // This branch doesn't contain the required security check
      const baseMessage =
        message ?? `Missing required filter ${securityCheck.tableName}.${securityCheck.columnName} ${securityCheck.operator} ${String(securityCheck.value)}`;
      throw new Error(`${baseMessage} (table: ${securityCheck.tableName})`);
    }
  }
}
