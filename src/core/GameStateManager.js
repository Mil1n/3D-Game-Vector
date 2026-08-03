import { EventBus } from './EventBus.js';

export const GAME_STATES = Object.freeze({
  BOOT: 'Boot',
  LOADING: 'Loading',
  MAIN_MENU: 'MainMenu',
  TUTORIAL: 'Tutorial',
  PLAYING: 'Playing',
  PAUSED: 'Paused',
  UPGRADE_SELECTION: 'UpgradeSelection',
  VICTORY: 'Victory',
  DEFEAT: 'Defeat',
});

const S = GAME_STATES;

export const STATE_TRANSITIONS = Object.freeze({
  [S.BOOT]: Object.freeze([S.LOADING]),
  [S.LOADING]: Object.freeze([S.MAIN_MENU]),
  [S.MAIN_MENU]: Object.freeze([S.TUTORIAL, S.PLAYING, S.LOADING]),
  [S.TUTORIAL]: Object.freeze([
    S.PLAYING,
    S.PAUSED,
    S.UPGRADE_SELECTION,
    S.VICTORY,
    S.DEFEAT,
    S.MAIN_MENU,
  ]),
  [S.PLAYING]: Object.freeze([
    S.PAUSED,
    S.UPGRADE_SELECTION,
    S.VICTORY,
    S.DEFEAT,
    S.MAIN_MENU,
  ]),
  [S.PAUSED]: Object.freeze([S.TUTORIAL, S.PLAYING, S.UPGRADE_SELECTION, S.MAIN_MENU]),
  [S.UPGRADE_SELECTION]: Object.freeze([S.TUTORIAL, S.PLAYING, S.PAUSED, S.VICTORY, S.DEFEAT, S.MAIN_MENU]),
  [S.VICTORY]: Object.freeze([S.MAIN_MENU, S.PLAYING]),
  [S.DEFEAT]: Object.freeze([S.MAIN_MENU, S.PLAYING]),
});

const VALID_STATES = new Set(Object.values(GAME_STATES));

export class GameStateManager {
  #state;
  #previousState = null;
  #resumeState = null;
  #transitioning = false;
  #history = [];
  #hooks = new Map();

  constructor(eventBusOrOptions = {}, initialState) {
    const isBus = eventBusOrOptions && typeof eventBusOrOptions.emit === 'function';
    const options = isBus
      ? { eventBus: eventBusOrOptions, initialState }
      : (eventBusOrOptions ?? {});

    this.eventBus = options.eventBus ?? new EventBus();
    this.#state = options.initialState ?? GAME_STATES.BOOT;
    this.#assertState(this.#state);
    this.#history.push({ from: null, to: this.#state, at: Date.now(), context: null });
  }

  get state() {
    return this.#state;
  }

  get currentState() {
    return this.#state;
  }

  get previousState() {
    return this.#previousState;
  }

  get isTransitioning() {
    return this.#transitioning;
  }

  is(state) {
    return this.#state === state;
  }

  canTransition(nextState) {
    if (!VALID_STATES.has(nextState) || nextState === this.#state) return false;
    return STATE_TRANSITIONS[this.#state].includes(nextState);
  }

  transition(nextState, context = {}) {
    this.#assertState(nextState);
    if (this.#transitioning) {
      throw new Error(`Cannot transition to ${nextState} while another transition is active`);
    }
    if (nextState === this.#state) return false;
    if (!this.canTransition(nextState)) {
      throw new Error(`Invalid game-state transition: ${this.#state} -> ${nextState}`);
    }

    const from = this.#state;
    const transition = Object.freeze({ from, to: nextState, context, at: Date.now() });
    this.#transitioning = true;
    try {
      this.eventBus.emit('state:before-change', transition);
      this.#runHooks(from, 'exit', transition);
      this.#previousState = from;
      this.#state = nextState;
      if (nextState === GAME_STATES.PAUSED) this.#resumeState = from;
      if (from === GAME_STATES.PAUSED && nextState !== GAME_STATES.PAUSED) this.#resumeState = null;
      this.#history.push(transition);
      if (this.#history.length > 64) this.#history.shift();
      this.#runHooks(nextState, 'enter', transition);
      this.eventBus.emit('state:change', transition);
      this.eventBus.emit('state:changed', transition);
      return true;
    } finally {
      this.#transitioning = false;
    }
  }

  setState(nextState, context = {}) {
    return this.transition(nextState, context);
  }

  transitionTo(nextState, context = {}) {
    return this.transition(nextState, context);
  }

  getState() {
    return this.#state;
  }

  pause(context = {}) {
    if (![GAME_STATES.PLAYING, GAME_STATES.TUTORIAL, GAME_STATES.UPGRADE_SELECTION].includes(this.#state)) {
      return false;
    }
    return this.transition(GAME_STATES.PAUSED, { reason: 'pause', ...context });
  }

  resume(context = {}) {
    if (this.#state !== GAME_STATES.PAUSED || !this.#resumeState) return false;
    return this.transition(this.#resumeState, { reason: 'resume', ...context });
  }

  reset(context = {}) {
    if (this.#state === GAME_STATES.BOOT) return false;
    const from = this.#state;
    const transition = Object.freeze({ from, to: GAME_STATES.BOOT, context, at: Date.now(), forced: true });
    this.#runHooks(from, 'exit', transition);
    this.#previousState = from;
    this.#state = GAME_STATES.BOOT;
    this.#resumeState = null;
    this.#history.push(transition);
    this.#runHooks(GAME_STATES.BOOT, 'enter', transition);
    this.eventBus.emit('state:change', transition);
    this.eventBus.emit('state:changed', transition);
    return true;
  }

  registerHooks(state, { enter, exit } = {}) {
    this.#assertState(state);
    if (enter !== undefined && typeof enter !== 'function') throw new TypeError('enter hook must be a function');
    if (exit !== undefined && typeof exit !== 'function') throw new TypeError('exit hook must be a function');
    this.#hooks.set(state, { enter, exit });
    return () => this.#hooks.delete(state);
  }

  getHistory() {
    return this.#history.map((entry) => ({ ...entry }));
  }

  #runHooks(state, kind, transition) {
    const hook = this.#hooks.get(state)?.[kind];
    if (hook) hook(transition);
  }

  #assertState(state) {
    if (!VALID_STATES.has(state)) {
      throw new RangeError(`Unknown game state: ${String(state)}`);
    }
  }
}

export default GameStateManager;
