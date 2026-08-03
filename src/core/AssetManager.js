import { EventBus } from './EventBus.js';

const isDescriptor = (value) => value && typeof value === 'object' && !Array.isArray(value);

export class AssetManager {
  #registry = new Map();
  #assets = new Map();
  #pending = new Map();
  #errors = new Map();
  #objectUrls = new Set();

  constructor(options = {}) {
    if (options && typeof options.emit === 'function') options = { eventBus: options };
    this.eventBus = options.eventBus ?? new EventBus();
    this.fetch = options.fetch ?? globalThis.fetch?.bind(globalThis) ?? null;
    this.concurrency = Math.max(1, Math.floor(Number(options.concurrency) || 4));
  }

  register(id, source, options = {}) {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError('Asset id must be a non-empty string');
    if (this.#registry.has(id) && options.replace !== true) throw new Error(`Asset is already registered: ${id}`);

    let descriptor;
    if (typeof source === 'function') descriptor = { ...options, loader: source };
    else if (typeof source === 'string') descriptor = { ...options, url: source };
    else if (isDescriptor(source)) descriptor = { ...source, ...options };
    else throw new TypeError(`Asset ${id} requires a loader, URL, or descriptor`);

    if (typeof descriptor.loader !== 'function' && typeof descriptor.url !== 'string' && !Object.hasOwn(descriptor, 'fallback')) {
      throw new TypeError(`Asset ${id} has no loader, URL, or fallback`);
    }
    descriptor.id = id;
    descriptor.type ??= this.#inferType(descriptor.url);
    descriptor.required = descriptor.required === true;
    this.#registry.set(id, descriptor);
    if (options.replace === true) {
      this.unload(id);
      this.#errors.delete(id);
    }
    return this;
  }

  registerAll(entries) {
    if (entries instanceof Map) {
      for (const [id, source] of entries) this.register(id, source);
    } else {
      for (const [id, source] of Object.entries(entries ?? {})) this.register(id, source);
    }
    return this;
  }

  async load(id, { signal, force = false } = {}) {
    const descriptor = this.#registry.get(id);
    if (!descriptor) throw new RangeError(`Unknown asset: ${id}`);
    if (!force && this.#assets.has(id)) return this.#assets.get(id);
    if (!force && this.#pending.has(id)) return this.#pending.get(id);
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');

    const promise = this.#loadDescriptor(descriptor, signal)
      .then((asset) => {
        if (asset === undefined) throw new Error(`Loader returned undefined for ${id}`);
        this.#assets.set(id, asset);
        this.#errors.delete(id);
        this.eventBus.emit('asset:loaded', { id, asset, fallback: false });
        return asset;
      })
      .catch(async (error) => {
        this.#errors.set(id, error);
        this.eventBus.emit('asset:error', { id, error, descriptor: { ...descriptor } });
        if (!Object.hasOwn(descriptor, 'fallback')) throw error;
        try {
          const fallback = typeof descriptor.fallback === 'function'
            ? await descriptor.fallback({ id, error, manager: this, signal })
            : descriptor.fallback;
          if (fallback === undefined) throw new Error(`Fallback returned undefined for ${id}`, { cause: error });
          this.#assets.set(id, fallback);
          this.#errors.delete(id);
          this.eventBus.emit('asset:loaded', { id, asset: fallback, fallback: true, error });
          return fallback;
        } catch (fallbackError) {
          this.#errors.set(id, fallbackError);
          throw fallbackError;
        }
      })
      .finally(() => this.#pending.delete(id));
    this.#pending.set(id, promise);
    return promise;
  }

  async loadAll(options = {}) {
    const ids = options.ids ? [...options.ids] : [...this.#registry.keys()];
    const total = ids.length;
    let loaded = 0;
    let failed = 0;
    const failures = [];
    const results = new Map();
    let cursor = 0;
    const concurrency = Math.min(total || 1, Math.max(1, Math.floor(options.concurrency ?? this.concurrency)));

    const worker = async () => {
      while (cursor < ids.length) {
        const index = cursor;
        cursor += 1;
        const id = ids[index];
        try {
          const asset = await this.load(id, { signal: options.signal, force: options.force });
          results.set(id, asset);
          loaded += 1;
          this.#emitProgress({ id, loaded, failed, total, status: 'loaded' });
        } catch (error) {
          failed += 1;
          failures.push({ id, error });
          this.#emitProgress({ id, loaded, failed, total, status: 'failed', error });
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));

    const summary = { assets: results, loaded, failed, total, failures };
    this.eventBus.emit('assets:complete', summary);
    if (options.strict === true && failures.length > 0) {
      throw new AggregateError(failures.map(({ error }) => error), `Failed to load ${failures.length} asset(s)`);
    }
    return summary;
  }

  get(id, fallback) {
    if (this.#assets.has(id)) return this.#assets.get(id);
    return fallback;
  }

  require(id) {
    if (!this.#assets.has(id)) throw new Error(`Asset is not loaded: ${id}`);
    return this.#assets.get(id);
  }

  has(id) {
    return this.#assets.has(id);
  }

  isRegistered(id) {
    return this.#registry.has(id);
  }

  getError(id) {
    return this.#errors.get(id) ?? null;
  }

  get progress() {
    const total = this.#registry.size;
    const loaded = this.#assets.size;
    const failed = this.#errors.size;
    return Object.freeze({ loaded, failed, total, ratio: total === 0 ? 1 : loaded / total });
  }

  unload(id) {
    const asset = this.#assets.get(id);
    if (!this.#assets.delete(id)) return false;
    this.#disposeAsset(asset);
    this.eventBus.emit('asset:unloaded', { id });
    return true;
  }

  clear({ unregister = false } = {}) {
    for (const id of [...this.#assets.keys()]) this.unload(id);
    this.#errors.clear();
    if (unregister) this.#registry.clear();
  }

  dispose() {
    this.clear({ unregister: true });
    for (const url of this.#objectUrls) globalThis.URL?.revokeObjectURL?.(url);
    this.#objectUrls.clear();
  }

  async #loadDescriptor(descriptor, signal) {
    if (typeof descriptor.loader === 'function') {
      return descriptor.loader({
        id: descriptor.id,
        url: descriptor.url,
        type: descriptor.type,
        signal,
        manager: this,
      });
    }
    if (typeof descriptor.url !== 'string') return descriptor.fallback;
    if (!this.fetch) throw new Error(`Fetch API is unavailable for ${descriptor.id}`);

    const response = await this.fetch(descriptor.url, { signal });
    if (!response.ok) throw new Error(`Failed to load ${descriptor.id}: HTTP ${response.status}`);
    switch (descriptor.type) {
      case 'json': return response.json();
      case 'text': return response.text();
      case 'arrayBuffer':
      case 'audio': return response.arrayBuffer();
      case 'blob': return response.blob();
      case 'image': return this.#loadImage(await response.blob());
      default: return response.blob();
    }
  }

  async #loadImage(blob) {
    if (globalThis.createImageBitmap) return globalThis.createImageBitmap(blob);
    if (!globalThis.Image || !globalThis.URL?.createObjectURL) return blob;
    const url = globalThis.URL.createObjectURL(blob);
    this.#objectUrls.add(url);
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Image decode failed'));
      image.src = url;
    });
  }

  #inferType(url = '') {
    const extension = String(url).split(/[?#]/)[0].split('.').at(-1)?.toLowerCase();
    if (extension === 'json') return 'json';
    if (['txt', 'glsl', 'vert', 'frag'].includes(extension)) return 'text';
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'].includes(extension)) return 'image';
    if (['mp3', 'ogg', 'wav', 'm4a'].includes(extension)) return 'audio';
    if (['bin', 'glb'].includes(extension)) return 'arrayBuffer';
    return 'blob';
  }

  #emitProgress(detail) {
    const progress = {
      ...detail,
      completed: detail.loaded + detail.failed,
      ratio: detail.total === 0 ? 1 : (detail.loaded + detail.failed) / detail.total,
    };
    this.eventBus.emit('assets:progress', progress);
    this.eventBus.emit('asset:progress', progress);
  }

  #disposeAsset(asset) {
    if (!asset) return;
    if (typeof asset.dispose === 'function') asset.dispose();
    else if (typeof asset.close === 'function') asset.close();
  }
}

export default AssetManager;
