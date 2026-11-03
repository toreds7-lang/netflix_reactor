import { render } from 'preact';
import { PracticePage } from '../../src/pages/practice/PracticePage';
import '../../src/pages/pages.css';

// The ⭐ practice page: saved sentences due for shadowing, read with text-to-speech.
render(<PracticePage />, document.getElementById('app')!);
