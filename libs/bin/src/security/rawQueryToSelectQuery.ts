type Column =
  | { type: "column"; name: string; table?: string; alias?: string }
  | { type: "star" };

type Table = { type: "table"; name: string; alias?: string };

type Literal =
  | { type: "literal"; value: string | number | null }
  | { type: "param"; index: number }; // e.g. "?" placeholders


type SubqueryExpression =
  | { type: "subquery"; query: SelectQuery } // scalar subquery
  | { type: "in_subquery"; expr: Expression; query: SelectQuery }
  | { type: "exists_subquery"; query: SelectQuery };

export type ComparisonOperator = "=" | "!=" | "<" | "<=" | ">" | ">=";
type ComparisonExpression = {
  type: "binary_expr";
  operator: ComparisonOperator;
  left: Expression;
  right: Expression;
};

type LogicalOperator = "AND" | "OR";
type LogicalExpression = {
  type: "logical_expr";
  operator: LogicalOperator;
  left: Expression;
  right: Expression;
};

type FunctionCall = {
  type: "function_call";
  name: string;
  args: Expression[];
  alias?: string;
};

type Expression =
  | Column
  | Literal
  | ComparisonExpression
  | LogicalExpression
  | SubqueryExpression
  | FunctionCall;

type JoinType = "INNER" | "LEFT" | "RIGHT" | "CROSS";

type Join = {
  type: "join";
  joinType: JoinType;
  left: FromClause;
  right: FromClause;
  on?: Expression;
};

type FromSubquery = {
  type: "from_subquery";
  query: SelectQuery;
  alias: string;
};

type FromClause = Table | Join | FromSubquery;

type CTE = {
  type: "cte";
  name: string;
  columns?: string[];
  select: SelectQuery;
};

type WithClause = {
  recursive: boolean;
  ctes: CTE[];
};

type OrderByItem = {
  expr: Expression;
  direction?: "ASC" | "DESC";
};

type LimitClause = {
  limit: number | Expression;
  offset?: number | Expression;
};

type SelectStatement = {
  type: "select";
  with?: WithClause;
  columns: Expression[];
  from: FromClause;
  where?: Expression;
  groupBy?: Expression[];
  having?: Expression;
  orderBy?: OrderByItem[];
  limit?: LimitClause;
};

type SetOperator = "UNION" | "UNION ALL" | "INTERSECT" | "EXCEPT";

type CompoundSelect = {
  type: "compound_select";
  with?: WithClause;
  left: SelectQuery;
  operator: SetOperator;
  right: SelectQuery;
  orderBy?: OrderByItem[];
  limit?: LimitClause;
};

export type SelectQuery = SelectStatement | CompoundSelect;

import { parse } from "sql-parser-cst";
import { SelectSql } from '../utils/sql';

export function rawQueryToSelectQuery(sql: SelectSql): SelectQuery {
  // Replace ? placeholders with unique placeholder values that we can track
  let processedQuery = sql.query;
  const paramMarkers: string[] = [];
  let paramIndex = 0;

  // Find all ? positions and replace them with unique markers
  processedQuery = processedQuery.replace(/\?/g, (match, offset) => {
    const marker = `__PARAM_${paramIndex}__`;
    paramMarkers.push(marker);
    const param = sql.params[paramIndex++];

    if (param === null) return 'NULL';
    if (typeof param === 'string') return `'${marker}'`;
    if (typeof param === 'number') return marker;
    return 'NULL';
  });

  const ast = parse(processedQuery, { dialect: "sqlite" });
  const statement = ast.statements[0];

  if (!statement) {
    throw new Error("Expected SELECT statement");
  }

  // Handle compound selects
  if (statement.type === "compound_select_stmt") {
    return transformCompoundSelect(statement, sql.params, paramMarkers);
  }

  if (statement.type !== "select_stmt") {
    throw new Error("Expected SELECT statement");
  }

  return transformSelectStatement(statement, sql.params, paramMarkers);
}

