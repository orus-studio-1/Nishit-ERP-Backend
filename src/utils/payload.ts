export function pickDefined<T extends Record<string, unknown>>(source: T, allowed: readonly string[]) {
  return Object.fromEntries(
    allowed.filter((key) => Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined)
      .map((key) => [key, source[key]]),
  );
}
