import { describe, expect, it } from "vitest"

import {
  createRequestLogContext,
  formatProxyRouteSummary,
  recordProxyRoute,
  runWithRequestLogContext,
} from "~/lib/request-context"

describe("request log context", () => {
  it("collects proxy routes within a request context", async () => {
    const context = createRequestLogContext()

    await runWithRequestLogContext(context, async () => {
      await Promise.resolve()
      recordProxyRoute("api.github.com", "https://proxy.example:8080")
      recordProxyRoute("api.githubcopilot.com", "https://proxy.example:8080")
    })

    expect(formatProxyRouteSummary(context)).toBe(
      "api.github.com -> https://proxy.example:8080, api.githubcopilot.com -> https://proxy.example:8080",
    )
  })

  it("keeps the latest route per hostname", async () => {
    const context = createRequestLogContext()

    await runWithRequestLogContext(context, async () => {
      await Promise.resolve()
      recordProxyRoute("api.github.com", "direct")
      recordProxyRoute("api.github.com", "https://proxy.example:8080")
    })

    expect(formatProxyRouteSummary(context)).toBe(
      "api.github.com -> https://proxy.example:8080",
    )
  })
})
