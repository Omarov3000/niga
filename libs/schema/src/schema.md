we building a mostly zod compatible schema validation library.

we need to implement standard schema four our validation library:

```ts
** The Standard Schema interface. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  /** The Standard Schema properties. */
  readonly '~standard': StandardSchemaV1.Props<Input, Output>;
}

export declare namespace StandardSchemaV1 {
  /** The Standard Schema properties interface. */
  export interface Props<Input = unknown, Output = Input> {
    /** The version number of the standard. */
    readonly version: 1;
    /** The vendor name of the schema library. */
    readonly vendor: string;
    /** Validates unknown input values. */
    readonly validate: (
      value: unknown
    ) => Result<Output> | Promise<Result<Output>>;
    /** Inferred types associated with the schema. */
    readonly types?: Types<Input, Output> | undefined;
  }

  /** The result interface of the validate function. */
  export type Result<Output> = SuccessResult<Output> | FailureResult;

  /** The result interface if validation succeeds. */
  export interface SuccessResult<Output> {
    /** The typed output value. */
    readonly value: Output;
    /** The non-existent issues. */
    readonly issues?: undefined;
  }

  /** The result interface if validation fails. */
  export interface FailureResult {
    /** The issues of failed validation. */
    readonly issues: ReadonlyArray<Issue>;
  }

  /** The issue interface of the failure output. */
  export interface Issue {
    /** The error message of the issue. */
    readonly message: string;
    /** The path of the issue, if any. */
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }

  /** The path segment interface of the issue. */
  export interface PathSegment {
    /** The key representing a path segment. */
    readonly key: PropertyKey;
  }

  /** The Standard Schema types interface. */
  export interface Types<Input = unknown, Output = Input> {
    /** The input type of the schema. */
    readonly input: Input;
    /** The output type of the schema. */
    readonly output: Output;
  }

  /** Infers the input type of a Standard Schema. */
  export type InferInput<Schema extends StandardSchemaV1> = NonNullable<
    Schema['~standard']['types']
  >['input'];

  /** Infers the output type of a Standard Schema. */
  export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
    Schema['~standard']['types']
  >['output'];
}
```

i already installed this package so you can use it like this:


example from docs:
```ts
import type {StandardSchemaV1} from '@standard-schema/spec';

// Step 1: Define the schema interface
interface StringSchema extends StandardSchemaV1<string> {
  type: 'string';
  message: string;
}

// Step 2: Implement the schema interface
function string(message: string = 'Invalid type'): StringSchema {
  return {
    type: 'string',
    message,
    '~standard': {
      version: 1,
      vendor: 'schema',
      validate(value) {
        return typeof value === 'string' ? {value} : {issues: [{message}]};
      },
    },
  };
}
```

we need the next type validators:

```ts
s.string().max(5);
s.string().min(5);
s.string().length(5);
s.string().regex(/^[a-z]+$/);
s.string().startsWith("aaa");
s.string().endsWith("zzz");
s.string().includes("sad")

s.string().uppercase(); // transform
s.string().lowercase(); // transforms
// validators: email, httpUrl - eg s.string().email()

s.date()     // .min, .max
// it should be able to parse dates as strings: z.date().safeParse("2022-01-12T06:15:00.000Z"); // success: false

s.number()   // .int, .positive, .negative, .gt, .gte (min), .lt, .lte (max)
s.boolean()
s.undefined()
s.null()
s.unknown()

s.literal(value)
s.instanceof(Class)

s.enum([...])
const values = s.enum(['a', 'b', 'c']).options

s.object({ ... }) // .shape, .extend, .pick, .omit, .partial

// self reference
const Category = z.object({
  name: z.string(),
  get subcategories(){
    return z.array(Category)
  }
});

type Category = z.infer<typeof Category>;
// { name: string; subcategories: Category[] }

const Activity = z.object({
  name: z.string(),
  get subactivities(): z.ZodNullable<z.ZodArray<typeof Activity>> { // we should allow manual override when ts fails to infer
    return z.nullable(z.array(Activity));
  },
});

s.record(keySchema, valueSchema)
s.array(schema)

// unions

s.union(schema1, schema2, ...)
// stringOrNumber.options; // [ZodString, ZodNumber]

s.discriminatedUnion(key, [schemas])
```

all validators and constructors should accept options that allow error customization eg: s.string({ message: "should be a string" }).min(1, { message: () => "should not be empty" }) // error is a string or a function that returns a string

usage:

```ts
import { s } from "@w/schema";

const Player = s.object({
  username: s.string(),
  xp: s.number()
});

try {
  Player.parse({ username: 42, xp: "100" });
} catch(error){
  if(error instanceof s.SchemaError){
    error.issues;
    /* [
      {
        expected: 'string',
        code: 'invalid_type',
        path: [ 'username' ],
        message: 'Invalid input: expected string'
      },
      {
        expected: 'number',
        code: 'invalid_type',
        path: [ 'xp' ],
        message: 'Invalid input: expected number'
      }
    ] */
  }
}

const result = Player.safeParse({ username: 42, xp: "100" });
if (!result.success) {
  result.error;   // ZodError instance
} else {
  result.data;    // { username: string; xp: number }
}

type Player = s.infer<typeof Player>;

// to add custom validators add .refine call

const mySchema = s.string().refine((data) => data.length > 0, {
  message: () => 'String must be longer than 0 characters', // can be both string and function returning string
});

// add transformations with .transform call
const mySchema = s.string().transform((val) => val.length);

type MySchemaIn = s.input<typeof mySchema>;
// => string

type MySchemaOut = s.output<typeof mySchema>; // equivalent to z.infer<typeof mySchema>
// number

// To set a default value for a schema:
const mySchema = s.string().default('hello'); // if data is undefined return 'hello'
const numberWithCatch = z.number().catch(42); // if parsing fails return 42

```