function transformSelectStatement(stmt: any, params: any[], paramMarkers: string[]): SelectQuery {
  // Handle compound select (UNION, INTERSECT, EXCEPT)
  if (stmt.type === "compound_select_stmt") {
    return transformCompoundSelect(stmt, params, paramMarkers);
  }

  // Handle regular select statement
  const result: SelectStatement = {
    type: "select",
    columns: [],
    from: { type: "table", name: "" }
  };

  // Process clauses in order
  for (const clause of stmt.clauses) {
    switch (clause.type) {
      case "with_clause":
        result.with = transformWithClause(clause, params, paramMarkers);
        break;
      case "select_clause":
        result.columns = transformSelectClause(clause, params, paramMarkers);
        break;
      case "from_clause":
        result.from = transformFromClause(clause, params, paramMarkers);
        break;
      case "where_clause":
        result.where = transformExpression(clause.expr, params, paramMarkers);
        break;
      case "group_by_clause":
        result.groupBy = transformGroupByClause(clause, params, paramMarkers);
        break;
      case "having_clause":
        result.having = transformExpression(clause.expr, params, paramMarkers);
        break;
      case "order_by_clause":
        result.orderBy = transformOrderByClause(clause, params, paramMarkers);
        break;
      case "limit_clause":
        result.limit = transformLimitClause(clause, params, paramMarkers);
        break;
      case "offset_clause":
        if (result.limit) {
          result.limit.offset = transformExpression(clause.offset, params, paramMarkers);
        }
        break;
    }
  }

  return result;
}

function transformCompoundSelect(stmt: any, params: any[], paramMarkers: string[]): CompoundSelect {
  const operatorText = Array.isArray(stmt.operator)
    ? stmt.operator.map((op: any) => op.text || op).join(" ")
    : stmt.operator.text || stmt.operator;

  // Transform left and right sides
  const leftResult = transformSelectStatement(stmt.left, params, paramMarkers) as SelectStatement;
  const rightResult = transformSelectStatement(stmt.right, params, paramMarkers) as SelectStatement;

  const result: CompoundSelect = {
    type: "compound_select",
    left: leftResult,
    operator: operatorText as SetOperator,
    right: rightResult
  };

  // Hoist WITH clause from left side to compound level if it exists
  if (leftResult.with) {
    result.with = leftResult.with;
    // Remove WITH from left side since it's now at compound level
    delete leftResult.with;
  }

  // Hoist ORDER BY and LIMIT from right side to compound level if they exist
  if (rightResult.orderBy) {
    result.orderBy = rightResult.orderBy;
    delete rightResult.orderBy;
  }

  if (rightResult.limit) {
    result.limit = rightResult.limit;
    delete rightResult.limit;
  }

  // Handle compound-level clauses if they exist directly on the statement
  if (stmt.with) {
    result.with = transformWithClause(stmt.with, params, paramMarkers);
  }

  if (stmt.orderBy) {
    result.orderBy = transformOrderByClause(stmt.orderBy, params, paramMarkers);
  }

  if (stmt.limit) {
    result.limit = transformLimitClause(stmt.limit, params, paramMarkers);
  }

  return result;
}

function transformWithClause(clause: any, params: any[], paramMarkers: string[]): WithClause {
  return {
    recursive: !!clause.recursiveKw,
    ctes: clause.tables.items.map((cte: any) => transformCTE(cte, params, paramMarkers))
  };
}

function transformCTE(cte: any, params: any[], paramMarkers: string[]): CTE {
  return {
    type: "cte",
    name: cte.table.name,
    columns: cte.columns?.expr?.items?.map((col: any) => col.name),
    select: transformSelectStatement(cte.expr.expr, params, paramMarkers)
  };
}

function transformSelectClause(clause: any, params: any[], paramMarkers: string[]): Expression[] {
  if (!clause.columns) return [];

  return clause.columns.items.map((item: any) => transformExpression(item, params, paramMarkers));
}

