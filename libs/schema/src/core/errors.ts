import * as util from "./util";

// Issue types
export type IssueCode =
  | "invalid_type"
  | "invalid_literal"
  | "invalid_enum_value"
  | "invalid_string"
  | "invalid_format"
  | "too_small"
  | "too_big"
  | "custom";

export interface BaseIssue {
  code: IssueCode;
  message: string;
  path?: ReadonlyArray<PropertyKey>;
  input?: unknown;
}

export interface InvalidTypeIssue extends BaseIssue {
  code: "invalid_type";
  expected: string;
  received?: string;
}

export interface InvalidLiteralIssue extends BaseIssue {
  code: "invalid_literal";
  expected: util.Literal;
}

export interface InvalidEnumValueIssue extends BaseIssue {
  code: "invalid_enum_value";
  options: readonly any[];
}

export interface InvalidStringIssue extends BaseIssue {
  code: "invalid_string";
  validation: "email" | "url" | "regex" | "startsWith" | "endsWith" | "includes";
  pattern?: string;
}

export interface InvalidFormatIssue extends BaseIssue {
  code: "invalid_format";
  format: string;
}

export interface TooSmallIssue extends BaseIssue {
  code: "too_small";
  minimum: number;
  inclusive: boolean;
  type: "string" | "number" | "array" | "date";
}

export interface TooBigIssue extends BaseIssue {
  code: "too_big";
  maximum: number;
  inclusive: boolean;
  type: "string" | "number" | "array" | "date";
}

export interface CustomIssue extends BaseIssue {
  code: "custom";
}

export type Issue =
  | InvalidTypeIssue
  | InvalidLiteralIssue
  | InvalidEnumValueIssue
  | InvalidStringIssue
  | InvalidFormatIssue
  | TooSmallIssue
  | TooBigIssue
  | CustomIssue;

// Internal raw issue (before message formatting)
export interface RawIssue {
  code: IssueCode;
  path?: PropertyKey[];
  input?: unknown;
  inst?: any;
  continue?: boolean;
  [key: string]: any;
}

// Error map for customizing messages
export type ErrorMap = (issue: RawIssue, ctx: { defaultError: string }) => { message: string };

// Default error messages
export const defaultErrorMap: ErrorMap = (issue, ctx) => {
  let message = ctx.defaultError;

  switch (issue.code) {
    case "invalid_type":
      message = `Invalid input: expected ${issue.expected}`;
      if (issue.received) {
        message += `, received ${issue.received}`;
      }
      break;
    case "invalid_literal":
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected)}`;
      break;
    case "invalid_enum_value":
      message = `Invalid enum value. Expected ${issue.options?.map((v: any) => JSON.stringify(v)).join(" | ")}`;
      break;
    case "invalid_string":
      if (issue.validation === "email") {
        message = "Invalid email";
      } else if (issue.validation === "url") {
        message = "Invalid url";
      } else if (issue.validation === "regex") {
        message = `Invalid string pattern`;
      } else if (issue.validation === "startsWith") {
        message = `String must start with "${issue.value}"`;
      } else if (issue.validation === "endsWith") {
        message = `String must end with "${issue.value}"`;
      } else if (issue.validation === "includes") {
        message = `String must include "${issue.value}"`;
      }
      break;
    case "too_small":
      if (issue.type === "string") {
        message = `String must contain ${issue.inclusive ? "at least" : "more than"} ${issue.minimum} character(s)`;
      } else if (issue.type === "number") {
        message = `Number must be ${issue.inclusive ? "greater than or equal to" : "greater than"} ${issue.minimum}`;
      } else if (issue.type === "array") {
        message = `Array must contain ${issue.inclusive ? "at least" : "more than"} ${issue.minimum} element(s)`;
      } else if (issue.type === "date") {
        message = `Date must be ${issue.inclusive ? "greater than or equal to" : "greater than"} ${new Date(issue.minimum)}`;
      }
      break;
    case "too_big":
      if (issue.type === "string") {
        message = `String must contain ${issue.inclusive ? "at most" : "less than"} ${issue.maximum} character(s)`;
      } else if (issue.type === "number") {
        message = `Number must be ${issue.inclusive ? "less than or equal to" : "less than"} ${issue.maximum}`;
      } else if (issue.type === "array") {
        message = `Array must contain ${issue.inclusive ? "at most" : "less than"} ${issue.maximum} element(s)`;
      } else if (issue.type === "date") {
        message = `Date must be ${issue.inclusive ? "less than or equal to" : "less than"} ${new Date(issue.maximum)}`;
      }
      break;
    case "custom":
      message = issue.message || ctx.defaultError;
      break;
  }

  return { message };
};

// Format a raw issue into a final issue
export function formatIssue(raw: RawIssue, errorMap: ErrorMap = defaultErrorMap): Issue {
  const formatted = errorMap(raw, { defaultError: "Invalid input" });
  const { code, path, input, inst, continue: _, ...rest } = raw;
  return {
    code,
    message: formatted.message,
    path,
    input,
    ...rest,
  } as Issue;
}

// SchemaError class
export class SchemaError extends Error {
  issues: Issue[];

  constructor(issues: RawIssue[], errorMap?: ErrorMap) {
    const formatted = issues.map((i) => formatIssue(i, errorMap));
    super(JSON.stringify(formatted, util.jsonStringifyReplacer, 2));
    this.name = "SchemaError";
    this.issues = formatted;
  }
}
