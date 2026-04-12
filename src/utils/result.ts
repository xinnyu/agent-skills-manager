import type { Result } from "../types";

/** Create a successful Result */
export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

/** Create a failed Result */
export function err<T>(error: string): Result<T> {
  return { ok: false, error };
}
