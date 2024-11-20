export function firstNonNullOrEmpty<T>(obj: T, keys: (keyof T)[]): string | null {
  return obj[
    keys.find((key) => obj[key] !== null && obj[key] !== "") as keyof T
  ] as string | null;
}
