import { Hono } from "hono"
import { cors } from "hono/cors"

import {
  createRequestLogContext,
  formatProxyRouteSummary,
  runWithRequestLogContext,
} from "./lib/request-context"
import { completionRoutes } from "./routes/chat-completions/route"
import { embeddingRoutes } from "./routes/embeddings/route"
import { messageRoutes } from "./routes/messages/route"
import { modelRoutes } from "./routes/models/route"
import { responsesRoutes } from "./routes/responses/route"
import { tokenRoute } from "./routes/token/route"
import { usageRoute } from "./routes/usage/route"

export const server = new Hono()

server.use(async (c, next) => {
  const startedAt = Date.now()
  const requestUrl = new URL(c.req.url)
  const requestPath = `${requestUrl.pathname}${requestUrl.search}`
  const requestContext = createRequestLogContext()

  console.log(`<-- ${c.req.method} ${requestPath}`)

  try {
    await runWithRequestLogContext(requestContext, next)
  } finally {
    const elapsed = Date.now() - startedAt
    const proxySummary = formatProxyRouteSummary(requestContext)
    const duration = formatRequestDuration(elapsed)
    const suffix = proxySummary ? ` | ${proxySummary}` : ""

    console.log(
      `--> ${c.req.method} ${requestPath} ${c.res.status} ${duration}${suffix}`,
    )
  }
})
server.use(cors())

server.get("/", (c) => c.text("Server running"))

server.route("/chat/completions", completionRoutes)
server.route("/models", modelRoutes)
server.route("/embeddings", embeddingRoutes)
server.route("/usage", usageRoute)
server.route("/token", tokenRoute)

// Compatibility with tools that expect v1/ prefix
server.route("/v1/chat/completions", completionRoutes)
server.route("/v1/models", modelRoutes)
server.route("/v1/embeddings", embeddingRoutes)
server.route("/v1/responses", responsesRoutes)

// Anthropic compatible endpoints
server.route("/v1/messages", messageRoutes)

function formatRequestDuration(elapsedMs: number): string {
  return elapsedMs < 1000 ?
      `${elapsedMs}ms`
    : `${Math.round(elapsedMs / 1000)}s`
}
