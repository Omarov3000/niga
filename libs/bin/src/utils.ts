export type Expect<T extends true> = T;
export type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
export type ShallowPrettify<T> = { [K in keyof T]: T[K] } & {}

import { O } from 'ts-toolbelt';

export type DiffAb<
  A extends Record<string, any>,
  B extends Record<string, any>,
> = {
  ab: O.Diff<A, B, 'equals'>
  ba: O.Diff<B, A, 'equals'>
}
