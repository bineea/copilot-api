import { type AnthropicResponse } from "./anthropic-types"

export function mapOpenAIStopReasonToAnthropic(
  finishReason: "stop" | "length" | "tool_calls" | "content_filter" | null,
): AnthropicResponse["stop_reason"] {
  if (finishReason === null) {
    return null
  }
  const stopReasonMap = {
    stop: "end_turn",
    length: "max_tokens",
    tool_calls: "tool_use",
    content_filter: "end_turn",
  } as const
  return stopReasonMap[finishReason]
}

export function mapResponsesStopReasonToAnthropic(
  stopReason: string | undefined,
): AnthropicResponse["stop_reason"] {
  switch (stopReason) {
    case undefined:
    case "stop":
    case "end_turn": {
      return "end_turn"
    }
    case "length": {
      return "max_tokens"
    }
    case "max_output_tokens":
    case "max_tokens": {
      return "max_tokens"
    }
    case "tool_use":
    case "tool_calls":
    case "function_call": {
      return "tool_use"
    }
    case "stop_sequence": {
      return "stop_sequence"
    }
    case "pause_turn": {
      return "pause_turn"
    }
    case "refusal": {
      return "refusal"
    }
    default: {
      return "end_turn"
    }
  }
}