function transformFromClause(clause: any, params: any[], paramMarkers: string[]): FromClause {
  return transformTableExpression(clause.expr, params, paramMarkers);
}

function transformTableExpression(expr: any, params: any[], paramMarkers: string[]): FromClause {
  if (expr.type === "join_expr") {
    return transformJoinExpression(expr, params, paramMarkers);
  }

  if (expr.type === "paren_expr" && expr.expr.type === "select_stmt") {
    // Subquery in FROM clause
    return {
      type: "from_subquery",
      query: transformSelectStatement(expr.expr, params, paramMarkers),
      alias: "" // Will be set by alias wrapper
    };
  }

  // Handle table with potential alias
  if (expr.type === "alias") {
    const table = transformTableExpression(expr.expr, params, paramMarkers);
    if (table.type === "table") {
      table.alias = expr.alias.name;
    } else if (table.type === "from_subquery") {
      table.alias = expr.alias.name;
    }
    return table;
  }

  // Simple table
  return {
    type: "table",
    name: expr.name || expr.text
  };
}

function transformJoinExpression(expr: any, params: any[], paramMarkers: string[]): Join {
  const joinTypes: Record<string, JoinType> = {
    "INNER JOIN": "INNER",
    "LEFT JOIN": "LEFT",
    "RIGHT JOIN": "RIGHT",
    "CROSS JOIN": "CROSS",
    "JOIN": "INNER"
  };

  const operatorText = Array.isArray(expr.operator)
    ? expr.operator.map((op: any) => op.text || op).filter(Boolean).join(" ")
    : expr.operator;

  return {
    type: "join",
    joinType: joinTypes[operatorText] || "INNER",
    left: transformTableExpression(expr.left, params, paramMarkers),
    right: transformTableExpression(expr.right, params, paramMarkers),
    on: expr.specification?.expr ? transformExpression(expr.specification.expr, params, paramMarkers) : undefined
  };
}

function transformExpression(expr: any, params: any[], paramMarkers: string[]): Expression {
  if (!expr) return { type: "literal", value: null };


  switch (expr.type) {
    case "all_columns":
      return { type: "star" };

    case "identifier":
      // Check if this is a parameter marker
      const identifierText = expr.name;
      const paramIndex = paramMarkers.findIndex(marker => identifierText === marker);
      if (paramIndex >= 0) {
        return { type: "param", index: paramIndex };
      }

      // Check if this is NULL
      if (expr.name && expr.name.toUpperCase() === 'NULL') {
        return { type: "literal", value: null };
      }

      return { type: "column", name: expr.name };

    case "member_expr":
      return {
        type: "column",
        name: expr.property.name,
        table: expr.object.name
      };

    case "alias":
      const baseExpr = transformExpression(expr.expr, params, paramMarkers);
      if (baseExpr.type === "column") {
        baseExpr.alias = expr.alias.name;
      } else if (baseExpr.type === "function_call") {
        baseExpr.alias = expr.alias.name;
      } else if (baseExpr.type === "subquery") {
        (baseExpr as any).alias = expr.alias.name;
      }
      return baseExpr;

    case "literal":
    case "string_literal":
    case "null_literal":
      // Check if this literal is actually a parameter marker
      if (expr.value && typeof expr.value === 'string') {
        const paramIndex = paramMarkers.findIndex(marker => expr.value === marker);
        if (paramIndex >= 0) {
          return { type: "param", index: paramIndex };
        }
      }
      return { type: "literal", value: expr.value };

    case "binary_expr":
      return transformBinaryExpression(expr, params, paramMarkers);

    case "func_call":
      return transformFunctionCall(expr, params, paramMarkers);

    case "paren_expr":
      if (expr.expr.type === "select_stmt") {
        return {
          type: "subquery",
          query: transformSelectStatement(expr.expr, params, paramMarkers)
        };
      }
      return transformExpression(expr.expr, params, paramMarkers);

    case "prefix_op_expr":
      if (expr.operator === "EXISTS" || (expr.operator.text && expr.operator.text === "EXISTS")) {
        return {
          type: "exists_subquery",
          query: transformSelectStatement(expr.expr.expr, params, paramMarkers)
        };
      }
      break;

    default:
      // Try to parse as literal
      if (typeof expr.text === "string") {
        // Check if it's NULL
        if (expr.text.toUpperCase() === "NULL") {
          return { type: "literal", value: null };
        }
        // Check if it's a number
        const num = Number(expr.text);
        if (!isNaN(num)) {
          return { type: "literal", value: num };
        }
      }

      return { type: "column", name: expr.text || expr.name || "unknown" };
  }

  return { type: "literal", value: null };
}

