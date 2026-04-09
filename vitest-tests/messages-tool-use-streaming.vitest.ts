/* eslint-disable max-lines-per-function */
import { afterEach, describe, expect, it, vi } from "vitest"

import { state } from "~/lib/state"

type ModelsLike = {
  data: Array<{
    id: string
    supported_endpoints: Array<string>
  }>
}

vi.mock("fetch-event-stream", () => {
  return {
    events: async function* () {
      await Promise.resolve()

      yield {
        event: "response.created",
        data: JSON.stringify({
          type: "response.created",
          response: {
            id: "resp_tool_123",
            model: "gpt-5.4-2026-03-05",
          },
        }),
      }
      yield {
        event: "response.in_progress",
        data: JSON.stringify({
          type: "response.in_progress",
          response: {
            usage: { input_tokens: 12 },
          },
        }),
      }
      yield {
        event: "response.output_item.added",
        data: JSON.stringify({
          type: "response.output_item.added",
          output_index: 0,
          item: {
            type: "function_call",
            id: "fc_123",
            call_id: "call_123",
            name: "lookup_status",
          },
        }),
      }
      yield {
        event: "response.output_item.done",
        data: JSON.stringify({
          type: "response.output_item.done",
          output_index: 0,
          item: {
            type: "function_call",
            id: "fc_123",
            call_id: "call_123",
            name: "lookup_status",
            arguments: '{"ticket_id":"ABC-123"}',
          },
        }),
      }
      yield {
        event: "response.incomplete",
        data: JSON.stringify({
          type: "response.incomplete",
          response: {
            usage: {
              input_tokens: 12,
              output_tokens: 7,
            },
          },
        }),
      }
    },
  }
})

const importServer = async () => {
  const mod = await import("~/server")
  return mod.server
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("/v1/messages tool-use streaming", () => {
  it("emits a closed Anthropic tool_use SSE sequence on the /responses path", async () => {
    state.copilotToken = "test-token"
    state.models = {
      data: [
        {
          id: "gpt-5.4",
          supported_endpoints: ["/responses"],
        },
      ],
    } satisfies ModelsLike as unknown as typeof state.models

    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (url.endsWith("/responses")) {
        return Promise.resolve(
          new Response("event: response.created\ndata: {}\n\n", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        )
      }

      return Promise.reject(new Error(`unexpected url: ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch)

    const server = await importServer()

    const res = await server.request("/v1/messages?beta=true", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        max_tokens: 128,
        stream: true,
        tool_choice: { type: "tool", name: "lookup_status" },
        tools: [
          {
            name: "lookup_status",
            description: "Look up a status string by ticket id",
            input_schema: {
              type: "object",
              properties: {
                ticket_id: { type: "string" },
              },
              required: ["ticket_id"],
              additionalProperties: false,
            },
          },
        ],
        messages: [
          {
            role: "user",
            content:
              "Use the lookup_status tool for ticket ABC-123 and do not answer directly.",
          },
        ],
      }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type") || "").toContain("text/event-stream")

    const responsesCall = fetchMock.mock.calls.find((call) =>
      call[0].endsWith("/responses"),
    )
    expect(responsesCall).toBeDefined()
    const requestInit = responsesCall?.[1]
    expect(typeof requestInit?.body).toBe("string")
    const requestBody = JSON.parse(requestInit?.body as string) as Record<
      string,
      unknown
    >
    expect(requestBody.tool_choice).toEqual({
      type: "function",
      name: "lookup_status",
    })

    const sseText = await res.text()
    const dataPayloads = sseText
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>)

    expect(dataPayloads.map((event) => event.type)).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ])

    expect(dataPayloads[1]).toMatchObject({
      type: "content_block_start",
      content_block: {
        type: "tool_use",
        id: "call_123",
        name: "lookup_status",
        input: {},
      },
    })

    expect(dataPayloads[2]).toMatchObject({
      type: "content_block_delta",
      delta: {
        type: "input_json_delta",
        partial_json: '{"ticket_id":"ABC-123"}',
      },
    })
    expect(dataPayloads[3]).toMatchObject({
      type: "content_block_stop",
      index: 0,
    })
    expect(dataPayloads[4]).toMatchObject({
      type: "message_delta",
      delta: {
        stop_reason: "tool_use",
        stop_sequence: null,
      },
      usage: {
        input_tokens: 12,
        output_tokens: 7,
      },
    })
    expect(dataPayloads[5]).toMatchObject({
      type: "message_stop",
    })
  })
})
