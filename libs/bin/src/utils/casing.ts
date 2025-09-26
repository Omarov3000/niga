export function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}

export function toCamelCase(value: string): string {
  return value.replace(/[_-](\w)/g, (_, char: string) => char.toUpperCase());
}

export function camelCaseKeys<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(row)) {
    const camelKey = toCamelCase(key);
    result[camelKey] = val;
  }
  return result;
}
