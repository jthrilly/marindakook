// Numeric id allocation matches the WordPress export: the next id is one past
// the current maximum. Posts and terms draw from independent id spaces, so they
// are separate functions even though the allocation rule is identical.

export function nextPostId(existing: number[]): number {
  return Math.max(0, ...existing) + 1;
}

export function nextTermId(existing: number[]): number {
  return Math.max(0, ...existing) + 1;
}
