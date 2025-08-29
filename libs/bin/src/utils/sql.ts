export type SelectSql = { query: string; params: any[] }; // we get this as input
import { Column } from '../column';
import { Sql } from '../security/sqlTypes';

export function sql(strings: TemplateStringsArray, ...values: any[]): SelectSql {
  let query = "";
  const params: any[] = [];

  strings.forEach((part, i) => {
    query += part;
    if (i < values.length) {
      const value = values[i];
      if (value instanceof FilterObject) {
        const serialized = serializeFilterObject(value);
        query += serialized.query;
        params.push(...serialized.params);
      } else if (value instanceof Column) {
        const table = value.__table__?.getName();
        const col = value.__meta__.name;
        query += table ? `${table}.${col}` : col;
      } else {
        query += "?"; // use ? as placeholder
        params.push(value);
      }
    }
  });

  return { query, params };
}

function serializeFilterObject(filter: FilterObject): { query: string; params: any[] } {
  const column = filter.left.table ? `${filter.left.table}.${filter.left.name}` : filter.left.name;

  switch (filter.operator) {
    case "IS NULL":
    case "IS NOT NULL":
      return { query: `${column} ${filter.operator}`, params: [] };

    case "BETWEEN":
    case "NOT BETWEEN":
      if (!filter.right || !Array.isArray(filter.right.value) || filter.right.value.length !== 2) {
        throw new Error(`${filter.operator} requires exactly two values`);
      }
      return {
        query: `${column} ${filter.operator} ? AND ?`,
        params: filter.right.value
      };

    case "IN":
    case "NOT IN":
      if (!filter.right || !Array.isArray(filter.right.value)) {
        throw new Error(`${filter.operator} requires an array of values`);
      }
      const placeholders = filter.right.value.map(() => "?").join(", ");
      return {
        query: `${column} ${filter.operator} (${placeholders})`,
        params: filter.right.value
      };

    default:
      if (!filter.right) {
        throw new Error(`Operator ${filter.operator} requires a value`);
      }
      return {
        query: `${column} ${filter.operator} ?`,
        params: [filter.right.value]
      };
  }
}

type ComparisonOperator = "=" | "!=" | "<" | "<=" | ">" | ">=";

export class SqlPart {}

export class FilterObject extends SqlPart {
  type: "binary_expr" = "binary_expr";
  operator: ComparisonOperator | "LIKE" | "NOT LIKE" | "BETWEEN" | "NOT BETWEEN" | "IN" | "NOT IN" | "IS NULL" | "IS NOT NULL";
  left: { type: "column"; name: string; table?: string };
  right?: { type: "literal"; value: any };

  constructor(
    operator: ComparisonOperator | "LIKE" | "NOT LIKE" | "BETWEEN" | "NOT BETWEEN" | "IN" | "NOT IN" | "IS NULL" | "IS NOT NULL",
    left: { type: "column"; name: string; table?: string },
    right?: { type: "literal"; value: any }
  ) {
    super();
    this.operator = operator;
    this.left = left;
    this.right = right;
  }
}

export interface BinSql {
  query: Sql.SqlQuery
  sql: string
  params: any[]
}
