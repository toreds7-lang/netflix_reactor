# Setup Guide: Polyglot Player for Netflix (Windows)

This guide puts the **Polyglot Player for Netflix** Chrome extension on your Windows computer. You can use **Claude Code** or **Codex** to do most of the work for you.

- **Part 1–3** are for you. You install a few tools, download the project and ask your AI tool to set it up.
- **Part 4** is for the AI tool. You don't need to read it. Your AI tool reads it and follows it.
- **Part 5–8** are for you again: first use, updates, keeping your data safe, and fixing problems.

It takes about 30–45 minutes, most of it downloads.

**Project link:** https://github.com/toreds7-lang/netflix_reactor

---

## What you need

- A Windows 10 or 11 computer
- **Google Chrome** (not Edge or another browser; the Claude helper below only works with Chrome)
- A **Netflix** account
- A **GitHub** account, if the project is private (your friend must invite you first)
- **Claude Code** with a Claude plan (Pro or Max), **Codex** with a ChatGPT plan, or both

What each AI tool can do here:

| | Claude Code | Codex |
|---|---|---|
| Set up the project for you | Yes | Yes |
| Run the extension's ✨ Key lines, Summary and 💬 Chat | Yes, on your Claude plan | No |
| Write automatic backup files of your saved words and sentences | Yes | No |

Without Claude Code, the subtitles, sidebar, word lookup, saved words and saved sentences all still work. For Key lines, Summary and Chat you would need an OpenAI **API key** instead. That is separate from a ChatGPT plan and is paid per use (see Part 4, step 8).

---

## Part 1: Install the tools (you do this)

### 1. Git and Node.js

Open **PowerShell** (press the Windows key, type `powershell`, press Enter) and paste:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
```

Click **Yes** if Windows asks for permission. If `winget` is not found, download and install them from the websites with the default options:

- Git: https://git-scm.com/download/win
- Node.js (the **LTS** version): https://nodejs.org

**Close PowerShell and open it again** so it finds the new programs.

### 2. Claude Code

In PowerShell:

```powershell
irm https://claude.ai/install.ps1 | iex
```

Close PowerShell, open it again, then run `claude`. Sign in with your Claude account when it asks (or type `/login`). Type `/exit` to leave.

> Use this installer, not `npm install -g @anthropic-ai/claude-code`. The extension's helper needs the `claude.exe` that this installer puts in `C:\Users\<you>\.local\bin`.

Official instructions: https://code.claude.com

### 3. Codex

In PowerShell:

```powershell
npm install -g @openai/codex
```

Then run `codex` and choose **Sign in with ChatGPT**. Type `/quit` to leave.

If PowerShell says *"running scripts is disabled on this system"*, use `npm.cmd` in place of `npm` (`npm.cmd install -g @openai/codex`).

Official instructions: https://developers.openai.com/codex

### 4. Check

```powershell
git --version
node --version
claude --version
codex --version
```

Each line should print a version number. `node --version` should print v22 or higher.

---

## Part 2: Download the project (you do this)

Put the project in a short folder that is **not** inside OneDrive (your Desktop and Documents folders are often in OneDrive). `C:\Projects` is a good choice:

```powershell
mkdir C:\Projects
cd C:\Projects
git clone https://github.com/toreds7-lang/netflix_reactor.git
cd netflix_reactor
```

If the project is private, a GitHub sign-in window opens. Sign in with the account your friend invited.

> **Don't move or rename this folder later.** Chrome links the extension to this folder. If it moves, Chrome treats it as a new extension with none of your saved words and sentences.

---

## Part 3: Ask your AI tool to set it up (you do this)

Stay in the `C:\Projects\netflix_reactor` folder in PowerShell and start your AI tool:

```powershell
claude
```

(or `codex`). Then paste this message:

```text
Please set up this project for me. Read Setup_Guide.md in this folder and follow
"Part 4: For the AI assistant". I use Windows and I'm not a programmer, so explain
each step simply and tell me exactly what to click when you need me to do something
in Chrome.
```

What to expect:

- The AI asks your permission before it runs commands. Read what it wants to do and allow it. Installing the packages needs the internet; if Codex says the network is blocked, approve the request.
- Partway through, it asks you to do a few clicks in Chrome. Then it asks you to copy a line from the extension's settings page and paste it back to it.
- **Never paste passwords or API keys into the chat.** If a key is needed, the AI opens a file in Notepad for you to paste it into.

When it's done, go to **Part 5**.

---

## Part 4: For the AI assistant

*This part is written for Claude Code or Codex. The user's request in Part 3 asked you to follow it.*

### Context

- This folder is a Chrome extension (Manifest V3) built with WXT, Preact and TypeScript. See `README.md` for features and code layout.
- Setting it up means: install npm packages, type-check, run the tests, build into `.output\chrome-mv3`, have the user load that folder in Chrome, then (optional) register the Claude Code helper, a Chrome native messaging host that runs `claude -p` on the user's Claude plan.
- The user is on Windows and is not a programmer. Explain each step in a sentence or two of plain English. When the user must act in Chrome, give numbered click-by-click steps.

### Rules

1. Don't edit source files, `package.json` or `package-lock.json` to make a step pass. If a step fails, stop, show the error and explain it simply.
2. Don't commit, push, or run `git reset`, `git checkout -- .` or `git clean`.
3. Don't use `npm run dev`. Recent Google Chrome ignores the flag WXT uses to load the extension. Use `npm run build` and **Load unpacked**.
4. Never ask the user to type an API key or password into the chat. Put keys in files the user edits in Notepad, and don't print those files.
5. Ask before installing anything outside this folder (Node, Git, global npm packages).
6. Commands below work in PowerShell. Claude Code may run them in Git Bash; `npm` and `git` commands are the same there.

### Step 1: Check the tools

```
git --version
node --version
npm --version
```

- Node must be **v20.19 or newer** (v22 or v24 LTS recommended). If it's missing, ask the user to install Node.js LTS (Part 1), then restart this AI session so it gets the new PATH.
- If Node is installed but not found, add it to PATH for this session:
  - PowerShell: `$env:Path = "C:\Program Files\nodejs;" + $env:Path`
  - Git Bash: `export PATH="/c/Program Files/nodejs:$PATH"`
- If PowerShell says *"running scripts is disabled on this system"*, use `npm.cmd` in place of `npm` everywhere below.
- Confirm you are in the project folder: `package.json` has `"name": "language-reactor-netflix"`.

### Step 2: Install packages

```
npm install
```

Takes a few minutes and needs the internet (about 530 MB in `node_modules`). It ends by running `wxt prepare` (the `postinstall` script). Lines with `warn`, `deprecated` or `funding`, and a note that some packages have vulnerabilities, are fine; don't run `npm audit fix`, which changes package versions. Lines with `npm error` are not fine.

### Step 3: Type-check and test

```
npm run compile
npm test
```

- `npm run compile` prints nothing after its header when there are no type errors.
- `npm test` should end with every test file and test passing (in November 2026: 40 files, `Tests 400 passed (400)`; the numbers grow as features are added).

### Step 4: Build

```
npm run build
```

This creates `.output\chrome-mv3`. Check that `.output\chrome-mv3\manifest.json` exists, then tell the user the full path of `.output\chrome-mv3` (for example `C:\Projects\netflix_reactor\.output\chrome-mv3`). They need it in step 5.

### Step 5: The user loads the extension in Chrome

Give the user these steps:

1. Open Chrome, type `chrome://extensions` in the address bar and press Enter.
2. Turn on **Developer mode** (switch at the top right).
3. Click **Load unpacked** and choose the `.output\chrome-mv3` folder from step 4. (In the folder window you can paste the path into the address bar at the top.)
4. A card named **Polyglot Player for Netflix** appears. Click the puzzle icon 🧩 in Chrome's toolbar and pin it.
5. The extension's Options page may open by itself. If not, right-click the extension's icon and choose **Options**.

