# Polyglot Player for Netflix

A Chrome extension (Manifest V3) for learning languages with Netflix, modeled on Language Reactor:

- **Dual subtitles.** The language you pick in Netflix's subtitle menu is the main line. A translation line sits below it: Netflix's own human subtitles when they exist in your language, otherwise Google machine translation. When Netflix's subtitles are Off, the main line is the language you're learning. If Netflix hasn't sent those subtitles yet, the extension turns them on in Netflix's menu (as Language Reactor does). It never uses Netflix's "forced" track, which has only on-screen text and a few hard-to-hear lines.
- **Transcript sidebar.** Every line with its translation. The current line is highlighted and auto-scrolled, and clicking a line jumps to it. The menu above the list (subtitle track, translation, toggles, Key lines) starts folded into one bar that shows what's on and keeps speed and size at hand; click it or press **C** to open it.
- **Sidebar on your second monitor.** Click **⧉** in the sidebar or press **P**. The whole sidebar moves into its own window, which opens fullscreen on the monitor without Netflix, and Netflix gets its full width. When the window is wide, the line being played sits large on the left, with its translation and the lines before and after it. Below it are a seek bar and play controls (previous / repeat / play-pause / next line, previous / next key line, speed, Netflix fullscreen). The menu, tabs and transcript are in a column on the right. **⇄** or **O** swaps the two sides, and you can drag the line between them to resize them. All shortcuts work there too.
- **Playback control.** Auto-pause after each line, pause while hovering the subtitles, speed 0.5–1.5×, and keyboard shortcuts. The **↺** right of the line on the video replays that line, like **S**. Shift+click it to loop the line, and Shift+click again to stop. The **↺ on video** chip hides it. If a line stops before its last words, press **X** to hear the rest. If its first words are missing, press **Z** to start it earlier. **M** and **N** do the same as X and Z. The extension remembers both for that line.
- **Word lookup.** Click a word, or drag across words for a phrase, to get a Google dictionary entry, text-to-speech, and Save as *Learning* or *Known*.
- **Claude explanations** (optional, with your own API key). Explains what a word means *in this exact line* (lemma, reading, grammar, examples) and breaks down whole lines.
- **Key lines** (optional; uses Claude Code with your Claude subscription, or OpenAI). Picks the 10%, 20% or 30% of sentences that are best for **🎤 shadowing** and the ones you need to follow the **📖 story**. You can mark them in the sidebar and on screen, show only those lines, pause after each shadowing sentence (**Shadow mode**), or play only the story sentences (**Skip mode**). **J** / **L** jump to the previous / next key line; **K**, between them, repeats the line like **S**.
- **Episode summary** (optional; same provider and level as Key lines). The sidebar's **Summary** tab writes an overview, a who's-who list and 3–12 scenes in the language you're learning, pitched to your CEFR level. Each scene shows its time range and 1–3 quoted lines it is based on. Click a scene or a quote to play it, so you can check the summary against what is actually said. The scene you are watching is highlighted.
- **💬 Chat about the episode** (optional; same provider as Key lines). The sidebar's **💬 Chat** tab answers questions about what is said and what happens: what a line means here, slang and grammar, who someone is. Write in Korean or in the language you're learning; the answer comes in the same language, pitched to your level. Every line an answer talks about is a **▶ 12:34** button that plays it. Quick buttons ask the usual questions (💡 Explain this line, 🎬 What just happened?, 🗣 Useful phrases, 📖 Hard words, ❓ Quiz me, 👥 Who's who). Answers appear as they are written, and 🔊 reads one aloud. Each episode keeps its own chat. Press **Y** to type a question from anywhere.
- **Summary read aloud.** 🔊 reads the whole summary, the overview, who's who or a single scene, and highlights each sentence as it is spoken. English summaries use **Kokoro** (American English, female voice, run on your computer); other languages use the browser's voice for that language.
- **Bookmarks.** Press **B** (or click 🔖 on a line in the sidebar) to bookmark the line you are on, one per episode. The extension also remembers the last line you played. When you reopen the episode, a **Continue** banner takes you back to that exact sentence, and the toolbar popup lists the episodes you can continue.
- **Loop lines.** Press **R** on the first line and again on the last line to repeat that stretch until you press R or Esc. You can also click 🔁 on two lines in the sidebar, or Shift+click a line to loop from the one playing now. Options: play 2×, 3× or 5× and then go on; **🗣 Gap**, a pause after each pass as long as the pass, so you can say it back; **🙈 Hide text**, which blurs the subtitles from the second pass on (hover to peek). **💾** saves a loop to the **Loops** tab so you can practise it again later.
- **⭐ Saved sentences for shadowing.** Press **G** (or click ☆ next to a line) to save the sentence you're on, for practice later. A sentence split over two subtitle lines is saved whole, and you can loop any lines and click ☆ in the loop bar to save exactly those. Each saved sentence comes back on a spaced-repetition schedule. You practise it with a **drill**: listen with the text hidden, shadow it (speak along) reading the text, then shadow it from memory, and then rate how well you could say it.
  - **On Netflix**, with the original voice, in the sidebar's **⭐ Sentences** tab. When you open an episode and sentences are due, a **warm-up** banner offers to practise them first. **Practise due** opens other episodes as needed.
  - **On the practice page**, with text-to-speech and no Netflix needed.
  - The toolbar icon shows how many sentences are due.
  - Backup files are written by themselves, so reinstalling the extension can't lose your sentences.
- **🔎 Find in my shows.** Every episode you open is saved to a library on your computer, so you can find lines across all the shows you watched, to hear them with the real voice and shadow them.
  - **A word in all its forms**: "go" also finds went, gone and going. Spoken forms count as the same: gonna = going to, wanna = want to.
  - **A phrase**, or **a pattern** like `I can't * believe`, where `*` stands for up to 3 words.
  - **A Korean line**, to see how it was said in English.
  - **Lines like the one you are on** (**I**, or 🔎 on a line): its chunks found in other episodes, such as "you're gonna have to · 14 episodes".
  - **Lines with the same meaning** in other words, from a small free model on your computer.
  - Found lines play one by one (**▶ Play all**) or shadowed with a pause after each pass (**🗣 Shadow all**), and ☆ saves one to ⭐ Sentences.
- **Saved words.** Words you are learning are highlighted in every title. You can export to CSV, back up and restore as JSON (saved sentences, key lines and summaries included), or send words to **Anki** through AnkiConnect.
- **On / off switch.** The big ⏻ button at the top of the toolbar popup, or **Alt+L** on Netflix, turns the whole extension off. Netflix then plays as if it weren't installed: its own subtitles and layout come back, playback returns to normal speed, the floating window closes, and no subtitles are downloaded or translated. Turning it on picks the episode up again without a reload.
- **CJK support.** Word segmentation uses the browser's built-in `Intl.Segmenter`. You also get furigana from Netflix's IMSC subtitles, pinyin (from `pinyin-pro`), and romanization for non-Latin scripts.

## Install (development build)

```bash
npm install
npm run build        # outputs .output/chrome-mv3
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose `.output/chrome-mv3`.
3. Open (or **reload**) a Netflix tab and start a title.

`npm run dev` starts WXT in watch mode and opens a Chrome window with the extension loaded. `npm run zip` creates a store-ready zip.

## Using it

| Key | Action |
|---|---|
| A / S / D | Previous line / repeat line / next line |
| J / K / L | Previous key line / repeat line (like S) / next key line. Key lines are 🎤, 📖 or both, as chosen in the Key lines bar; hold J or L to keep going |
| X or M / Shift+X or M | Line cut off at the end: play a bit more of it and remember that / take some off |
| Z or N / Shift+Z or N | Line's first words missing: start it earlier and remember that / start it later |
| B | Bookmark the current line (press again to remove) |
| G | Save the sentence you're on to ⭐ Sentences |
| I | 🔎 Find lines like the one you're on in your shows: its chunks, and lines with the same meaning |
| Y | 💬 Open the chat and type a question about the episode (Enter sends, Shift+Enter is a new line, Esc leaves the box) |
| 1 – 4 | After a ⭐ practice drill: rate it Again / Hard / Good / Easy (Esc leaves it unrated) |
| R | Loop lines: press on the first line, then on the last line; again to stop |
| Q | Toggle auto-pause |
| W | Toggle translation blur |
| H | Blur every line on the video (learning language and translation) until hovered. Hovering the translation shows the line above it too. Also blurs the big line in the floating window; the sidebar list stays readable |
| V (hold) | Show every blurred line on the video and in the floating window's big line while you hold it |
| U | Show the line you are on (learning language and translation), on the video and in the big line, although blurred; press again to blur it. The next line is blurred again, whether it plays on by itself or you go there with A / D / J / L |
| E | Toggle sidebar |
| C | Fold / unfold the sidebar menu |
| P | Move the sidebar to its own window on your other monitor / put it back |
| O | Floating window: swap the big line and the list (left / right) |
| T | Show / hide subtitles |
| [ / ] / \\ | Slower / faster / normal speed |
| ? | Shortcut help |
| Esc | Close popup, stop the loop |
| Alt+L | Turn the whole extension on / off |

Shortcuts match physical keys, so they work on any keyboard layout. You can rebind them in **Options → Shortcuts**.

- **Claude:** open **Options → Claude**, paste an API key, and pick a model. Claude Opus 5.5 is the default; Sonnet 5 and Haiku 4.5 are cheaper. The key is kept only in local extension storage. With Opus 5.5 or Opus 5, a refused request is retried automatically on a fallback model through the API's `fallbacks` option.
- **Key lines:** set **your level** (CEFR A1–C2) and the provider in **Options → Key lines**, then click **✨ Find key lines** in the sidebar. The 🎤 picks are pitched just above your level: short, simple sentences at A1–A2, longer and more idiomatic ones at C1–C2.
  - **Claude Code (default, uses your Claude subscription, no API key).** Install [Claude Code](https://code.claude.com) with the native installer, run `claude` once and sign in with `/login`. Then run `npm run claude:install -- <extension id>` in this folder; Options → Key lines shows the command with your ID and a **Test** button. This registers `native-host/claude-code-host.mjs` as a Chrome native messaging host, so Chrome starts it on demand and no terminal has to stay open. Pick Opus 5.5 (default), Sonnet 5.5 or Haiku 4.5. Each run counts toward your plan's usage limits; a full episode takes about 10 seconds on Opus 5.5. The helper runs `claude -p` with no tools, MCP servers or settings, from an empty folder, and ignores `ANTHROPIC_API_KEY`, so it never bills the API. Run `npm run claude:install` again if you move Node or Claude Code, and `npm run claude:uninstall` to remove it.
  - **OpenAI.** Put `OPENAI_API_KEY=…` and optionally `LLM_MODEL=gpt-4o-mini` in `.env`, then run `npm run build`. Both values are baked into the background script at build time, so **never share `.output/` or a zip built with your key**. With gpt-4o-mini a run costs about $0.002 per episode.
  - The whole episode is sent once. The request contains sentence text only, with no timestamps, and the reply contains sentence numbers only.
  - One reply covers both lists and all three levels, so changing 10/20/30% or the view is free.
  - Results are saved per episode, model and level, so reopening an episode costs nothing. See **Saved results** below.
  - In Shadow mode, **S** replays the whole sentence.
  - **J** / **L** go to the previous / next line marked in the list chosen with **Both / 🎤 Shadowing / 📖 Story**, at the current 10/20/30%: like A / D, but only to marked lines. A key sentence split over two subtitle lines is two stops, as the list marks both. In Shadow mode, **S** or **K** replays the whole sentence. The same **‹ ›** buttons are next to the sentence count in the Key lines bar, in the floating window's play bar, and beside the line on the video (‹ left of the line, › right of the ↺). The **↺ on video** chip hides the ones on the video.
- **Summary:** click **✨ Summarize episode** in the Summary tab. It uses the Key lines provider, model and level, and sends the same numbered sentences once. The model returns the first sentence of each scene and the sentence numbers of its evidence. The extension turns these into time ranges and drops evidence outside its scene, so every quote can be traced to a real line (`src/core/summary.ts`). Results are saved per episode, model and level. A 57-line test took about 10 seconds on Opus 5.5 (medium effort).
- **Saved results** (key lines and summaries):
  - Each episode keeps one result per subtitle language, model and level, and opening the episode shows it for free.
  - After you change the model or level, or a prompt update, the episode shows its newest earlier result with a note saying so. **✨ Update** makes a new one with your current settings. **↻** makes a current result again and replaces it. The old result stays on screen until the new one arrives, and also stays if the new run fails.
  - Results are matched to the subtitles by text. If Netflix serves a slightly different file, or the sentence building changes, the result moves to the same sentences. Lines that are gone are dropped. If less than half of the sentences are found, the result isn't shown.
  - **Options → Key lines → Saved results** lists them by episode, with model, level, date and size. You can delete one or all.
  - **Backup JSON** in Options → Saved words includes them. Importing keeps the newer result when you already have one for the same settings.
  - The toolbar popup marks episodes with saved key lines 🎤 or a summary 📖.
  - Results saved before this feature are moved over the first time you open their episode with the same model and level.
- **💬 Chat:** open the **💬 Chat** tab (or press **Y**) and ask. It uses the Key lines provider, model and level, so with Claude Code it runs on your Claude plan.
  - **What is sent.** With each question: the episode's numbered sentences (built as for key lines), the line you are at, and the chat so far (up to 20 messages, about 12,000 characters). The episode part comes first and stays the same from one question to the next, so the provider's prompt cache can reuse it. With Claude Code on Haiku 4.5, the first words came after about 3.5 seconds and a short answer was done after 5–7 seconds; Opus 5.5 is slower.
  - **The whole episode.** The chat knows every line, so it can talk about what happens later, too.
  - **Language.** The answer comes in the language of your last typed message. A quick button follows that; before you type anything, it answers in your own language (Options → Settings). Answers in the language you're learning are pitched to your CEFR level.
  - **Line buttons.** The model cites lines by number; each becomes **▶ time**, which plays the line. The line is saved with the answer by its text and time, so the button still finds it after you switch subtitle tracks. Under each question, **at 1:28 · "…"** shows (and plays) the line you were at.
  - **While it writes.** **■** stops the answer and keeps what came so far. **↻** asks the last question again, from the line it was asked at. **📋** copies an answer with the line times in it.
  - **🔊** reads an answer aloud like the summary: Kokoro for English, the browser's voice for Korean and other languages (told apart by their letters). Netflix pauses while it reads.
  - **Saved per episode** in the extension's storage (the newest 200 messages). **✚ New chat** (click twice) forgets it. Chats aren't in backups yet.
  - With Claude Code the whole episode goes through a temporary file next to the helper (`%TEMP%\polyglot-claude-code`), since Windows limits a command line to about 32,000 characters. The file is deleted when the answer ends or is stopped.
- **Read aloud:** click 🔊 in the Summary tab: the one at the top reads everything, the others read the overview, who's who or one scene. Netflix pauses while it reads, and playing the video stops the reading. Pick the voice, speed and engine in **Options → Settings → Read summaries aloud**; **▶ Try this voice** also downloads the model ahead of time.
  - English summaries use [Kokoro-82M](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) through `kokoro-js`. It runs in an offscreen extension page on WebGPU, or on 4 CPU threads (WebAssembly) when there is no usable GPU. The fp32 model (326 MB) downloads once from Hugging Face and is then kept in the browser cache. The page closes after 5 idle minutes to free memory.
  - Sentences are generated one at a time, each while the previous one plays, so speech starts after the first sentence. Each sentence's audio is cached in IndexedDB, so replaying it is instant. On a GeForce GT 1030 with a Ryzen 5 3600, 4 seconds of speech took about 2.5 seconds to generate on WebGPU and 3 seconds on the CPU.
  - Kokoro in the browser speaks only English, so summaries in other languages use the browser's voice for the language, as word lookups do.
  - Extension pages are cross-origin isolated (`credentialless`), which multithreaded WebAssembly needs, and the CSP allows `wasm-unsafe-eval`.
- **Cut-off lines:** subtitles sometimes end before the speaker finishes, so auto-pause stops one or two words early. Others appear after the speaker has started, so going to the line misses its first word.
  - Press **X** right after such a stop. The line plays 0.7 s more and pauses again, and each further press adds more. The line stays on screen meanwhile, even when the next subtitle has already started.
  - If that extra time ran into the next line, playing on goes back to where the next line starts, so you hear it from its first word.
  - Press **Z** while a line plays whose first words are missing. The line then starts 0.7 s before its subtitle, replays and pauses at its end. Until its subtitle appears, the extension already treats that line as the current one: it is shown, and S, X and Z apply to it.
  - Both changes are saved for that line in that episode, by subtitle language and start time. From then on auto-pause, **S**, **A**/**D**, a click in the sidebar, Shadow mode and loops use them.
  - **Shift+X** and **Shift+Z** take 0.7 s off and replay the line so you can check it. Anywhere else, **X** replays the current line and pauses at its end, even with auto-pause off.
  - **M** works as a second X key and **N** as a second Z key, Shift included.
  - If most lines are off, use the settings under **Options → Settings → Playback** instead. They apply to every line:
    - **Pause later by** (0–1000 ms) makes auto-pause wait longer at the end of each line.
    - **Start lines earlier by** (0–1000 ms) starts each line sooner when you go to it.

    The same card sets how far one X or Z press moves a line and has a button to forget all saved line starts and endings.
- **Bookmarks:** your bookmark always comes first. Without one, Continue uses the last line you played. If both exist and are far apart, the banner also has a **⏱** button for where you stopped. The banner closes once you reach the line or after about 10 lines played elsewhere, and only then is the last line saved again. Reaching the final lines of an episode clears its "last line". Click **🔖** in the sidebar toolbar to jump to the bookmark at any time.
- **Loops:** loops snap to whole subtitle lines. With **R**, the line you are on plays to its end before the loop jumps back. From the sidebar, the loop starts at its first line at once. While a loop runs, A/S/D still move between its lines, and going outside it (a line outside, or the Netflix scrubber) ends the loop. Auto-pause, Shadow mode and Skip mode wait while a loop runs; **🗣 Gap** does the pausing, and Space skips a gap. The loop bar above the tabs shows the pass, the repeat count and the toggles. Saved loops are stored with the episode's bookmark and found again by text and time, so they survive a subtitle-track switch. The popup's ✕ forgets where to continue but keeps the episode's loops.
- **Sidebar width:** drag the sidebar's left edge. The video narrows or widens as you drag, and the width is saved when you let go. Double-click the edge for the default width (380 px). The sidebar is at least 280 px wide and always leaves the video at least 480 px. In a narrower window it shows narrower without losing your width. **Options → Settings → Sidebar width** sets it too.
- **Sidebar on your second monitor:**
  - The window opens on a monitor without the Netflix window and fills it (fullscreen). If you move it to another monitor, it opens there next time.
  - **⤡ / ⤢** in its header switches between fullscreen and maximized (with the title bar and taskbar), and remembers your choice. **F11** works too. **− Aa +** sets the text size in the window. Below a width of 900 px the window shows one column.
  - **⇄** in its header (or **O**) puts the list on the left and the big line on the right, and back. Drag the line between the two columns to set the list's width, and double-click it to go back to the automatic width. Both are remembered. The list's side can also be set in **Options → Settings → Display**, which also resets a dragged width.
  - The seek bar shows where you are in the episode, with the loop and your bookmark marked. Click it to jump there. Click a dimmed line above or below the big line to play it.
  - Keys pressed in the window work as on the page. **Space** plays and pauses, and **←/→** go back or forward 10 s, since those keys can't reach Netflix from there.
  - **Opening the window takes Netflix out of fullscreen**, a Chrome rule. If Netflix was fullscreen, the extension makes Netflix's browser window fullscreen instead, which looks the same because the player fills the page. **F** or **⛶** in the window switches that on and off.
  - **Subtitles on video** (in the window) off hides the subtitles on the video while the window is open, so the text appears only on your shadowing monitor.
  - **H** (blur video) blurs the big line too, as on the video: hover a line to read it, or hover the translation to see both. Hold **V** to show them without the mouse, or press **U** to show the line you are on until the next one. The lines above and below it and the list stay readable.
  - **⇲**, **P** or **E** puts the sidebar back on the page, and so does closing the window.
  - Reloading the Netflix tab or going to the next episode keeps the window, and it reconnects by itself. If the window was closed meanwhile, your first click or key press on the Netflix page opens it again (Chrome's pop-up blocker needs one); a **⧉** tab on the right edge offers it too. If Chrome blocks it anyway, allow pop-ups for netflix.com.
  - Closing the Netflix tab closes the window. The window needs the `system.display` permission, which lists your monitors.
- **⭐ Saved sentences:**
  - **Saving.** **G** or ☆ on a line saves its whole sentence: the lines the key-line sentence building joins, such as "I'm not gonna lie," + "I'm kind of nervous." To save other lines, loop them and click ☆ in the loop bar. If a sentence was already saved from the same first line, ☆ in the loop bar changes it to the looped lines and keeps its practice history.
    - Each sentence keeps its translation, the lines just before and after it, the episode and the time.
    - If some of its lines have no translation yet, the whole sentence is machine-translated.
    - Saved lines show ★ in the list, on the video and in the floating window. Clicking ★ removes the sentence.
  - **The drill.** Practising a sentence loops its lines: 2 passes listening with the text hidden, 2 shadowing with the text, 2 shadowing from memory (set in **Options → ⭐ Sentences**). The video then pauses, and you rate it with 1–4 or the buttons in the practice bar.
    - **🗣 Gap** adds a pause after each pass, as long as the pass, to say it back.
    - Esc stops a drill. Starting a loop of your own replaces it.
  - **The schedule.** A new sentence is due at once, so you can practise it right after the episode. "Good" brings it back after 1, 3, 7, 16, 37… days, "Hard" sooner, "Easy" later. "Again" brings it back in 10 minutes and starts it over. A review due in N days is due from the start of that day. See `src/core/sentences.ts` (a small SM-2 variant).
  - **Practising on Netflix.** The ⭐ Sentences tab lists this episode's sentences, the ones due, or all of them. Click one to drill it; ▶ plays it once. A sentence from another episode opens that episode, which then drills it.
    - **▶ Practise N due** goes through every due sentence: this episode's first, then the other episodes. The practice bar offers **Open ›** for each of those, and the session carries on there, for up to 30 minutes after your last rating.
    - "Again" brings a sentence back once at the end of the session.
  - **The practice page.** Open it from the toolbar popup (it shows how many are due), the ⭐ tab or **Options → ⭐ Sentences**. It drills each due sentence with text-to-speech: Kokoro for English (the voice set in Options → Settings), the browser's voice for other languages.
    - Hover the text to peek. Keys: Space starts / stops, R repeats the pass, → skips to the next pass, 1–4 rate, T shows the translation.
    - After a rating, the next sentence starts by itself.
    - **▶ Original on Netflix** opens the episode in your Netflix tab and drills the sentence there with the real voice. A rating made there moves the practice page on too.
    - When nothing is due, you can practise the next ones ahead or 10 at random.
  - **Reminders.** The toolbar icon shows the number of sentences due, counted again every 15 minutes. The warm-up banner can be turned off in Options → ⭐ Sentences.
  - **Backup files.** Removing or reinstalling the extension deletes everything it saved. The Claude Code helper (`npm run claude:install`, the same one Key lines uses) also writes backup files.
    - When files are written: a minute after saved sentences or words change, and every 12 hours.
    - What they contain: words, sentences, key lines and summaries, in the same format as Backup JSON.
    - Where they go: `Documents\Polyglot Player` (another full path can be set in Options → ⭐ Sentences; a OneDrive or Google Drive folder keeps a copy off the computer). Each backup writes `polyglot-backup-latest.json` and a file for the day, and the last 30 daily files are kept.
    - To restore, use **Import JSON** in Saved words. Saved loops and bookmarks are not in backups yet.
    - Options shows the last backup and its errors, and has **Back up now**. After editing `native-host/claude-code-host.mjs` nothing needs reinstalling; Chrome starts the helper again for each request.
- **🔎 Find in my shows:**
  - **The library.** Each episode you open is saved by itself (**Options → 🔎 Library** can turn this off). What is saved:
    - its sentences, built as for key lines, with their translation line when every line of the sentence has one;
    - the parts you played, as time ranges.

    It is kept in the extension's own IndexedDB (`polyglot-library`), apart from the cache. About 50 KB an episode.
  - **Searching.** Open the sidebar's **🔎 Find** tab and type a word, a phrase, a pattern or a Korean line. Or click a word in the subtitles and choose **🔎 In my shows (N)**, where N counts the lines found. Results come in groups:
    - **Same words**;
    - **Spoken form**: gonna, wanna, gotta, kinda, lemme, 'cause and others, both ways round;
    - **Other forms**: about 150 irregular verbs and nouns are listed, regular -s / -ed / -ing forms come from rules, and only forms found in your episodes count;
    - **Pattern** (`*` or `___` is up to 3 words);
    - **Korean line**: letter pairs of the translation line, so word endings and spacing may differ;
    - **Same meaning, other words**.
  - **Order of the results.** Lines from parts you watched come first. **Watched only** (on by default) shows only those: no spoilers, and you know the scene. Next come lines of 5–12 words, which are easiest to shadow. At most two lines of one episode come first, so you hear different people. A line said in several episodes is shown once with ×N.
  - **Filters.** This episode, other episodes, length, show, and **🎤 only** (key lines, in episodes where you found them).
  - **Lines like this one** (**I**, or 🔎 on a line in the list or on the floating window's big line) shows the line's chunks: runs of 2–5 words that other episodes have too, most episodes first. Filler-only runs such as "of the" are left out. Click a chunk to see its lines. **✨ Pattern** asks the Key lines provider once for the line's reusable frames, such as "I can't believe ___"; a frame whose words aren't all in the line is dropped.
  - **Same meaning.** [all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2) (8-bit, about 23 MB, downloaded once) runs in the offscreen page on the CPU, next to Kokoro. It reads each new English episode in the background, a few seconds per episode, and its vectors are kept with the library. A Korean query is first translated into English by Google. Measured: "I'm starving." is 75% like "I'm so hungry.", 61% like "Let's get something to eat.", and at most 30% like unrelated lines. Lines under 45% aren't shown. **Options → 🔎 Library** shows how many episodes it has read and can turn it off.
  - **Playing.** ▶ plays a line once. 🗣 shadows it: each pass is followed by a pause as long as the line, the last pass too, to say it back (1–3 passes; 🙈 Hide text blurs it from the second pass). **▶ Play all** and **🗣 Shadow all** take up to 40 lines found: this episode's first, then each other episode's lines in video order. The bar above the tabs shows where you are. Before another episode it waits for **Open ›**, then carries on there, for up to 30 minutes after the last line. Esc or a loop of your own pauses it; **▶ Continue** goes on. Your X / Z fixes for a line apply.
  - **Backup.** With the Claude Code helper, `polyglot-library.json` is written next to the other backup files a few minutes after new episodes are saved, and once a day. Of the dated copies, the last 3 are kept. Export, Import and Delete are in **Options → 🔎 Library**.
- **Anki:** install AnkiConnect (add-on code `2055492159`), then use **Options → Anki → Connect**.

## How it works

| Piece | File(s) |
|---|---|
| Netflix hooks (MAIN world, `document_start`). Wraps `JSON.stringify` to request text subtitle profiles and every language, and wraps `JSON.parse` / `Response.json` to capture track lists and titles. Each manifest has download links for only some tracks, so the track list keeps every track seen for the title. Reads both manifest shapes (`timedtexttracks` and the newer `textTracks`). Can choose a language in Netflix's own subtitle menu (`showSubtitles`), which makes Netflix send that track. Also bridges `seek`/`play`/`pause` to Netflix's internal player, since setting `video.currentTime` directly triggers error M7375. | `src/sites/netflix/main-world.ts`, `manifest.ts` |
| Site adapter (isolated world). Handles track download, time sync, layout and fullscreen. A YouTube adapter would implement the same interface. | `src/sites/adapter.ts`, `src/sites/netflix/adapter.ts` |
| Subtitle parsing: WebVTT, TTML/DFXP/IMSC with ruby, SDH stripping, alignment of human translations | `src/core/subtitles/*` |
| Playback logic: current line, previous/next/repeat, auto-pause, loops (passes, speaking gap, waiting for Netflix's seek to land) | `src/core/playback.ts` |
| Saved loops: storage with the episode's bookmark, Loops tab, loop bar | `src/core/bookmarks.ts`, `src/bookmarks/store.ts`, `src/ui/Sidebar.tsx` (`LoopBar`, `LoopsTab`) |
| Cut-off lines: extra ending (extend key) and early start (start key) per line, pause delay and start setting, holding the line on screen, going back to the next line's start; saved starts and endings per episode | `src/core/playback.ts` (`extend`, `moveStart`, `heldLine`, `rewindToNext`), `src/lineends/store.ts` |
| App state and orchestration: Preact signals, translation pipeline | `src/app/*` |
| UI (Preact in a shadow root): overlay, sidebar, word popup | `src/ui/*` |
| Sidebar on a second monitor: opening the popup window and taking it back after a reload (content script); open, dock, keys in the window and the seek bar's clock (controller); placing it on a monitor, fullscreen, remembering the monitor (background); the window's UI (two columns you can swap and resize, big line with the lines around it, seek bar, play bar) | `src/app/float.ts`, `src/app/controller.ts`, `src/services/floatwin.ts`, `src/core/displays.ts`, `src/ui/Float.tsx`, `src/ui/Sidebar.tsx` (`FloatBody`, `BigLine`, `SeekBar`, `PlayBar`) |
| Background service worker: subtitle fetch, Google Translate (batched, serialized, cached in IndexedDB), Claude, key lines, TTS, AnkiConnect | `entrypoints/background.ts`, `src/services/*` |
| Key lines: sentence building, prompt, schema, tier handling, skip ranges, stepping between key lines (J / L); provider choice and cache | `src/core/keylines.ts`, `src/services/keylines.ts`, `openai.ts`, `claude-code.ts` |
| Episode summary: prompt, schema, scene ranges and evidence checks; request and cache; Summary tab | `src/core/summary.ts`, `src/services/summary.ts`, `src/ui/Sidebar.tsx` (`SummaryTab`) |
| 💬 Chat: prompt (rules, then the numbered episode), the chat as turns, the answer's small Markdown and line numbers, finding a cited line again, the answer's language; streaming over a port (background), Claude Code `stream-json` through the helper's `chat` request and OpenAI server-sent events; asking, stopping, retrying and saving per episode; the 💬 tab | `src/core/chat.ts`, `src/services/chat.ts`, `src/services/claude-code.ts`, `src/services/openai.ts`, `native-host/claude-code-host.mjs`, `src/app/chat.ts`, `src/chat/store.ts`, `src/ui/Chat.tsx` |
| Saved results: per-episode IndexedDB records, earlier-settings fallback, matching to changed subtitles, moving old hashed entries; list, backup and popup marks | `src/core/analyses.ts`, `src/services/analyses.ts`, `src/pages/options/SavedResults.tsx` |
| Summary read aloud: reading order and sentence splitting, WAV encoding; Kokoro in the offscreen page (model, clip cache, playback); offscreen lifecycle; page-side readers (Kokoro port, browser voice) | `src/core/readaloud.ts`, `src/services/kokoro.ts`, `entrypoints/offscreen`, `src/services/offscreen.ts`, `src/app/reader.ts` |
| Claude Code helper (native messaging host, runs `claude -p` on your subscription) and its installer | `native-host/claude-code-host.mjs`, `scripts/install-claude-host.mjs` |
| Saved words, CSV/JSON/Anki export | `src/words/*` |
| ⭐ Saved sentences: schedule, due list, practice order and queue, drill passes, line ranges; storage and the Netflix practice session; saving, drills, ratings and sessions; ⭐ tab, practice bar and ☆ buttons; practice page; Options panel | `src/core/sentences.ts`, `src/sentences/store.ts`, `src/app/controller.ts` ("⭐ sentences"), `src/ui/Sentences.tsx`, `src/pages/practice`, `entrypoints/practice`, `src/pages/options/SentencesPanel.tsx` |
| Due count on the toolbar icon and backup files through the native helper | `src/services/backup.ts`, `native-host/claude-code-host.mjs` |
| 🔎 Find in my shows: words, word forms and spoken forms, the word index, phrase and `*` matching, chunks, Korean matching, ranking and filters, run order, the library file | `src/core/library.ts`, `src/core/wordforms.ts` |
| 🔎 Saving the episode and the parts played, searching, Play all / Shadow all across episodes (with the loop's `speakGap`) | `src/app/find.ts`, `src/library/store.ts`, `src/core/playback.ts` |
| 🔎 The library in the background: storage, search, Options list, import / export, backup file | `src/services/library.ts`, `src/services/library-db.ts` |
| 🔎 Same meaning: vectors and similarity; the model in the offscreen page (sharing its idle timer with Kokoro); vectors per episode and the search | `src/core/meaning.ts`, `src/services/embed.ts`, `src/services/offscreen-idle.ts`, `src/services/meaning.ts` |
| 🔎 ✨ Pattern: prompt, check and request | `src/core/patterns.ts`, `src/services/patterns.ts` |
| 🔎 Find tab, run bar and the word popup's button; Options → Library | `src/ui/Find.tsx`, `src/pages/options/LibraryPanel.tsx` |
| Bookmarks and the last line played: finding the line again by text and time, Continue banner, popup list | `src/core/bookmarks.ts`, `src/bookmarks/store.ts` |
| Toolbar popup and Options page | `entrypoints/popup`, `entrypoints/options`, `src/pages/*` |

All Netflix DOM selectors are in `src/sites/netflix/selectors.ts`. Check that file first if a Netflix redesign breaks the layout.

## Testing

```bash
npm test             # Vitest: parsers, alignment, tokenizer, Google parsing, manifest extraction, export, playback, loops, read aloud, floating window, saved sentences, the practice page, 🔎 Find and 💬 Chat
npm run compile      # TypeScript type-check
```

## Known limitations

- Netflix uses DRM, so screenshots and audio clips can't be captured for Anki cards.
- Google's `translate_a/single` endpoint is unofficial and may rate-limit. Requests are batched, sent one at a time and cached per line.
- Netflix changes its internals from time to time (manifest format, player API, DOM). Fixes belong in `src/sites/netflix/`.
- Saved phrases (more than one word) are listed and exported, but only single words are highlighted in subtitles.
- 🔎 The library has only the episodes opened since it was added. A found line in another episode plays only once Netflix has opened that episode (5–10 s), since DRM keeps the sound from being saved.
- 🔎 Netflix subtitles sometimes shorten what is said. English closed captions (CC) are closer to the speech.
- 🔎 Same meaning works in English episodes only (the model is English). Word forms are English only; other languages find the same words.
- This is an independent personal study tool. It isn't affiliated with Netflix or Language Reactor.
