export function formatUrlForLog(raw: string): string {
  let label = "(invalid url)"
  try {
    const u = new URL(raw)
    label = `${u.protocol}//${u.host}`
  } catch {
    /* noop */
  }
  return label
}
