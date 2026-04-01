import {
  type AnthropicStreamEventData,
  type AnthropicStreamState,
} from "./anthropic-types"

type ResponsesEvent = Record<string, unknown>

function getString(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined
  const v = (obj as Record<string, unknown>)[key]
  return typeof v === "string" ? v : undefined
}

function getNumber(obj: unknown, key: string): number | undefined {
  if (!obj || typeof obj !== "object") return undefined
  const v = (obj as Record<string, unknown>)[key]
  return typeof v === "number" ? v : undefined
}

function getUsage(obj: unknown): {
  input_tokens: number
  output_tokens: number
} {
  if (!obj || typeof obj !== "object")
    return { input_tokens: 0, output_tokens: 0 }
  return {
    input_tokens:
      getNumber(obj, "input_tokens") ?? getNumber(obj, "prompt_tokens") ?? 0,
    output_tokens:
      getNumber(obj, "output_tokens")
      ?? getNumber(obj, "completion_tokens")
      ?? 0,
  }
}

function ensureMessageStart(
  events: Array<AnthropicStreamEventData>,
  state: AnthropicStreamState,
  meta: { id?: string; model?: string; usage?: { input_tokens: number } },
) {
  if (state.messageStartSent) return
  events.push({
    type: "message_start",
    message: {
      id: meta.id ?? "",
      type: "message",
      role: "assistant",
      content: [],
      model: meta.model ?? "",
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: meta.usage?.input_tokens ?? 0,
        output_tokens: 0,
      },
    },
  })
  state.messageStartSent = true
}

function ensureTextBlockOpen(
  events: Array<AnthropicStreamEventData>,
  state: AnthropicStreamState,
) {
  if (state.contentBlockOpen) return
  events.push({
    type: "content_block_start",
    index: state.contentBlockIndex,
    content_block: {
      type: "text",
      text: "",
    },
  })
  state.contentBlockOpen = true
}

function closeContentBlockIfOpen(
  events: Array<AnthropicStreamEventData>,
  state: AnthropicStreamState,
) {
  if (!state.contentBlockOpen) return
  events.push({
    type: "content_block_stop",
    index: state.contentBlockIndex,
  })
  state.contentBlockOpen = false
}

function extractFromResponse(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined
  return getString(obj as Record<string, unknown>, key)
}

export function translateResponsesEventToAnthropicEvents(
  evt: ResponsesEvent,
  state: AnthropicStreamState,
): Array<AnthropicStreamEventData> {
  const events: Array<AnthropicStreamEventData> = []

  const type = getString(evt, "type")
  if (!type) return events

  if (handleResponseCreated(type, evt, state)) {
    return events
  }

  const ctx = { evt, state, events }

  if (handleResponseInProgress(type, ctx)) {
    return events
  }

  if (handleOutputText(type, ctx)) {
    return events
  }

  if (handleContentPart(type, ctx)) {
    return events
  }

  if (isNoOpLifecycle(type)) {
    return events
  }

  if (handleResponseCompleted(type, ctx)) {
    return events
  }

  return events
}

function handleResponseCreated(
  type: string,
  evt: ResponsesEvent,
  state: AnthropicStreamState,
): boolean {
  if (type !== "response.created") return false

  const responseObj = (evt as Record<string, unknown>).response
  if (responseObj && typeof responseObj === "object") {
    const responseRecord = responseObj as Record<string, unknown>
    state.responseId = extractFromResponse(responseRecord, "id")
    state.responseModel = extractFromResponse(responseRecord, "model")
  }

  return true
}

function handleResponseInProgress(
  type: string,
  ctx: {
    evt: ResponsesEvent
    state: AnthropicStreamState
    events: Array<AnthropicStreamEventData>
  },
): boolean {
  if (type !== "response.in_progress") return false

  const { evt, state, events } = ctx

  const responseObj = (evt as Record<string, unknown>).response
  const usage =
    responseObj && typeof responseObj === "object" ?
      (responseObj as Record<string, unknown>).usage
    : undefined

  const inputTokens =
    usage && typeof usage === "object" ?
      (getNumber(usage, "input_tokens") ?? 0)
    : 0

  ensureMessageStart(events, state, {
    id: state.responseId,
    model: state.responseModel,
    usage: { input_tokens: inputTokens },
  })

  return true
}

function handleOutputText(
  type: string,
  ctx: {
    evt: ResponsesEvent
    state: AnthropicStreamState
    events: Array<AnthropicStreamEventData>
  },
): boolean {
  if (
    type !== "response.output_text.delta"
    && type !== "response.output_text"
    && type !== "response.output_text.update"
  ) {
    return false
  }

  const { evt, state, events } = ctx

  ensureMessageStart(events, state, {
    id: state.responseId,
    model: state.responseModel,
    usage: undefined,
  })

  ensureTextBlockOpen(events, state)

  const data = (evt as Record<string, unknown>).data
  const delta =
    getString(evt, "delta")
    ?? getString(evt, "text")
    ?? getString(data, "delta")
    ?? getString(data, "text")

  if (delta) {
    events.push({
      type: "content_block_delta",
      index: state.contentBlockIndex,
      delta: {
        type: "text_delta",
        text: delta,
      },
    })
  }

  return true
}

function handleContentPart(
  type: string,
  ctx: {
    state: AnthropicStreamState
    events: Array<AnthropicStreamEventData>
  },
): boolean {
  if (type !== "response.content_part.added") return false

  const { state, events } = ctx

  ensureMessageStart(events, state, {
    id: state.responseId,
    model: state.responseModel,
    usage: undefined,
  })
  ensureTextBlockOpen(events, state)
  return true
}

function isNoOpLifecycle(type: string): boolean {
  return (
    type === "response.output_text.done"
    || type === "response.content_part.done"
    || type === "response.output_item.added"
    || type === "response.output_item.done"
  )
}

function handleResponseCompleted(
  type: string,
  ctx: {
    evt: ResponsesEvent
    state: AnthropicStreamState
    events: Array<AnthropicStreamEventData>
  },
): boolean {
  if (
    type !== "response.completed"
    && type !== "response.complete"
    && type !== "response.done"
    && type !== "response.completed.final"
  ) {
    return false
  }

  const { evt, state, events } = ctx

  closeContentBlockIfOpen(events, state)

  const usage = getUsage(extractUsage(evt))

  const responseObj = (evt as Record<string, unknown>).response
  const responseRecord: Record<string, unknown> | undefined =
    responseObj && typeof responseObj === "object" ?
      (responseObj as Record<string, unknown>)
    : undefined

  const stopReasonRaw =
    getString(evt, "stop_reason")
    ?? getString(evt, "finish_reason")
    ?? (responseRecord ?
      (getString(responseRecord, "stop_reason")
      ?? getString(responseRecord, "finish_reason"))
    : undefined)

  const stop_reason = stopReasonRaw === "length" ? "max_tokens" : "end_turn"

  events.push(
    {
      type: "message_delta",
      delta: {
        stop_reason,
        stop_sequence: null,
      },
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
      },
    },
    {
      type: "message_stop",
    },
  )

  return true
}

function extractUsage(evt: ResponsesEvent): unknown {
  const usageObj = (evt as Record<string, unknown>).usage
  if (usageObj) return usageObj

  const responseObj = (evt as Record<string, unknown>).response
  if (!responseObj || typeof responseObj !== "object") return undefined

  return (responseObj as Record<string, unknown>).usage
}
