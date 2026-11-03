import { settings, videoId } from '../app/state';
import { Help, Toast } from './App';
import { Sidebar } from './Sidebar';
import { WordPopup } from './WordPopup';

/** What the floating window shows: the whole sidebar, with its own word popup, shortcut list and toasts. */
export function FloatApp() {
  if (!settings.value.enabled) {
    return (
      <>
        <div class="float-empty">Polyglot Player is off.</div>
        <Toast />
      </>
    );
  }
  if (!videoId.value) return <div class="float-empty">Start an episode on Netflix and its subtitles show up here.</div>;
  return (
    <>
      <Sidebar floating />
      <WordPopup where="float" />
      <Help />
      <Toast />
    </>
  );
}
