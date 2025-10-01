import { Sql } from './sql-types';

export interface LiveQuery {
  toAst: () => Sql.SqlQuery;
}

export type InvalidationCallback = () => void;

interface Subscription {
  query: LiveQuery;
  callback: InvalidationCallback;
  affectedTables: Set<string>;
}

export class LiveQueryManager {
  private subscriptions: Map<number, Subscription> = new Map();
  private nextId = 0;

  subscribe(query: LiveQuery, callback: InvalidationCallback): () => void {
    const id = this.nextId++;
    const ast = query.toAst();
    const affectedTables = this.extractAffectedTables(ast);

    this.subscriptions.set(id, {
      query,
      callback,
      affectedTables,
    });

    return () => {
      this.subscriptions.delete(id);
    };
  }

  invalidate(tableName: string, changedIds?: (string | number)[]): void {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.affectedTables.has(tableName)) {
        subscription.callback();
      }
    }
  }

  private extractAffectedTables(ast: Sql.SqlQuery): Set<string> {
    const tables = new Set<string>();

    switch (ast.type) {
      case 'select':
      case 'compound_select':
        this.extractTablesFromSelect(ast, tables);
        break;
      case 'insert':
        tables.add(ast.table.name);
        if (ast.select) {
          this.extractTablesFromSelect(ast.select, tables);
        }
        break;
      case 'update':
        tables.add(ast.table.name);
        if (ast.from) {
          this.extractTablesFromFromClause(ast.from, tables);
        }
        break;
      case 'delete':
        tables.add(ast.table.name);
        if (ast.using) {
          this.extractTablesFromFromClause(ast.using, tables);
        }
        break;
    }

    return tables;
  }

  private extractTablesFromSelect(query: Sql.SelectQuery, tables: Set<string>): void {
    if (query.type === 'compound_select') {
      if (query.with) {
        this.extractTablesFromWithClause(query.with, tables);
      }
      this.extractTablesFromSelect(query.left, tables);
      this.extractTablesFromSelect(query.right, tables);
    } else {
      if (query.with) {
        this.extractTablesFromWithClause(query.with, tables);
      }
      this.extractTablesFromFromClause(query.from, tables);

      if (query.where) {
        this.extractTablesFromExpression(query.where, tables);
      }

      query.columns.forEach(col => this.extractTablesFromExpression(col, tables));

      if (query.groupBy) {
        query.groupBy.forEach(expr => this.extractTablesFromExpression(expr, tables));
      }

      if (query.having) {
        this.extractTablesFromExpression(query.having, tables);
      }
    }
  }

  private extractTablesFromWithClause(withClause: Sql.WithClause, tables: Set<string>): void {
    withClause.ctes.forEach(cte => {
      this.extractTablesFromSelect(cte.select, tables);
    });
  }

  private extractTablesFromFromClause(from: Sql.FromClause, tables: Set<string>): void {
    switch (from.type) {
      case 'table':
        tables.add(from.name);
        break;
      case 'join':
        this.extractTablesFromFromClause(from.left, tables);
        this.extractTablesFromFromClause(from.right, tables);
        if (from.on) {
          this.extractTablesFromExpression(from.on, tables);
        }
        break;
      case 'from_subquery':
        this.extractTablesFromSelect(from.query, tables);
        break;
    }
  }

  private extractTablesFromExpression(expr: Sql.Expression, tables: Set<string>): void {
    switch (expr.type) {
      case 'subquery':
        this.extractTablesFromSelect(expr.query, tables);
        break;
      case 'in_subquery':
        this.extractTablesFromExpression(expr.expr, tables);
        this.extractTablesFromSelect(expr.query, tables);
        break;
      case 'exists_subquery':
        this.extractTablesFromSelect(expr.query, tables);
        break;
      case 'binary_expr':
        this.extractTablesFromExpression(expr.left, tables);
        this.extractTablesFromExpression(expr.right, tables);
        break;
      case 'logical_expr':
        this.extractTablesFromExpression(expr.left, tables);
        this.extractTablesFromExpression(expr.right, tables);
        break;
      case 'function_call':
        expr.args.forEach(arg => this.extractTablesFromExpression(arg, tables));
        break;
    }
  }
}