/* eslint-disable max-lines-per-function */
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
    responseToolCalls: {},
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

  it("maps tool-use stop reason from responses payload", () => {
    const res = {
      id: "resp_tool_123",
      model: "gpt-5.4",
      output: [],
      stop_reason: "tool_use",
      usage: { input_tokens: 3, output_tokens: 0 },
    }

    const out = translateResponsesToAnthropic(res)
    expect(out.stop_reason).toBe("tool_use")
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

  it("preserves tool name from response.output_item.added for function deltas", () => {
    const state = createStreamState()
    state.responseId = "resp_abc123"
    state.responseModel = "gpt-5.4"

    const addedEvents = translateResponsesEventToAnthropicEvents(
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "function_call",
          id: "fc_123",
          call_id: "call_123",
          name: "grep_search",
        },
      },
      state,
    )

    expect(addedEvents).toEqual([])

    const events = translateResponsesEventToAnthropicEvents(
      {
        type: "response.function_call_arguments.delta",
        item_id: "fc_123",
        output_index: 0,
        delta: '{"pattern":"proxy"}',
      },
      state,
    )

    expect(events).toHaveLength(3)
    expect(events[1]).toMatchObject({
      type: "content_block_start",
      content_block: {
        type: "tool_use",
        id: "call_123",
        name: "grep_search",
      },
    })
    expect(events[2]).toMatchObject({
      type: "content_block_delta",
      delta: {
        type: "input_json_delta",
        partial_json: '{"pattern":"proxy"}',
      },
    })
  })

  it("closes a text block before opening a tool_use block", () => {
    const state = createStreamState()
    state.responseId = "resp_abc123"
    state.responseModel = "gpt-5.4"

    const textEvents = translateResponsesEventToAnthropicEvents(
      {
        type: "response.output_text.delta",
        delta: "Let me check that.",
      },
      state,
    )

    expect(textEvents).toMatchObject([
      { type: "message_start" },
      { type: "content_block_start", index: 0 },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Let me check that." },
      },
    ])

    translateResponsesEventToAnthropicEvents(
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "function_call",
          id: "fc_123",
          call_id: "call_123",
          name: "lookup_status",
        },
      },
      state,
    )

    const toolEvents = translateResponsesEventToAnthropicEvents(
      {
        type: "response.function_call_arguments.delta",
        item_id: "fc_123",
        output_index: 0,
        delta: '{"ticket_id":"ABC-123"}',
      },
      state,
    )

    expect(toolEvents).toMatchObject([
      { type: "content_block_stop", index: 0 },
      {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "call_123",
          name: "lookup_status",
        },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: {
          type: "input_json_delta",
          partial_json: '{"ticket_id":"ABC-123"}',
        },
      },
    ])
  })

  it("closes an open tool_use block when output_item.done arrives without arguments.done", () => {
    const state = createStreamState()
    state.responseId = "resp_abc123"
    state.responseModel = "gpt-5.4"

    translateResponsesEventToAnthropicEvents(
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "function_call",
          id: "fc_123",
          call_id: "call_123",
          name: "lookup_status",
        },
      },
      state,
    )

    const deltaEvents = translateResponsesEventToAnthropicEvents(
      {
        type: "response.function_call_arguments.delta",
        item_id: "fc_123",
        output_index: 0,
        delta: '{"ticket_id":"ABC-123"}',
      },
      state,
    )

    expect(deltaEvents).toHaveLength(3)

    const doneEvents = translateResponsesEventToAnthropicEvents(
      {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "function_call",
          id: "fc_123",
          call_id: "call_123",
          name: "lookup_status",
          arguments: '{"ticket_id":"ABC-123"}',
        },
      },
      state,
    )

    expect(doneEvents).toMatchObject([
      {
        type: "content_block_stop",
        index: 0,
      },
    ])
  })

  it("emits a closed tool_use sequence from output_item.done and response.incomplete", () => {
    const state = createStreamState()
    state.responseId = "resp_abc123"
    state.responseModel = "gpt-5.4"

    translateResponsesEventToAnthropicEvents(
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "function_call",
          id: "fc_123",
          call_id: "call_123",
          name: "lookup_status",
        },
      },
      state,
    )

    const doneEvents = translateResponsesEventToAnthropicEvents(
      {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "function_call",
          id: "fc_123",
          call_id: "call_123",
          name: "lookup_status",
          arguments: '{"ticket_id":"ABC-123"}',
        },
      },
      state,
    )

    expect(doneEvents).toMatchObject([
      {
        type: "message_start",
      },
      {
        type: "content_block_start",
        content_block: {
          type: "tool_use",
          id: "call_123",
          name: "lookup_status",
        },
      },
      {
        type: "content_block_delta",
        delta: {
          type: "input_json_delta",
          partial_json: '{"ticket_id":"ABC-123"}',
        },
      },
      {
        type: "content_block_stop",
      },
    ])

    const incompleteEvents = translateResponsesEventToAnthropicEvents(
      {
        type: "response.incomplete",
        response: {
          usage: { input_tokens: 12, output_tokens: 7 },
        },
      },
      state,
    )

    expect(incompleteEvents).toMatchObject([
      {
        type: "message_delta",
        delta: {
          stop_reason: "tool_use",
          stop_sequence: null,
        },
        usage: {
          input_tokens: 12,
          output_tokens: 7,
        },
      },
      {
        type: "message_stop",
      },
    ])
  })
})
