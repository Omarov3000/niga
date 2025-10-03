import { rawQueryToAst } from './raw-query-to-ast';
import { Sql } from './sql-types';
import { RawSql } from '../utils/sql';

export function extractTables(sql: RawSql): string[] {
  const ast = rawQueryToAst(sql);
  const tables = new Set<string>();
  extractTablesFromQuery(ast, tables);
  return Array.from(tables);
}

function extractTablesFromQuery(ast: Sql.SqlQuery, tables: Set<string>): void {
  switch (ast.type) {
    case 'select':
    case 'compound_select':
      extractTablesFromSelect(ast, tables);
      break;
    case 'insert':
      tables.add(ast.table.name);
      if (ast.select) {
        extractTablesFromSelect(ast.select, tables);
      }
      break;
    case 'update':
      tables.add(ast.table.name);
      if (ast.from) {
        extractTablesFromFromClause(ast.from, tables);
      }
      break;
    case 'delete':
      tables.add(ast.table.name);
      if (ast.using) {
        extractTablesFromFromClause(ast.using, tables);
      }
      break;
  }
}

function extractTablesFromSelect(query: Sql.SelectQuery, tables: Set<string>): void {
  if (query.type === 'compound_select') {
    if (query.with) {
      extractTablesFromWithClause(query.with, tables);
    }
    extractTablesFromSelect(query.left, tables);
    extractTablesFromSelect(query.right, tables);
  } else {
    if (query.with) {
      extractTablesFromWithClause(query.with, tables);
    }
    extractTablesFromFromClause(query.from, tables);

    if (query.where) {
      extractTablesFromExpression(query.where, tables);
    }

    query.columns.forEach(col => extractTablesFromExpression(col, tables));

    if (query.groupBy) {
      query.groupBy.forEach(expr => extractTablesFromExpression(expr, tables));
    }

    if (query.having) {
      extractTablesFromExpression(query.having, tables);
    }
  }
}

function extractTablesFromWithClause(withClause: Sql.WithClause, tables: Set<string>): void {
  withClause.ctes.forEach(cte => {
    extractTablesFromSelect(cte.select, tables);
  });
}

function extractTablesFromFromClause(from: Sql.FromClause, tables: Set<string>): void {
  switch (from.type) {
    case 'table':
      tables.add(from.name);
      break;
    case 'join':
      extractTablesFromFromClause(from.left, tables);
      extractTablesFromFromClause(from.right, tables);
      if (from.on) {
        extractTablesFromExpression(from.on, tables);
      }
      break;
    case 'from_subquery':
      extractTablesFromSelect(from.query, tables);
      break;
  }
}

function extractTablesFromExpression(expr: Sql.Expression, tables: Set<string>): void {
  switch (expr.type) {
    case 'subquery':
      extractTablesFromSelect(expr.query, tables);
      break;
    case 'in_subquery':
      extractTablesFromExpression(expr.expr, tables);
      extractTablesFromSelect(expr.query, tables);
      break;
    case 'exists_subquery':
      extractTablesFromSelect(expr.query, tables);
      break;
    case 'binary_expr':
      extractTablesFromExpression(expr.left, tables);
      extractTablesFromExpression(expr.right, tables);
      break;
    case 'logical_expr':
      extractTablesFromExpression(expr.left, tables);
      extractTablesFromExpression(expr.right, tables);
      break;
    case 'function_call':
      expr.args.forEach(arg => extractTablesFromExpression(arg, tables));
      break;
  }
}
