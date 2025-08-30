import { analyze } from './analyze';
import { rawQueryToSelectQuery } from './rawQueryToSelectQuery';
import type { RawSql } from '../utils/sql';
import type { SecurityCheckContext } from '../types';

/**
 * Checks if a WHERE clause contains the required security condition.
 * 
 * This function analyzes the SQL query and verifies that for the specified table,
 * there are no execution branches that would bypass the required security check.
 * 
 * @param sql - The SQL query to analyze
 * @param securityCheck - The required security condition (e.g., from column.equalityCheck)
 * @returns true if all execution paths include the security check, false otherwise
 */
export function hasWhereClauseCheck(sql: RawSql, securityCheck: SecurityCheckContext): boolean {
  const analysis = analyze(sql);
  const parsedQuery = rawQueryToSelectQuery(sql);
  
  // Find the table we're checking security for
  const targetTable = analysis.accessedTables.find(table => table.name === securityCheck.tableName);
  
  if (!targetTable) {
    // If the table isn't accessed, no security check is needed
    return true;
  }
  
  // Check that ALL filter branches contain the required security condition
  // If there are no filter branches, or empty filter branches, it means there's no WHERE clause
  if (targetTable.filterBranches.length === 0 || (targetTable.filterBranches.length === 1 && targetTable.filterBranches[0].length === 0)) {
    // For INSERT queries, we don't need to check WHERE clauses since they don't have them
    if (parsedQuery.type === 'insert') {
      return true; 
    }
    return false; // This is a SELECT/UPDATE/DELETE without proper WHERE clause
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
      return false;
    }
  }
  
  return true;
}