function transformBinaryExpression(expr: any, params: any[], paramMarkers: string[]): Expression {
  const operatorText = Array.isArray(expr.operator)
    ? expr.operator.map((op: any) => op.text || op).join(" ")
    : expr.operator.text || expr.operator;

  // Handle IN subquery
  if (operatorText === "IN" && expr.right.type === "paren_expr" && expr.right.expr.type === "select_stmt") {
    return {
      type: "in_subquery",
      expr: transformExpression(expr.left, params, paramMarkers),
      query: transformSelectStatement(expr.right.expr, params, paramMarkers)
    };
  }

  // Handle logical operators
  if (operatorText === "AND" || operatorText === "OR") {
    return {
      type: "logical_expr",
      operator: operatorText as LogicalOperator,
      left: transformExpression(expr.left, params, paramMarkers),
      right: transformExpression(expr.right, params, paramMarkers)
    };
  }

  // Handle comparison operators
  const comparisonOps: ComparisonOperator[] = ["=", "!=", "<", "<=", ">", ">="];
  if (comparisonOps.includes(operatorText as ComparisonOperator)) {
    return {
      type: "binary_expr",
      operator: operatorText as ComparisonOperator,
      left: transformExpression(expr.left, params, paramMarkers),
      right: transformExpression(expr.right, params, paramMarkers)
    };
  }

  // Default to binary expression
  return {
    type: "binary_expr",
    operator: "=" as ComparisonOperator,
    left: transformExpression(expr.left, params, paramMarkers),
    right: transformExpression(expr.right, params, paramMarkers)
  };
}

function transformFunctionCall(expr: any, params: any[], paramMarkers: string[]): FunctionCall {
  const name = expr.name.name || expr.name.text;
  // Function arguments are nested: args.expr.args.items
  const args = expr.args?.expr?.args?.items?.map((arg: any) => transformExpression(arg, params, paramMarkers)) || [];

  return {
    type: "function_call",
    name,
    args
  };
}

function transformGroupByClause(clause: any, params: any[], paramMarkers: string[]): Expression[] {
  return clause.columns.items.map((item: any) => transformExpression(item, params, paramMarkers));
}

function transformOrderByClause(clause: any, params: any[], paramMarkers: string[]): OrderByItem[] {
  return clause.specifications.items.map((spec: any) => {
    const result: OrderByItem = {
      expr: transformExpression(spec.expr || spec, params, paramMarkers)
    };

    if (spec.direction) {
      result.direction = spec.direction.type === "sort_direction_asc" ? "ASC" : "DESC";
    }

    return result;
  });
}

function transformLimitClause(clause: any, params: any[], paramMarkers: string[]): LimitClause {
  const limitExpr = transformExpression(clause.count, params, paramMarkers);

  const result: LimitClause = {
    limit: limitExpr.type === 'literal' && typeof limitExpr.value === 'number' ? limitExpr.value : limitExpr
  };

  if (clause.offset) {
    const offsetExpr = transformExpression(clause.offset, params, paramMarkers);
    result.offset = offsetExpr.type === 'literal' && typeof offsetExpr.value === 'number' ? offsetExpr.value : offsetExpr;
  }

  return result;
}
