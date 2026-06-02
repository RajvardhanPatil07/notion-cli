export function sortDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sortDeep(item)) as T;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const key of Object.keys(input).sort()) {
    const child = input[key];
    if (child !== undefined) {
      output[key] = sortDeep(child);
    }
  }

  return output as T;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

export function deepEqual(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

export function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  const output: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) {
      output[key] = child;
    }
  }

  return output as T;
}