Ask the user to tell you when the card is there, and whether it shows any red **Errors** button.

### Step 6: Decide on Key lines, Summary and Chat

Ask the user which applies:

- **They have Claude Code signed in with a Claude plan** → do step 7.
- **They only have Codex / ChatGPT** → skip step 7. Explain that Key lines, Summary and Chat can't run on Codex or a ChatGPT plan, and that automatic backup files need the Claude Code helper. Offer step 8 (OpenAI API key, paid per use) and remind them to use **Backup JSON** now and then (Part 7).

### Step 7: Register the Claude Code helper

1. Check Claude Code:
   ```
   claude --version
   where.exe claude
   ```
   `where.exe` must list a path ending in `claude.exe` (usually `C:\Users\<name>\.local\bin\claude.exe`). If it only lists `claude.cmd` or `claude.ps1` (the npm package), the helper can't start it: ask the user to install Claude Code with the native installer (Part 1, step 2).
2. Ask the user to open the extension's **Options → Key lines**, click **Copy** next to the line that starts with `npm run claude:install --`, and paste it to you.
   - The ending is the extension ID: 32 letters from a to p. It is different on every computer, because Chrome makes it from the folder path. Never use an ID from somewhere else.
3. Run that exact command in the project folder, for example:
   ```
   npm run claude:install -- abcdefghijklmnopabcdefghijklmnop
   ```
   Expected output: `Claude Code helper installed.` with the paths of Claude Code and Node. It writes `native-host\claude-code-host.bat`, `native-host\com.polyglot_player.claude_code.json` and a key under `HKCU\Software\Google\Chrome\NativeMessagingHosts`.
4. Ask the user to click **Test** in Options → Key lines. Success looks like *"Claude Code (version) is signed in with your Claude subscription"*. If it says not signed in, the user runs `claude` in a terminal and types `/login`.

The helper also writes backup files to `Documents\Polyglot Player` from now on.

