/**
 * Joins CSS-module class names, dropping anything falsy.
 *
 * `*.module.css` is typed as an index signature, so with `noUncheckedIndexedAccess` every
 * lookup is `string | undefined`; this is the one place that is handled. It lives beside the
 * primitives rather than in `lib/` because only the ui/ layer composes class names.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ');
}
