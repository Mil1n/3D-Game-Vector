import './styles/main.css';
import { Game } from './core/Game.js';

const canvas = document.querySelector('#game-canvas');
const uiRoot = document.querySelector('#app');

if (!canvas || !uiRoot) {
  throw new Error('[Bootstrap] Required canvas or UI root is missing.');
}

const game = new Game({ canvas, uiRoot });

game.boot().catch((error) => {
  console.error('[Bootstrap] Critical startup failure.', error);
  uiRoot.innerHTML = `
    <main class="fatal-error">
      <p class="eyebrow">КРИТИЧЕСКАЯ ОШИБКА</p>
      <h1>Нулевая решётка не отвечает</h1>
      <p>${String(error?.message ?? error)}</p>
      <button type="button" onclick="location.reload()">Повторить загрузку</button>
    </main>`;
});

window.addEventListener('beforeunload', () => game.dispose(), { once: true });

