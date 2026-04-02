import { describe, it, expect } from "vitest"

import { formatUrlForLog } from "~/lib/url"

describe("formatUrlForLog", () => {
  it("returns protocol//host without credentials", () => {
    const out = formatUrlForLog(
      "http://user:pass@proxy.example.com:8000/path?a=1",
    )
    expect(out).toBe("http://proxy.example.com:8000")
  })

  it("returns (invalid url) for invalid input", () => {
    const out = formatUrlForLog("not a url")
    expect(out).toBe("(invalid url)")
  })
})
