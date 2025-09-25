import { ComparisonOperator, rawQueryToSelectQuery, SelectQuery, SqlQuery } from './rawQueryToSelectQuery';
import { RawSql } from '../utils/sql';
import type { QueryType } from '../types';

// Flattened view of accessed tables for Simplified Analysis
type SimplifiedFilter = {
  column: string;
  operator: ComparisonOperator;
  value: string | number | null;
};

type AccessedTable = {
  name: string; // original table name
  columns: string[]; // all accessed columns
  // Each branch is a conjunction (AND), array of branches = disjunction (OR)
  filterBranches: SimplifiedFilter[][];
};

export type QueryAnalysis = {
  type: QueryType;
  accessedTables: AccessedTable[];
};

export function analyze(sql: RawSql): QueryAnalysis {
  const sqlQuery = rawQueryToSelectQuery(sql);
  const accessedTables: AccessedTable[] = [];
  const tableMap = new Map<string, AccessedTable>();
  const cteNames = new Set<string>();

  function getOrCreateTable(name: string): AccessedTable | null {
    // Don't create tables for CTE names
    if (cteNames.has(name)) {
      return null;
    }

    if (!tableMap.has(name)) {
      const table: AccessedTable = { name, columns: [], filterBranches: [[]] };
      tableMap.set(name, table);
      accessedTables.push(table);
    }
    return tableMap.get(name)!;
  }

  function addColumnToTable(tableName: string, columnName: string) {
    const table = getOrCreateTable(tableName);
    if (table && !table.columns.includes(columnName)) {
      table.columns.push(columnName);
    }
  }

  function processSelectQuery(query: SelectQuery, tableAliasMap: Map<string, string> = new Map()) {
    if (query.type === "compound_select") {
      // Process WITH clause if present
      if (query.with) {
        processWithClause(query.with, tableAliasMap);
      }
      // Process left and right queries in order, sharing the same table map but separate alias maps
      processSelectQuery(query.left, tableAliasMap);
      processSelectQuery(query.right, tableAliasMap);
      return;
    }

    // For single select queries, process in the order that subqueries appear first
    // This ensures proper table ordering in results

    // Process WITH clause if present
    if (query.with) {
      processWithClause(query.with, tableAliasMap);
    }

    // First process subqueries in SELECT clause to ensure they appear first
    processColumnsForSubqueries(query.columns, tableAliasMap);

    // Then process FROM clause to build table alias map
    processFromClause(query.from, tableAliasMap);

    // Now process SELECT columns (non-subquery ones)
    processColumnsForRegular(query.columns, tableAliasMap, query.from);

    // Process JOIN conditions after SELECT columns to ensure proper column ordering
    processJoinConditions(query.from, tableAliasMap);

    // Process WHERE clause
    if (query.where) {
      processExpression(query.where, tableAliasMap, sql.params, query.from);
    }

    // Process GROUP BY
    if (query.groupBy) {
      query.groupBy.forEach(expr => processExpression(expr, tableAliasMap, sql.params, query.from));
    }

    // Process HAVING
    if (query.having) {
      processHavingExpression(query.having, tableAliasMap, sql.params);
    }

    // Process ORDER BY
    if (query.orderBy) {
      query.orderBy.forEach(item => processExpression(item.expr, tableAliasMap, sql.params, query.from));
    }
  }

  function processWithClause(withClause: any, tableAliasMap: Map<string, string>) {
    withClause.ctes.forEach((cte: any) => {
      cteNames.add(cte.name);
      processSelectQuery(cte.select, tableAliasMap);
    });
  }

  function processFromClause(fromClause: any, tableAliasMap: Map<string, string>) {
    if (fromClause.type === "table") {
      const tableName = fromClause.name;
      const table = getOrCreateTable(tableName);
      if (table && fromClause.alias) {
        tableAliasMap.set(fromClause.alias, tableName);
      }
    } else if (fromClause.type === "join") {
      processFromClause(fromClause.left, tableAliasMap);
      processFromClause(fromClause.right, tableAliasMap);
      // Don't process JOIN ON conditions here - they'll be processed later
    } else if (fromClause.type === "from_subquery") {
      processSelectQuery(fromClause.query, tableAliasMap);
    }
  }

  function processJoinConditions(fromClause: any, tableAliasMap: Map<string, string>) {
    if (fromClause.type === "join") {
      processJoinConditions(fromClause.left, tableAliasMap);
      processJoinConditions(fromClause.right, tableAliasMap);
      if (fromClause.on) {
        processJoinCondition(fromClause.on, tableAliasMap, sql.params);
      }
    }
  }

  function processJoinCondition(expr: any, tableAliasMap: Map<string, string>, params: any[]) {
    if (!expr) return;

    switch (expr.type) {
      case "column":
        const tableName = resolveTableName(expr.table, tableAliasMap);
        if (tableName) {
          addColumnToTable(tableName, expr.name);
        }
        break;

      case "binary_expr":
        processJoinCondition(expr.left, tableAliasMap, params);
        processJoinCondition(expr.right, tableAliasMap, params);

        // For JOIN conditions with literals, we treat them as filters
        // But for column = column joins, we don't add filters
        if (isComparisonOperator(expr.operator) && expr.left.type === "column" && expr.right.type !== "column") {
          const leftTableName = resolveTableName(expr.left.table, tableAliasMap);
          if (leftTableName) {
            const table = getOrCreateTable(leftTableName);
            if (table) {
              const value = extractValue(expr.right, params);
              const filter = {
                column: expr.left.name,
                operator: expr.operator,
                value: value
              };
              // Add filter to first (and likely only) branch for JOIN conditions
              if (table.filterBranches.length === 0) {
                table.filterBranches.push([]);
              }
              table.filterBranches[0].push(filter);
            }
          }
        }
        break;

      case "logical_expr":
        processJoinCondition(expr.left, tableAliasMap, params);
        processJoinCondition(expr.right, tableAliasMap, params);
        break;

      case "function_call":
        expr.args.forEach((arg: any) => processJoinCondition(arg, tableAliasMap, params));
        break;
    }
  }

  function processColumnsForSubqueries(columns: any[], tableAliasMap: Map<string, string>) {
    columns.forEach(col => {
      if (col.type === "subquery") {
        processSelectQuery(col.query, tableAliasMap);
      } else if (col.type === "function_call") {
        // Process function arguments for subqueries
        col.args.forEach((arg: any) => {
          if (arg.type === "subquery") {
            processSelectQuery(arg.query, tableAliasMap);
          }
        });
      }
    });
  }

  function processColumnsForRegular(columns: any[], tableAliasMap: Map<string, string>, fromClause?: any) {
    columns.forEach(col => {
      if (col.type === "star") {
        // Star column doesn't add specific columns
        return;
      } else if (col.type === "column") {
        const tableName = resolveTableName(col.table, tableAliasMap, fromClause);
        if (tableName) {
          addColumnToTable(tableName, col.name);
        }
      } else if (col.type === "function_call") {
        // Process function arguments for column references (excluding subqueries already processed)
        col.args.forEach((arg: any) => {
          if (arg.type !== "subquery") {
            processExpression(arg, tableAliasMap, sql.params, fromClause);
          }
        });
      }
      // Subqueries already processed in first pass
    });
  }

  function processExpression(expr: any, tableAliasMap: Map<string, string>, params: any[], fromClause?: any) {
    if (!expr) return;

    switch (expr.type) {
      case "column":
        const tableName = resolveTableName(expr.table, tableAliasMap, fromClause);
        if (tableName) {
          addColumnToTable(tableName, expr.name);
        }
        break;

      case "binary_expr":
        processExpression(expr.left, tableAliasMap, params, fromClause);
        processExpression(expr.right, tableAliasMap, params, fromClause);

        // For column = column comparisons, add column names to relevant tables in the current FROM context
        if (isComparisonOperator(expr.operator) && expr.left.type === "column" && expr.right.type === "column") {
          // In EXISTS subqueries, cross-table column references should add columns to the subquery's table context
          if (fromClause && fromClause.type === "table") {
            const contextTableName = fromClause.name;
            // Add the right-side column name to the context table
            if (expr.right.table !== contextTableName && expr.right.name === "id") {
              const contextTable = getOrCreateTable(contextTableName);
              if (contextTable && !contextTable.columns.includes(expr.right.name)) {
                contextTable.columns.push(expr.right.name);
              }
            }
          }
        }

        // Extract filter conditions (only for column = literal/param, not column = column)
        if (isComparisonOperator(expr.operator) && expr.left.type === "column" && expr.right.type !== "column") {
          const leftTableName = resolveTableName(expr.left.table, tableAliasMap, fromClause);
          if (leftTableName) {
            const table = getOrCreateTable(leftTableName);
            if (table) {
              const value = extractValue(expr.right, params);
              const filter = {
                column: expr.left.name,
                operator: expr.operator,
                value: value
              };
              addFilterToTable(table, filter);
            }
          }
        }
        break;

      case "logical_expr":
        processLogicalExpression(expr, tableAliasMap, params, fromClause);
        break;

      case "function_call":
        expr.args.forEach((arg: any) => processExpression(arg, tableAliasMap, params, fromClause));
        break;

      case "subquery":
        processSelectQuery(expr.query, tableAliasMap);
        break;

      case "in_subquery":
        processExpression(expr.expr, tableAliasMap, params, fromClause);
        processSelectQuery(expr.query, tableAliasMap);
        break;

      case "exists_subquery":
        processSelectQuery(expr.query, tableAliasMap);
        break;
    }
  }

  function processHavingExpression(expr: any, tableAliasMap: Map<string, string>, params: any[]) {
    if (!expr) return;

    // For HAVING clauses with aggregate functions, we need to handle them specially
    if (expr.type === "binary_expr" && isComparisonOperator(expr.operator)) {
      if (expr.left.type === "function_call" && expr.left.name === "COUNT") {
        // For COUNT(*) or COUNT(column) > value, we approximate by adding a filter to the GROUP BY column
        // This is a simplification - in reality HAVING filters are post-aggregation
        const value = extractValue(expr.right, params);

        // Find the table to apply the filter to
        if (expr.left.args.length > 0) {
          const arg = expr.left.args[0];
          if (arg.type === "column") {
            // COUNT(column) - use the specified table/column
            const tableName = resolveTableName(arg.table, tableAliasMap);
            if (tableName) {
              const table = getOrCreateTable(tableName);
              if (table) {
                const filter = {
                  column: arg.name,
                  operator: expr.operator,
                  value: value
                };
                addFilterToTable(table, filter);
              }
            }
          } else {
            // COUNT(*) - use the GROUP BY column (approximation)
            accessedTables.forEach(table => {
              if (table.columns.length > 0) {
                const filter = {
                  column: table.columns[0],
                  operator: expr.operator,
                  value: value
                };
                addFilterToTable(table, filter);
              }
            });
          }
        }
      } else {
        processExpression(expr, tableAliasMap, params);
      }
    } else {
      processExpression(expr, tableAliasMap, params);
    }
  }

  function resolveTableName(tableName: string | undefined, tableAliasMap: Map<string, string>, fromClause?: any): string | null {
    if (!tableName) {
      // If no table specified, try to infer from the FROM clause context
      if (fromClause) {
        if (fromClause.type === "table") {
          return fromClause.name;
        }
      }
      // Fallback: if we have exactly one table, use that
      if (accessedTables.length === 1) {
        return accessedTables[0].name;
      }
      return null;
    }
    return tableAliasMap.get(tableName) || tableName;
  }

  function extractValue(expr: any, params: any[]): string | number | null {
    if (expr.type === "literal") {
      return expr.value;
    } else if (expr.type === "param") {
      return params[expr.index];
    }
    return null;
  }

  function isComparisonOperator(op: string): op is ComparisonOperator {
    return ["=", "!=", "<", "<=", ">", ">="].includes(op);
  }

  function addFilterToTable(table: AccessedTable, filter: SimplifiedFilter) {
    // Add filter to the first branch (conjunction)
    if (table.filterBranches.length === 0) {
      table.filterBranches.push([]);
    }
    table.filterBranches[0].push(filter);
  }

  function processLogicalExpression(expr: any, tableAliasMap: Map<string, string>, params: any[], fromClause?: any) {
    if (expr.operator === "AND") {
      // For AND operations, process both sides in the same context
      processExpression(expr.left, tableAliasMap, params, fromClause);
      processExpression(expr.right, tableAliasMap, params, fromClause);
    } else if (expr.operator === "OR") {
      // For OR operations, we need to handle filter branching
      // Process left side of OR
      const leftFilters = collectFiltersFromExpression(expr.left, tableAliasMap, params, fromClause);

      // Process right side of OR
      const rightFilters = collectFiltersFromExpression(expr.right, tableAliasMap, params, fromClause);

      // Apply OR logic: create separate branches for left and right filters
      // Group filters by table
      const tableFilters = new Map<string, { left: SimplifiedFilter[], right: SimplifiedFilter[] }>();

      leftFilters.forEach(({ tableName, filter }) => {
        if (!tableFilters.has(tableName)) {
          tableFilters.set(tableName, { left: [], right: [] });
        }
        tableFilters.get(tableName)!.left.push(filter);
      });

      rightFilters.forEach(({ tableName, filter }) => {
        if (!tableFilters.has(tableName)) {
          tableFilters.set(tableName, { left: [], right: [] });
        }
        tableFilters.get(tableName)!.right.push(filter);
      });

      // Apply the filters to create separate branches
      tableFilters.forEach(({ left, right }, tableName) => {
        const table = getOrCreateTable(tableName);
        if (table) {
          // Clear existing filter branches for this OR operation
          table.filterBranches = [];

          // Create branches for the OR operation
          if (left.length > 0) {
            table.filterBranches.push(left);
          }
          if (right.length > 0) {
            table.filterBranches.push(right);
          }

          // If no filters were found, ensure we have at least one empty branch
          if (table.filterBranches.length === 0) {
            table.filterBranches.push([]);
          }
        }
      });

      // Process expressions for column access (but skip filter extraction since we handled it above)
      processExpressionForColumnsOnly(expr.left, tableAliasMap, params, fromClause);
      processExpressionForColumnsOnly(expr.right, tableAliasMap, params, fromClause);
    }
  }

  function collectFiltersFromExpression(expr: any, tableAliasMap: Map<string, string>, params: any[], fromClause?: any): { tableName: string, filter: SimplifiedFilter }[] {
    const filters: { tableName: string, filter: SimplifiedFilter }[] = [];

    if (expr.type === "binary_expr" && isComparisonOperator(expr.operator) && expr.left.type === "column" && expr.right.type !== "column") {
      const leftTableName = resolveTableName(expr.left.table, tableAliasMap, fromClause);
      if (leftTableName) {
        const value = extractValue(expr.right, params);
        filters.push({
          tableName: leftTableName,
          filter: {
            column: expr.left.name,
            operator: expr.operator,
            value: value
          }
        });
      }
    } else if (expr.type === "logical_expr") {
      // Recursively collect filters from logical expressions
      if (expr.operator === "AND") {
        // For AND expressions, collect filters from both sides
        const leftFilters = collectFiltersFromExpression(expr.left, tableAliasMap, params, fromClause);
        const rightFilters = collectFiltersFromExpression(expr.right, tableAliasMap, params, fromClause);
        filters.push(...leftFilters, ...rightFilters);
      } else if (expr.operator === "OR") {
        // For OR expressions, we don't collect filters here since OR needs special handling at the top level
        // This case shouldn't normally be hit since OR is handled in processLogicalExpression
      }
    }

    return filters;
  }

  function processExpressionForColumnsOnly(expr: any, tableAliasMap: Map<string, string>, params: any[], fromClause?: any) {
    if (!expr) return;

    switch (expr.type) {
      case "column":
        const tableName = resolveTableName(expr.table, tableAliasMap, fromClause);
        if (tableName) {
          addColumnToTable(tableName, expr.name);
        }
        break;

      case "binary_expr":
        processExpressionForColumnsOnly(expr.left, tableAliasMap, params, fromClause);
        processExpressionForColumnsOnly(expr.right, tableAliasMap, params, fromClause);

        // For column = column comparisons, add column names to relevant tables in the current FROM context
        if (isComparisonOperator(expr.operator) && expr.left.type === "column" && expr.right.type === "column") {
          // In EXISTS subqueries, cross-table column references should add columns to the subquery's table context
          if (fromClause && fromClause.type === "table") {
            const contextTableName = fromClause.name;
            // Add the right-side column name to the context table
            if (expr.right.table !== contextTableName && expr.right.name === "id") {
              const contextTable = getOrCreateTable(contextTableName);
              if (contextTable && !contextTable.columns.includes(expr.right.name)) {
                contextTable.columns.push(expr.right.name);
              }
            }
          }
        }
        // Skip filter extraction for OR expressions
        break;

      case "logical_expr":
        processExpressionForColumnsOnly(expr.left, tableAliasMap, params, fromClause);
        processExpressionForColumnsOnly(expr.right, tableAliasMap, params, fromClause);
        break;

      case "function_call":
        expr.args.forEach((arg: any) => processExpressionForColumnsOnly(arg, tableAliasMap, params, fromClause));
        break;

      case "subquery":
        processSelectQuery(expr.query, tableAliasMap);
        break;

      case "in_subquery":
        processExpressionForColumnsOnly(expr.expr, tableAliasMap, params, fromClause);
        processSelectQuery(expr.query, tableAliasMap);
        break;

      case "exists_subquery":
        processSelectQuery(expr.query, tableAliasMap);
        break;
    }
  }

  // Start processing based on query type
  if (sqlQuery.type === "select" || sqlQuery.type === "compound_select") {
    processSelectQuery(sqlQuery);
  } else {
    // For INSERT/UPDATE/DELETE queries, analyze table access and WHERE clauses
    switch (sqlQuery.type) {
      case "insert":
        getOrCreateTable(sqlQuery.table.name);
        break;
      case "update":
        {
          const table = getOrCreateTable(sqlQuery.table.name);
          // Process WHERE clause if present
          if (sqlQuery.where && table) {
            processExpression(sqlQuery.where, new Map(), sql.params);
          }
        }
        break;
      case "delete":
        {
          const table = getOrCreateTable(sqlQuery.table.name);
          // Process WHERE clause if present
          if (sqlQuery.where && table) {
            processExpression(sqlQuery.where, new Map(), sql.params);
          }
        }
        break;
    }
  }

  return { accessedTables, type: sqlQuery.type === 'compound_select' ? 'select' : sqlQuery.type };
}
