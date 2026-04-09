import {
  type AnthropicStreamEventData,
  type AnthropicStreamState,
} from "./anthropic-types"
import { mapResponsesStopReasonToAnthropic } from "./utils"

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
  if (state.contentBlockOpen) {
    if (state.currentContentBlockType === "text") {
      return
    }

    closeContentBlockIfOpen(events, state)
    state.contentBlockIndex++
  }

  events.push({
    type: "content_block_start",
    index: state.contentBlockIndex,
    content_block: {
      type: "text",
      text: "",
    },
  })
  state.contentBlockOpen = true
  state.currentContentBlockType = "text"
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
  state.lastContentBlockType = state.currentContentBlockType
  state.currentContentBlockType = undefined
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

  if (handleFunctionCallArguments(type, ctx)) {
    return events
  }

  if (handleFunctionCallDone(type, { state, events })) {
    return events
  }

  if (handleOutputItemAdded(type, evt, state)) {
    return events
  }

  if (handleOutputItemDone(type, ctx)) {
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

function handleFunctionCallArguments(
  type: string,
  ctx: {
    evt: ResponsesEvent
    state: AnthropicStreamState
    events: Array<AnthropicStreamEventData>
  },
): boolean {
  if (type !== "response.function_call_arguments.delta") {
    return false
  }

  const { evt, state, events } = ctx

  ensureMessageStart(events, state, {
    id: state.responseId,
    model: state.responseModel,
    usage: undefined,
  })

  ensureToolUseBlockOpen(events, state, evt)

  const delta = getString(evt, "delta")
  if (delta) {
    events.push({
      type: "content_block_delta",
      index: state.contentBlockIndex,
      delta: {
        type: "input_json_delta",
        partial_json: delta,
      },
    })
  }

  return true
}

function handleOutputItemAdded(
  type: string,
  evt: ResponsesEvent,
  state: AnthropicStreamState,
): boolean {
  if (type !== "response.output_item.added") {
    return false
  }

  cacheResponseToolCall(evt, state)
  return true
}

function cacheResponseToolCall(
  evt: ResponsesEvent,
  state: AnthropicStreamState,
) {
  const item = (evt as Record<string, unknown>).item
  if (!item || typeof item !== "object") {
    return
  }

  const itemRecord = item as Record<string, unknown>
  if (getString(itemRecord, "type") !== "function_call") {
    return
  }

  const itemId = getString(itemRecord, "id")
  const callId = getString(itemRecord, "call_id")
  const name = getString(itemRecord, "name")
  const outputIndex = getNumber(evt, "output_index")

  if (!callId || !name) {
    return
  }

  const toolCall = {
    id: callId,
    name,
  }

  state.responseToolCalls ??= {}

  if (itemId) {
    state.responseToolCalls[`item:${itemId}`] = toolCall
  }

  if (outputIndex !== undefined) {
    state.responseToolCalls[`output:${outputIndex}`] = toolCall
  }

  state.responseToolCalls[`call:${callId}`] = toolCall
}

function resolveResponseToolCall(
  evt: ResponsesEvent,
  state: AnthropicStreamState,
): { id?: string; name?: string } {
  const item = (evt as Record<string, unknown>).item
  if (item && typeof item === "object") {
    const itemRecord = item as Record<string, unknown>
    const callId = getString(itemRecord, "call_id")
    const name = getString(itemRecord, "name")
    if (callId || name) {
      return {
        id: callId,
        name,
      }
    }
  }

  const responseToolCalls = state.responseToolCalls
  if (!responseToolCalls) {
    return {}
  }

  const itemId = getString(evt, "item_id")
  if (itemId) {
    const cached = responseToolCalls[`item:${itemId}`]
    if (cached) {
      return cached
    }
  }

  const outputIndex = getNumber(evt, "output_index")
  if (outputIndex !== undefined) {
    const cached = responseToolCalls[`output:${outputIndex}`]
    if (cached) {
      return cached
    }
  }

  const callId = getString(evt, "call_id")
  if (callId) {
    const cached = responseToolCalls[`call:${callId}`]
    if (cached) {
      return cached
    }
  }

  return {}
}

function ensureToolUseBlockOpen(
  events: Array<AnthropicStreamEventData>,
  state: AnthropicStreamState,
  evt: ResponsesEvent,
) {
  if (state.contentBlockOpen) {
    if (state.currentContentBlockType === "tool_use") {
      return
    }

    closeContentBlockIfOpen(events, state)
    state.contentBlockIndex++
  }

  const toolCall = resolveResponseToolCall(evt, state)
  const toolCallId = toolCall.id
  const toolName = toolCall.name

  events.push({
    type: "content_block_start",
    index: state.contentBlockIndex,
    content_block: {
      type: "tool_use",
      id: toolCallId || `toolu_${generateId()}`,
      name: toolName || "unknown_tool",
      input: {},
    },
  })
  state.contentBlockOpen = true
  state.currentContentBlockType = "tool_use"

  if (toolCallId) {
    state.responseToolCalls ??= {}
    const cached = state.responseToolCalls[`call:${toolCallId}`]
    if (cached) {
      cached.anthropicBlockIndex = state.contentBlockIndex
    }
  }
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 15)
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

function handleFunctionCallDone(
  type: string,
  ctx: {
    state: AnthropicStreamState
    events: Array<AnthropicStreamEventData>
  },
): boolean {
  if (type !== "response.function_call_arguments.done") return false

  const { state, events } = ctx

  closeContentBlockIfOpen(events, state)
  state.contentBlockIndex++

  return true
}

function handleOutputItemDone(
  type: string,
  ctx: {
    evt: ResponsesEvent
    state: AnthropicStreamState
    events: Array<AnthropicStreamEventData>
  },
): boolean {
  if (type !== "response.output_item.done") {
    return false
  }

  const { evt, state, events } = ctx
  const item = (evt as Record<string, unknown>).item
  if (!item || typeof item !== "object") {
    return false
  }

  const itemRecord = item as Record<string, unknown>
  if (getString(itemRecord, "type") !== "function_call") {
    return false
  }

  ensureMessageStart(events, state, {
    id: state.responseId,
    model: state.responseModel,
    usage: undefined,
  })

  const toolCall = resolveResponseToolCall(evt, state)
  const cachedToolCall =
    toolCall.id ? state.responseToolCalls?.[`call:${toolCall.id}`] : undefined
  const hasMatchingOpenToolBlock =
    state.contentBlockOpen
    && state.currentContentBlockType === "tool_use"
    && cachedToolCall?.anthropicBlockIndex === state.contentBlockIndex

  if (hasMatchingOpenToolBlock) {
    closeContentBlockIfOpen(events, state)
    state.contentBlockIndex++
    return true
  }

  if (cachedToolCall?.anthropicBlockIndex !== undefined) {
    return true
  }

  ensureToolUseBlockOpen(events, state, evt)

  const fullArguments =
    getString(itemRecord, "arguments") ?? getString(itemRecord, "input")
  if (fullArguments) {
    events.push({
      type: "content_block_delta",
      index: state.contentBlockIndex,
      delta: {
        type: "input_json_delta",
        partial_json: fullArguments,
      },
    })
  }

  closeContentBlockIfOpen(events, state)
  state.contentBlockIndex++

  return true
}

function isNoOpLifecycle(type: string): boolean {
  return (
    type === "response.output_text.done"
    || type === "response.content_part.done"
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
    && type !== "response.incomplete"
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

  const stopReasonRaw = extractStopReasonRaw(evt, responseRecord, state)

  const stop_reason = mapResponsesStopReasonToAnthropic(stopReasonRaw)

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

function extractStopReasonRaw(
  evt: ResponsesEvent,
  responseRecord: Record<string, unknown> | undefined,
  state: AnthropicStreamState,
): string | undefined {
  const incompleteDetails = (evt as Record<string, unknown>).incomplete_details
  const responseIncompleteDetails = responseRecord?.incomplete_details

  const explicitReason =
    getString(evt, "stop_reason")
    ?? getString(evt, "finish_reason")
    ?? getString(incompleteDetails, "reason")
    ?? (responseRecord ?
      (getString(responseRecord, "stop_reason")
      ?? getString(responseRecord, "finish_reason")
      ?? getString(responseIncompleteDetails, "reason"))
    : undefined)

  if (explicitReason) {
    return explicitReason
  }

  const blockType = state.currentContentBlockType ?? state.lastContentBlockType
  return blockType === "tool_use" ? "tool_use" : undefined
}

function extractUsage(evt: ResponsesEvent): unknown {
  const usageObj = (evt as Record<string, unknown>).usage
  if (usageObj) return usageObj

  const responseObj = (evt as Record<string, unknown>).response
  if (!responseObj || typeof responseObj !== "object") return undefined

  return (responseObj as Record<string, unknown>).usage
}
