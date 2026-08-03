export class ObjectPool {
  #factory;
  #activate;
  #deactivate;
  #destroy;
  #available = [];
  #active = new Set();
  #all = new Set();
  #created = 0;
  #reused = 0;

  constructor(factoryOrOptions, reset, initialSize = 0) {
    const options = typeof factoryOrOptions === 'function'
      ? { factory: factoryOrOptions, deactivate: reset, initialSize }
      : (factoryOrOptions ?? {});

    if (typeof options.factory !== 'function') throw new TypeError('ObjectPool requires a factory function');
    this.#factory = options.factory;
    this.#activate = typeof options.activate === 'function' ? options.activate : null;
    this.#deactivate = typeof options.deactivate === 'function'
      ? options.deactivate
      : (typeof options.reset === 'function' ? options.reset : null);
    this.#destroy = typeof options.destroy === 'function' ? options.destroy : null;
    this.maxSize = Number.isFinite(options.maxSize) ? Math.max(0, Math.floor(options.maxSize)) : Infinity;
    this.name = options.name ?? 'ObjectPool';
    this.warm(options.initialSize ?? 0);
  }

  acquire(...args) {
    let object = this.#available.pop();
    if (object === undefined) {
      if (this.#all.size >= this.maxSize) return null;
      object = this.#create();
    } else {
      this.#reused += 1;
    }
    this.#active.add(object);
    try {
      if (this.#activate) this.#activate(object, ...args);
    } catch (error) {
      this.#active.delete(object);
      this.#available.push(object);
      throw error;
    }
    return object;
  }

  get(...args) {
    return this.acquire(...args);
  }

  release(object) {
    if (!this.#active.has(object)) return false;
    this.#active.delete(object);
    try {
      if (this.#deactivate) this.#deactivate(object);
    } finally {
      this.#available.push(object);
    }
    return true;
  }

  releaseAll() {
    for (const object of [...this.#active]) this.release(object);
  }

  warm(count) {
    const target = Math.max(0, Math.floor(Number(count) || 0));
    const amount = Math.min(target, Math.max(0, this.maxSize - this.#all.size));
    for (let index = 0; index < amount; index += 1) {
      this.#available.push(this.#create());
    }
    return this.#all.size;
  }

  dispose() {
    if (this.#destroy) {
      for (const object of this.#all) this.#destroy(object);
    }
    this.#active.clear();
    this.#available.length = 0;
    this.#all.clear();
  }

  forEachActive(callback) {
    if (typeof callback !== 'function') throw new TypeError('callback must be a function');
    this.#active.forEach(callback);
  }

  get activeCount() {
    return this.#active.size;
  }

  get inactiveCount() {
    return this.#available.length;
  }

  get size() {
    return this.#all.size;
  }

  get stats() {
    return Object.freeze({
      name: this.name,
      size: this.size,
      active: this.activeCount,
      available: this.inactiveCount,
      created: this.#created,
      reused: this.#reused,
      maxSize: this.maxSize,
    });
  }

  #create() {
    const object = this.#factory(this.#created);
    if ((typeof object !== 'object' && typeof object !== 'function') || object === null) {
      throw new TypeError(`${this.name} factory must return an object`);
    }
    this.#created += 1;
    this.#all.add(object);
    return object;
  }
}

export default ObjectPool;
