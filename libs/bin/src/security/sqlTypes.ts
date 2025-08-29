export type ComparisonOperator = "=" | "!=" | "<" | "<=" | ">" | ">=";
export type LogicalOperator = "AND" | "OR";
export type JoinType = "INNER" | "LEFT" | "RIGHT" | "CROSS";
export type SetOperator = "UNION" | "UNION ALL" | "INTERSECT" | "EXCEPT";

export namespace Sql {
  export type ComparisonOperator = "=" | "!=" | "<" | "<=" | ">" | ">=";
  export type LogicalOperator = "AND" | "OR";
  export type JoinType = "INNER" | "LEFT" | "RIGHT" | "CROSS";
  export type SetOperator = "UNION" | "UNION ALL" | "INTERSECT" | "EXCEPT";

  export type Column =
    | { type: "column"; name: string; table?: string; alias?: string }
    | { type: "star" };

  export type Table = { type: "table"; name: string; alias?: string };

  export type Literal =
    | { type: "literal"; value: string | number | null }
    | { type: "param"; index: number }; // e.g. "?" placeholders

  export type SubqueryExpression =
    | { type: "subquery"; query: SelectQuery } // scalar subquery
    | { type: "in_subquery"; expr: Expression; query: SelectQuery }
    | { type: "exists_subquery"; query: SelectQuery };

  export type ComparisonExpression = {
    type: "binary_expr";
    operator: ComparisonOperator;
    left: Expression;
    right: Expression;
  };

  export type LogicalExpression = {
    type: "logical_expr";
    operator: LogicalOperator;
    left: Expression;
    right: Expression;
  };

  export type FunctionCall = {
    type: "function_call";
    name: string;
    args: Expression[];
    alias?: string;
  };

  export type Expression =
    | Column
    | Literal
    | ComparisonExpression
    | LogicalExpression
    | SubqueryExpression
    | FunctionCall;

  export type Join = {
    type: "join";
    joinType: JoinType;
    left: FromClause;
    right: FromClause;
    on?: Expression;
  };

  export type FromSubquery = {
    type: "from_subquery";
    query: SelectQuery;
    alias: string;
  };

  export type FromClause = Table | Join | FromSubquery;

  export type CTE = {
    type: "cte";
    name: string;
    columns?: string[];
    select: SelectQuery;
  };

  export type WithClause = {
    recursive: boolean;
    ctes: CTE[];
  };

  export type OrderByItem = {
    expr: Expression;
    direction?: "ASC" | "DESC";
  };

  export type LimitClause = {
    limit: number | Expression;
    offset?: number | Expression;
  };

  export type SelectStatement = {
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

  export type CompoundSelect = {
    type: "compound_select";
    with?: WithClause;
    left: SelectQuery;
    operator: SetOperator;
    right: SelectQuery;
    orderBy?: OrderByItem[];
    limit?: LimitClause;
  };

  export type SelectQuery = SelectStatement | CompoundSelect;

  export type InsertStatement = {
    type: "insert";
    with?: WithClause;
    table: Table;
    columns?: string[]; // optional, if omitted assume all columns
    values?: Expression[][]; // multiple rows of values
    select?: SelectQuery; // INSERT ... SELECT ...
    returning?: Expression[]; // e.g. PostgreSQL RETURNING
  };

  export type UpdateStatement = {
    type: "update";
    with?: WithClause;
    table: Table;
    set: {
      column: string;
      value: Expression;
    }[];
    from?: FromClause; // e.g. UPDATE ... FROM ...
    where?: Expression;
    returning?: Expression[];
  };

  export type DeleteStatement = {
    type: "delete";
    with?: WithClause;
    table: Table;
    where?: Expression;
    using?: FromClause; // e.g. DELETE ... USING ...
    returning?: Expression[];
  };

  export type SqlQuery =
    | SelectQuery
    | InsertStatement
    | UpdateStatement
    | DeleteStatement;
}

export type SelectQuery = Sql.SelectQuery;
export type SqlQuery = Sql.SqlQuery;