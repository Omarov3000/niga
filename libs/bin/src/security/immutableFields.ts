import type { Column } from '../column';
import type { ImmutableFieldRule, QueryContext, InsertionType } from '../types';

/**
 * Creates an immutable field rule that prevents the specified field from being updated.
 * 
 * @param column - The column that should be immutable
 * @returns An immutable field rule
 */
export function immutable<Name extends string, Type, InsertType extends InsertionType>(
  column: Column<Name, Type, InsertType>
): ImmutableFieldRule {
  const tableName = column.__table__?.getName();
  if (!tableName) {
    throw new Error('Column must be attached to a table to create immutable rule');
  }
  
  return {
    tableName,
    fieldName: column.__meta__.name
  };
}

/**
 * Checks if a query violates any immutable field rules.
 * 
 * @param query - The query context to check
 * @param immutableRules - Array of immutable field rules to enforce
 * @returns true if no immutable fields are being violated, false otherwise
 */
export function checkImmutableFields(query: QueryContext, immutableRules: ImmutableFieldRule[]): boolean {
  // Only check for UPDATE operations
  if (query.type !== 'update' || !query.data) {
    return true;
  }

  // Find the table being updated
  const updatedTable = query.accessedTables[0]; // For UPDATE, there should be exactly one table
  
  // Check if any immutable fields are being updated
  for (const rule of immutableRules) {
    if (rule.tableName === updatedTable) {
      if (query.data.hasOwnProperty(rule.fieldName)) {
        return false; // Attempting to update an immutable field
      }
    }
  }
  
  return true;
}

/**
 * Creates a security rule that enforces immutable field constraints.
 * 
 * @param immutableRules - Array of immutable field rules
 * @returns A security rule function
 */
export function createImmutableFieldsRule(immutableRules: ImmutableFieldRule[]) {
  return (query: QueryContext) => {
    return checkImmutableFields(query, immutableRules);
  };
}