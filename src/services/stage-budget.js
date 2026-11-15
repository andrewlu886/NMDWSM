// Each sequential stage owns its deadline; caller cancellation still propagates.
async function withStageBudget(work, signal, timeoutMs, message) {
  const controller = new AbortController();
  let timer;
  let abort;
  try {
    const cancelled = new Promise((_, reject) => {
      abort = () => {
        const error = signal?.reason || new Error('請求已取消。');
        reject(error);
        controller.abort(error);
      };
      if (signal?.aborted) return abort();
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => {
        const error = Object.assign(new Error(message), { code: 'STAGE_TIMEOUT' });
        // Settle the deadline first, before a worker's abort handler reports a
        // generic offline error and hides the real cause.
        reject(error);
        controller.abort(error);
      }, timeoutMs);
    });
    return await Promise.race([cancelled, Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return work(controller.signal);
    })]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

module.exports = { withStageBudget };
