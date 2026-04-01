import { describe, expect, it } from "vitest"

import type { AnthropicStreamState } from "~/routes/messages/anthropic-types"

import { translateResponsesToAnthropic } from "~/routes/messages/responses-non-stream-translation"
import { translateResponsesEventToAnthropicEvents } from "~/routes/messages/responses-stream-translation"

function createStreamState(): AnthropicStreamState {
  return {
    messageStartSent: false,
    contentBlockIndex: 0,
    contentBlockOpen: false,
    toolCalls: {},
  }
}

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

describe("responses stream translation", () => {
  it("extracts id and model from response.created", () => {
    const state = createStreamState()
    const evt = {
      type: "response.created",
      response: {
        id: "resp_abc123",
        model: "gpt-5.4-2026-03-05",
      },
    }

    const events = translateResponsesEventToAnthropicEvents(evt, state)
    expect(events).toHaveLength(0)
    expect(state.responseId).toBe("resp_abc123")
    expect(state.responseModel).toBe("gpt-5.4-2026-03-05")
  })

  it("emits message_start on response.in_progress with saved metadata", () => {
    const state = createStreamState()
    state.responseId = "resp_abc123"
    state.responseModel = "gpt-5.4-2026-03-05"

    const evt = {
      type: "response.in_progress",
      response: {
        usage: { input_tokens: 10 },
      },
    }

    const events = translateResponsesEventToAnthropicEvents(evt, state)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "message_start",
      message: {
        id: "resp_abc123",
        model: "gpt-5.4-2026-03-05",
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    })
    expect(state.messageStartSent).toBe(true)
  })

  it("emits text_delta for response.output_text.delta", () => {
    const state = createStreamState()
    state.responseId = "resp_abc123"
    state.responseModel = "gpt-5.4"
    state.messageStartSent = true

    const evt = {
      type: "response.output_text.delta",
      delta: "Hello",
    }

    const events = translateResponsesEventToAnthropicEvents(evt, state)
    expect(events).toHaveLength(2) // content_block_start + content_block_delta
    expect(events[1]).toMatchObject({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hello" },
    })
    expect(state.contentBlockOpen).toBe(true)
  })

  it("emits message_stop on response.completed", () => {
    const state = createStreamState()
    state.responseId = "resp_abc123"
    state.messageStartSent = true
    state.contentBlockOpen = true

    const evt = {
      type: "response.completed",
      response: {
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      },
    }

    const events = translateResponsesEventToAnthropicEvents(evt, state)
    expect(events).toHaveLength(3) // content_block_stop + message_delta + message_stop
    expect(events[0].type).toBe("content_block_stop")
    expect(events[1]).toMatchObject({
      type: "message_delta",
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    expect(events[2].type).toBe("message_stop")
  })

  it("handles stop_reason length as max_tokens", () => {
    const state = createStreamState()
    state.messageStartSent = true
    state.contentBlockOpen = true

    const evt = {
      type: "response.completed",
      response: {
        stop_reason: "length",
        usage: { input_tokens: 10, output_tokens: 50 },
      },
    }

    const events = translateResponsesEventToAnthropicEvents(evt, state)
    const messageDelta = events.find((e) => e.type === "message_delta")
    expect(messageDelta).toMatchObject({
      delta: { stop_reason: "max_tokens" },
    })
  })
})
