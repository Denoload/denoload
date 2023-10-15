// Copyright 2018-2023 the Deno authors. All rights reserved. MIT license.
import { format } from './_format.ts'
import { AssertionError } from './assertion_error.ts'

/**
 * Make an assertion that `actual` is less than or equal to `expected`.
 * If not then throw.
 */
export function assertLessOrEqual<T> (actual: T, expected: T, msg?: string) {
  if (actual <= expected) return

  const actualString = format(actual)
  const expectedString = format(expected)
  throw new AssertionError(
    msg ?? `Expect ${actualString} <= ${expectedString}`
  )
}
