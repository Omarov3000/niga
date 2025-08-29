import type { BinDriver, TableMetadata } from './types';
import type { ZodTypeAny } from 'zod';
import { sql } from './utils/sql';
import type { Table } from './table';
import { rawQueryToSelectQuery } from './security/rawQueryToSelectQuery';

export interface DbConstructorOptions {
  schema: Record<string, { __meta__: TableMetadata }>;
}

export class Db {
  private driver?: BinDriver;

  constructor(private options: DbConstructorOptions) {
    // expose tables on the db instance and wire driver access for table methods
    Object.entries(this.options.schema).forEach(([name, table]) => {
      (this as any)[name] = table;
      // attach driver getter to table for methods like insert()
      (table as any).__db__ = {
        getDriver: () => {
          if (!this.driver) throw new Error('No driver connected. Call _connectDriver first.');
          return this.driver;
        },
      };
    });
  }

  async _connectDriver(driver: BinDriver): Promise<void> {
    this.driver = driver;
  }

  query(strings: TemplateStringsArray, ...values: any[]) {
    const { query, params } = sql(strings, ...values);
    const ensureDriver = () => {
      if (!this.driver) throw new Error('No driver connected. Call _connectDriver first.');
      return this.driver;
    };

    return {
      execute: async <T extends ZodTypeAny>(zodSchema: T) => {
        const driver = ensureDriver();
        // Parse for security analysis but use raw SQL for execution
        rawQueryToSelectQuery({ query, params }); // Security analysis
        const rows = await Promise.resolve(driver.run({ query, params }));
        return zodSchema.array().parse(rows) as ReturnType<T['array']>['_output'];
      },
      executeAndTakeFirst: async <T extends ZodTypeAny>(zodSchema: T) => {
        const driver = ensureDriver();
        // Parse for security analysis but use raw SQL for execution
        rawQueryToSelectQuery({ query, params }); // Security analysis
        const rows = await Promise.resolve(driver.run({ query, params }));
        if (!rows || rows.length === 0) throw new Error('No rows returned');
        return zodSchema.parse(rows[0]) as ReturnType<T['parse']>;
      },
    };
  }

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
