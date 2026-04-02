import { describe, expect, it } from "bun:test"

import { translateResponsesToAnthropic } from "~/routes/messages/responses-non-stream-translation"

describe("responses non-stream translation", () => {
  it("maps output_text to Anthropic text block", () => {
    const res = {
      id: "resp_123",
      model: "gpt-5.4",
      output_text: "hi",
      usage: { input_tokens: 3, output_tokens: 2 },
    }

    const out = translateResponsesToAnthropic(res)
    expect(out.type).toBe("message")
    expect(out.role).toBe("assistant")
    expect(out.model).toBe("gpt-5.4")
    expect(out.content).toEqual([{ type: "text", text: "hi" }])
    expect(out.usage.input_tokens).toBe(3)
    expect(out.usage.output_tokens).toBe(2)
  })
})
