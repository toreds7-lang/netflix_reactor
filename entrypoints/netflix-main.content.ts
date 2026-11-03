import { defineContentScript } from 'wxt/utils/define-content-script';
import { installNetflixHooks } from '../src/sites/netflix/main-world';

export default defineContentScript({
  matches: ['https://www.netflix.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    installNetflixHooks();
  },
});
