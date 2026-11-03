import { startEmbedder } from '../../src/services/embed';
import { startKokoroReader } from '../../src/services/kokoro';

// Offscreen document (created by the background on demand): reads episode summaries aloud with Kokoro, and runs the
// sentence model for 🔎 same-meaning search.
startKokoroReader();
startEmbedder();