### Step 8 (optional): OpenAI API key instead of Claude Code

Only if the user wants it. They need an API key from https://platform.openai.com (paid per use, about $0.002 per episode with gpt-4o-mini; a ChatGPT plan does not include it).

1. Create `.env` in the project folder with exactly:
   ```
   OPENAI_API_KEY=
   LLM_MODEL=gpt-4o-mini
   ```
2. Run `notepad .env` and ask the user to paste their key right after `OPENAI_API_KEY=`, save and close. Don't read or print the file afterwards.
3. Run `npm run build`. The user then clicks the reload button ↻ on the extension's card in `chrome://extensions`, and picks **Provider → OpenAI (API key from .env)** in Options → Key lines.
4. Tell the user: the key is now inside `.output\`. Never share that folder or a zip of it. `.env` and `.output` are in `.gitignore`, so git won't upload them.

### Step 9: Finish

Tell the user, in plain English:

- what was installed and whether every step passed (say so plainly if a step failed or was skipped),
- whether Key lines, Summary and Chat are set up, and with which provider,
- to go on to **Part 5: First use** of this guide.

---

## Part 5: First use

1. Open https://www.netflix.com in Chrome. If a Netflix tab was already open, **reload it** (F5).
2. Start an episode with subtitles. The transcript sidebar appears on the right and two subtitle lines show on the video.
3. Press **?** to see all keyboard shortcuts. Good ones to start with: **A / S / D** (previous / repeat / next line), **Q** (auto-pause), **E** (sidebar on/off).
4. Open **Options** (right-click the extension icon → Options):
   - **Settings → Translate subtitles into**: your language (Korean is the default).
   - **Key lines → Your level**: your level in the language you're learning (A1–C2).
5. The first time you use 🔊 read aloud, it downloads a voice model (about 326 MB). After that it's quick.

The big ⏻ button in the toolbar popup (or **Alt+L** on Netflix) turns the whole extension off and on. `README.md` explains every feature.

---

## Part 6: Updating to a newer version

When your friend says there's a new version, open PowerShell in the project folder, start your AI tool and say:

```text
Update this project: run git pull, npm install, npm test and npm run build, and tell me
if anything fails. Don't discard any of my local changes.
```

Or do it yourself:

```powershell
cd C:\Projects\netflix_reactor
git pull
npm install
npm run build
```

Then:

1. Go to `chrome://extensions` and click the **reload button ↻** on the Polyglot Player card.
2. Reload your Netflix tab.

You don't need to run `npm run claude:install` again after an update. Only run it again if you move Node.js or Claude Code to a different place.

---

## Part 7: Keep your saved data safe

- **Never click "Remove" on the extension's card.** Removing it deletes everything it saved: words, sentences, bookmarks, key lines, summaries and chats. To update, use the reload button ↻.
- **Don't move or rename the project folder.** Chrome would treat it as a new, empty extension.
- **Backups:**
  - With the Claude Code helper, backup files are written by themselves to `Documents\Polyglot Player`. Options → ⭐ Sentences shows the last backup and has **Back up now**.
  - Without it, open **Options → Saved words** and click **Backup JSON** now and then. Keep the file somewhere safe.
  - To restore, use **Import JSON** in Options → Saved words.
  - Saved loops, bookmarks and chats aren't in backups yet.

---

## Part 8: Fixing problems

| Problem | What to do |
|---|---|
| *"running scripts is disabled on this system"* when running `npm` | Use `npm.cmd` in place of `npm`. Or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once and answer Y. |
| *"'node' is not recognized"* or *"'git' is not recognized"* | Close PowerShell (and your AI tool) and open them again. If it still happens, install Node.js / Git again (Part 1). |
| `npm run claude:install` says Claude Code was not found | Install Claude Code with the installer in Part 1, step 2 (not with npm). Open a new PowerShell and try again. |
| `npm run claude:install` says *"Not an extension ID"* | Copy the line again with the **Copy** button in Options → Key lines. Paste it without changes. |
| **Test** in Options → Key lines shows an error about the native host | Run the `npm run claude:install -- …` line from Options → Key lines again, then click Test. If you loaded the extension from another folder, the ID changed. |
| **Test** says Claude Code is not signed in | Run `claude` in PowerShell, type `/login`, sign in, then click Test again. |
| Key lines say you've reached a usage limit | That's your Claude plan's limit. Wait until it resets, or pick a smaller model (Haiku) in Options → Key lines. |
| Nothing appears on Netflix | Reload the Netflix tab. Check the ⏻ button in the extension's popup is on. In `chrome://extensions`, check the card for a red **Errors** button and show the error to your AI tool. |
| You ran `npm run dev` and Chrome opened without the extension | Close that Chrome window. Use `npm run build` and **Load unpacked** (Part 4, steps 4–5). |
| Anything else | Start your AI tool in the project folder, describe what you see (a screenshot helps) and ask it to look at `README.md` and this guide. |
