import type { AppController } from './controller';

let current: AppController | null = null;

export function setController(c: AppController): void {
  current = c;
}

/** The running controller; UI components call into it for actions. */
export function ctl(): AppController {
  if (!current) throw new Error('Polyglot Player controller not initialised');
  return current;
}
