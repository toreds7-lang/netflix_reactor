import { defineContentScript } from 'wxt/utils/define-content-script';
import { AppController } from '../../src/app/controller';
import { setController } from '../../src/app/instance';
import { NetflixAdapter } from '../../src/sites/netflix/adapter';
import { mountUi } from '../../src/ui/mount';

function domReady(): Promise<void> {
  if (document.readyState !== 'loading') return Promise.resolve();
  return new Promise((resolve) => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }));
}

export default defineContentScript({
  matches: ['https://www.netflix.com/*'],
  // Start early so our capture-phase key listener is registered before Netflix's own.
  runAt: 'document_start',
  async main() {
    const adapter = new NetflixAdapter();
    const controller = new AppController(adapter);
    setController(controller);
    await controller.init();
    await domReady();
    mountUi(adapter);
  },
});
