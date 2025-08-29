import type { TableMetadata } from './types';

export interface DbConstructorOptions {
  schema: Record<string, { __meta__: TableMetadata }>;
}

export class Db {
  constructor(private options: DbConstructorOptions) {}

  getSchemaDefinition(): string {
    const parts: string[] = [];
    Object.values(this.options.schema).forEach(({ __meta__ }) => {
      parts.push(serializeCreateTable(__meta__));
      if (__meta__.indexes && __meta__.indexes.length > 0) {
        const idxLines = __meta__.indexes.map((idx) => {
          const indexName = idx.name ?? `${__meta__.name}_${idx.columns.join('_')}_idx`;
          const unique = idx.unique ? 'UNIQUE ' : '';
          return `CREATE ${unique}INDEX ${indexName} ON ${__meta__.name}(${idx.columns.join(', ')});`;
        });
        parts.push(idxLines.join('\n'));
      }
    });
    return parts.join('\n\n');
  }
}

function serializeCreateTable(table: TableMetadata): string {
  const columnSql: string[] = [];
  Object.values(table.columns).forEach((c) => {
    const defs: string[] = [c.name, c.type.toUpperCase()];
    if (c.generatedAlwaysAs) {
      defs.push(`GENERATED ALWAYS AS (${c.generatedAlwaysAs})`);
    } else {
      if (c.notNull) defs.push('NOT NULL');
      if (c.primaryKey) defs.push('PRIMARY KEY');
      if (c.unique) defs.push('UNIQUE');
      if (c.default !== undefined && c.default !== null) {
        const val = typeof c.default === 'string' ? `'${c.default}'` : String(c.default);
        defs.push(`DEFAULT ${val}`);
      }
      if (c.foreignKey) {
        const [tableName, colName] = c.foreignKey.split('.');
        defs.push(`REFERENCES ${tableName}(${colName})`);
      }
    }
    columnSql.push(`  ${defs.join(' ')}`);
  });

  return `CREATE TABLE ${table.name} (\n${columnSql.join(',\n')}\n);`;
}
