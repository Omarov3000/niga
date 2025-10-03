// This file provides global type declarations needed when TypeScript compiles
// frontend packages (query-fe) that are imported by this universal package.
//
// The ORM package imports types from query-fe (UseQueryOptions, UseMutationOptions)
// which causes TypeScript to check query-fe files during compilation. Since query-fe
// uses browser globals like `window`, we need to declare them here to prevent
// type errors during the ORM's type checking.
//
// Note: This is a workaround. Ideally, shared types should be extracted to a
// separate package (e.g., @w/query-types) to avoid this cross-dependency issue but
// we want to have as few packages as possible and as simple dependencies between them as possible.

declare var window: any;
