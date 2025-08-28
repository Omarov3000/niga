export type SelectSql = { query: string; params: any[] }; // we get this as input

export function sql(strings: TemplateStringsArray, ...values: any[]): SelectSql {
  let query = "";
  const params: any[] = [];

  strings.forEach((part, i) => {
    query += part;
    if (i < values.length) {
      query += "?"; // use ? as placeholder
      params.push(values[i]);
    }
  });

  return { query, params };
}
