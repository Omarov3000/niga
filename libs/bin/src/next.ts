// // --------------------
// // Security Rules API
// // --------------------

// type SecurityRule = (analysis: QueryAnalysis) => boolean;

// declare function accessTheirOwnData(
//   tableName: string,
//   idColumn: string,
//   currentUserId: string
// ): SecurityRule;

// // This should be default rule for all tables
// declare function denyTable(tableName: string): SecurityRule;

// declare function checkRules(
//   sql: SelectSql,
//   rules: SecurityRule[]
// ): boolean;
