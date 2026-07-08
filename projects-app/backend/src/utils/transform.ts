/**
 * Utility functions to transform database results
 * Converts snake_case to camelCase for frontend compatibility
 * 
 * CANONICAL source — all controllers should import from here.
 */

/**
 * Convert snake_case string to camelCase
 */
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert an object's keys from snake_case to camelCase (recursive).
 * Also normalises Date objects and ISO-8601 strings to ISO format.
 */
export function keysToCamel<T = any>(obj: any): T {
  if (obj === null || obj === undefined) return obj as any;
  if (obj instanceof Date) return obj.toISOString() as any;
  if (Array.isArray(obj)) return obj.map(v => keysToCamel(v)) as any;
  if (typeof obj !== 'object') return obj;

  const result: any = {};
  for (const key of Object.keys(obj)) {
    const camelKey = snakeToCamel(key);
    let value = obj[key];

    // Normalise dates to ISO strings for JSON transport
    if (value instanceof Date) {
      value = value.toISOString();
    } else if (
      typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(value)
    ) {
      const d = new Date(value);
      if (!isNaN(d.getTime())) value = d.toISOString();
    }

    result[camelKey] = keysToCamel(value);
  }
  return result;
}

/**
 * Convert camelCase string to snake_case
 */
export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

/**
 * Convert an object's keys from camelCase to snake_case (recursive)
 */
export function keysToSnake<T = any>(obj: any): T {
  if (Array.isArray(obj)) {
    return obj.map(v => keysToSnake(v)) as any;
  } else if (obj !== null && obj !== undefined && obj.constructor === Object) {
    return Object.keys(obj).reduce((result, key) => {
      const snakeKey = camelToSnake(key);
      result[snakeKey] = keysToSnake(obj[key]);
      return result;
    }, {} as any);
  }
  return obj;
}

/**
 * Strip a colon-separated prefix from an ID string.
 * e.g. "project:abc-123" → "abc-123", plain "abc-123" → "abc-123"
 */
export function cleanPrefixedId(id: string): string {
  if (!id) return id;
  return id.includes(':') ? id.split(':').pop()! : id;
}
