export type RawSql = { query: string; params: any[] }; // we get this as input
import { Column } from '../column';
import { Sql } from '../security/sql-types';

export function sql(strings: TemplateStringsArray, ...values: any[]): RawSql {
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
      } else if (value instanceof OrderObject) {
        const serialized = serializeOrderObject(value);
        query += serialized.query;
        params.push(...serialized.params);
      } else if (value instanceof Column) {
        const table = value.__table__;
        if (!table) {
          throw new Error('Column must be attached to a table before serializing to SQL');
        }
        // Use definition for virtual columns with aggregate functions
        if (value.__meta__.definition) {
          query += `${value.__meta__.definition} AS ${value.__meta__.dbName}`;
        } else {
          const col = value.__meta__.dbName;
          query += `${table.getDbName()}.${col}`;
        }
      } else {
        query += "?"; // use ? as placeholder
        params.push(value);
      }
    }
  });

  return { query, params };
}

function serializeFilterObject(filter: FilterObject): { query: string; params: any[] } {
  const column = `${filter.left.table}.${filter.left.name}`;

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

function serializeOrderObject(order: OrderObject): { query: string; params: any[] } {
  const column = `${order.column.table}.${order.column.name}`;
  return {
    query: `${column} ${order.direction}`,
    params: []
  };
}

type ComparisonOperator = "=" | "!=" | "<" | "<=" | ">" | ">=";

export class SqlPart {}

type ColumnReference = { type: "column"; name: string; table: string; runtime: { name: string; table: string } };

export class FilterObject extends SqlPart {
  type: "binary_expr" = "binary_expr";
  operator: ComparisonOperator | "LIKE" | "NOT LIKE" | "BETWEEN" | "NOT BETWEEN" | "IN" | "NOT IN" | "IS NULL" | "IS NOT NULL";
  left: ColumnReference;
  right?: { type: "literal"; value: any };

  constructor(
    operator: ComparisonOperator | "LIKE" | "NOT LIKE" | "BETWEEN" | "NOT BETWEEN" | "IN" | "NOT IN" | "IS NULL" | "IS NOT NULL",
    left: ColumnReference,
    right?: { type: "literal"; value: any }
  ) {
    super();
    this.operator = operator;
    this.left = left;
    this.right = right;
  }
}

export class OrderObject extends SqlPart {
  type: "order_by_item" = "order_by_item";
  column: ColumnReference;
  direction: "ASC" | "DESC";

  constructor(
    column: ColumnReference,
    direction: "ASC" | "DESC"
  ) {
    super();
    this.column = column;
    this.direction = direction;
  }
}

export function inlineParams(rawSql: RawSql): string {
  let { query, params } = rawSql;
  let paramIndex = 0;

  return query.replace(/\?/g, () => {
    if (paramIndex >= params.length) {
      return '?';
    }

    const param = params[paramIndex++];

    if (param === null) {
      return 'NULL';
    }

    if (typeof param === 'string') {
      return `'${param.replace(/'/g, "''")}'`;
    }

    if (typeof param === 'number') {
      return param.toString();
    }

    if (typeof param === 'boolean') {
      return param ? '1' : '0';
    }

    if (param instanceof Date) {
      return `'${param.toISOString()}'`;
    }

    if (param instanceof Buffer || param instanceof Uint8Array) {
      return `X'${Array.from(param).map(b => b.toString(16).padStart(2, '0')).join('')}'`;
    }

    return `'${String(param).replace(/'/g, "''")}'`;
  });
}
