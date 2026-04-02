import consola from "consola"

export function applyVerboseLogging(verbose: boolean): void {
  if (!verbose) return
  consola.level = 5
  consola.info("Verbose logging enabled")
}
