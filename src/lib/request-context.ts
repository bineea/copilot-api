import { AsyncLocalStorage } from "node:async_hooks"

export interface RequestLogContext {
  proxyRoutes: Map<string, string>
}

const requestContextStorage = new AsyncLocalStorage<RequestLogContext>()

export function createRequestLogContext(): RequestLogContext {
  return {
    proxyRoutes: new Map(),
  }
}

export async function runWithRequestLogContext<T>(
  context: RequestLogContext,
  fn: () => Promise<T>,
): Promise<T> {
  return requestContextStorage.run(context, fn)
}

export function recordProxyRoute(hostname: string, route: string): void {
  requestContextStorage.getStore()?.proxyRoutes.set(hostname, route)
}

export function formatProxyRouteSummary(context: RequestLogContext): string {
  return [...context.proxyRoutes.entries()]
    .map(([hostname, route]) => `${hostname} -> ${route}`)
    .join(", ")
}
