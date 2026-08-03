/**
 * Small synchronous event bus used to keep game systems independent.
 * Listener failures are isolated so a cosmetic system cannot stop gameplay.
 */
export class EventBus {
  #events = new Map();
  #onError;

  constructor({ onError } = {}) {
    this.#onError = typeof onError === 'function' ? onError : null;
  }

  on(event, listener, options = {}) {
    this.#assertEvent(event);
    if (typeof listener !== 'function') {
      throw new TypeError('EventBus listener must be a function');
    }

    const record = {
      listener,
      once: options.once === true,
      priority: Number.isFinite(options.priority) ? options.priority : 0,
      abortHandler: null,
      signal: options.signal ?? null,
    };

    if (record.signal?.aborted) return () => false;

    const listeners = this.#events.get(event) ?? [];
    listeners.push(record);
    listeners.sort((a, b) => b.priority - a.priority);
    this.#events.set(event, listeners);

    const unsubscribe = () => this.#removeRecord(event, record);
    if (record.signal) {
      record.abortHandler = unsubscribe;
      record.signal.addEventListener('abort', record.abortHandler, { once: true });
    }
    return unsubscribe;
  }

  once(event, listener, options = {}) {
    return this.on(event, listener, { ...options, once: true });
  }

  off(event, listener) {
    this.#assertEvent(event);
    const listeners = this.#events.get(event);
    if (!listeners) return false;

    if (listener === undefined) {
      for (const record of listeners) this.#detachAbort(record);
      this.#events.delete(event);
      return true;
    }
    if (typeof listener !== 'function') {
      throw new TypeError('EventBus listener must be a function');
    }

    let removed = false;
    for (const record of [...listeners]) {
      if (record.listener === listener) {
        removed = this.#removeRecord(event, record) || removed;
      }
    }
    return removed;
  }

  emit(event, ...args) {
    this.#assertEvent(event);
    const snapshot = [...(this.#events.get(event) ?? [])];
    let invoked = 0;

    for (const record of snapshot) {
      const current = this.#events.get(event);
      if (!current?.includes(record)) continue;
      if (record.once) this.#removeRecord(event, record);

      try {
        record.listener(...args);
      } catch (error) {
        this.#reportError(error, event, record.listener);
      }
      invoked += 1;
    }
    return invoked;
  }

  clear(event) {
    if (event !== undefined) return this.off(event);
    for (const listeners of this.#events.values()) {
      for (const record of listeners) this.#detachAbort(record);
    }
    const hadListeners = this.#events.size > 0;
    this.#events.clear();
    return hadListeners;
  }

  listenerCount(event) {
    this.#assertEvent(event);
    return this.#events.get(event)?.length ?? 0;
  }

  eventNames() {
    return [...this.#events.keys()];
  }

  dispose() {
    this.clear();
  }

  #removeRecord(event, record) {
    const listeners = this.#events.get(event);
    if (!listeners) return false;
    const index = listeners.indexOf(record);
    if (index < 0) return false;
    listeners.splice(index, 1);
    this.#detachAbort(record);
    if (listeners.length === 0) this.#events.delete(event);
    return true;
  }

  #detachAbort(record) {
    if (record.signal && record.abortHandler) {
      record.signal.removeEventListener('abort', record.abortHandler);
      record.abortHandler = null;
    }
  }

  #reportError(error, event, listener) {
    if (this.#onError) {
      this.#onError(error, { event, listener });
      return;
    }
    console.error(`[EventBus] Listener for "${String(event)}" failed`, error);
  }

  #assertEvent(event) {
    if ((typeof event !== 'string' || event.length === 0) && typeof event !== 'symbol') {
      throw new TypeError('EventBus event must be a non-empty string or symbol');
    }
  }
}

export default EventBus;
