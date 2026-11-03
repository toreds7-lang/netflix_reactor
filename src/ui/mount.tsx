import { render } from 'preact';
import { ctl } from '../app/instance';
import { windowWidth } from '../app/state';
import type { SiteAdapter } from '../sites/adapter';
import { App } from './App';
import { FloatApp } from './Float';
import css from './theme.css?inline';

/**
 * Mount the UI inside a shadow root so Netflix's CSS can't touch it (and vice versa).
 * The host follows the fullscreen element, otherwise it would be hidden in fullscreen.
 */
export function mountUi(adapter: SiteAdapter): void {
  const host = document.createElement('polyglot-player');
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483000; pointer-events: none;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  const root = document.createElement('div');
  root.className = 'plg-root';
  shadow.append(style, root);

  const place = () => {
    const target = adapter.getMountPoint();
    if (host.parentElement !== target) target.appendChild(host);
  };
  place();
  document.addEventListener('fullscreenchange', place);
  // The sidebar never leaves the video less than its minimum width, however narrow the window gets.
  const measure = () => (windowWidth.value = window.innerWidth);
  measure();
  window.addEventListener('resize', measure);
  // Netflix occasionally re-renders large parts of the page; make sure we stay attached.
  setInterval(place, 1000);

  render(<App />, root);
  // The floating sidebar window gets the same stylesheet and draws from the same state.
  ctl().setFloatUi({ css, render: (r) => render(<FloatApp />, r), unmount: (r) => render(null, r) });
}
