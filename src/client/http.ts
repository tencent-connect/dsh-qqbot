/** Same-origin JSON requests with bounded waiting and actionable HTTP errors. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function fetchJson<T>(path: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<T> {
  const controller = new AbortController();
  const callerSignal = init.signal;
  let timedOut = false;
  const onCancel = (): void => { controller.abort(callerSignal?.reason); };
  if (callerSignal?.aborted) onCancel();
  else callerSignal?.addEventListener('abort', onCancel, { once: true });
  const timer = setTimeout(() => {
    if (controller.signal.aborted) return;
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    if (controller.signal.aborted) throw new DOMException('请求已取消', 'AbortError');
    const response = await fetch(path, { ...init, signal: controller.signal });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      throw new HttpError(response.status, body?.error ?? `请求失败（HTTP ${response.status}）`);
    }
    return await response.json() as T;
  } catch (error) {
    if (controller.signal.aborted) {
      if (timedOut) throw new Error('请求超时，请重试');
      throw new DOMException('请求已取消', 'AbortError');
    }
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCancel);
  }
}
