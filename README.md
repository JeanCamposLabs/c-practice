# C Practice

Jean’s browser workspace for learning C. Open **[C Practice](https://jeancamposlabs.github.io/c-practice/)** — no editor installation or account is required.

## Get started

1. Edit `main.c` and click **Run**, or press **⌘+Enter** / **Ctrl+Enter** from either pane.
2. Use the **☰ workspace menu** for files, input, arguments, compiler settings, exercises, and the C reference. The screen opens with just the editor and terminal, in light mode. Dark mode is available under Appearance.
3. For `scanf` / `fgets`, type into the terminal when prompted, or add input under **Program input & arguments** before running. **Ctrl+D** sends EOF.
4. Choose **Download .c file** to save the active source. **Download binary (.wasm)** builds the current program if needed and saves its WASI WebAssembly executable. This binary runs in a compatible WASI runtime; it is not a native macOS executable. Header files download as `.h`.
5. **Back up workspace** saves all files and progress to JSON. Import `.c`, `.h`, or a workspace backup to restore work.

The compiler downloads about **27 MB on the first visit**. Compilation and execution happen on your device; source code is never submitted to a compiler server. Files, program input, selected standard, appearance, and exercise progress are saved in this browser’s local storage. Clearing browser data removes these saves. They do not sync between computers; use backups to move work.

## Editor and terminal

CodeMirror provides C syntax highlighting, line numbers, indentation, completion, bracket matching, search, undo, and folding. Choose C99, C11, C17 (default), or C23. The compiler is Clang 22 through the pinned YoWASP WebAssembly build.

The terminal supports `help`, `run`, `compile`, `clang`, `gcc` (a Clang alias), `./main`, `ls`, `cat`, `pwd`, and `clear`, plus command history. This is a practice terminal with these commands, not a full operating system shell.

The toolbar compiles the active `.c` file and any local headers it includes. Compile multiple source files using the terminal:

```sh
clang main.c helpers.c -Wall -Wextra -o main
./main
```

Arguments can be set in the workspace menu or supplied to `./main`. Quoted arguments are supported. The math library is linked automatically.

## Keyboard shortcuts

- **Option/Alt+Z** — toggle word wrap. Wrapping is on by default and saved in this browser; long lines fit the editor width without inserting newlines into your source. The **Wrap** button in the editor footer also toggles it.

- **⌘/Ctrl+Enter** — compile and run; add **Shift** to compile only.
- **⌘K** — clear terminal output from either pane; **Ctrl+L** also clears from the terminal. Neither interrupts a running program or discards pending input.
- **Ctrl+C** — stop a running program, or cancel the current terminal line. **⌘C** keeps its normal copy behavior.
- **Ctrl+D** — send EOF when a program is waiting for live input.
- **Ctrl+A / Ctrl+E** — move to the start / end of the terminal line.
- **Ctrl+U / Ctrl+K** — delete before / after the cursor; **Ctrl+W** deletes the previous word.
- **↑ / ↓** or **Ctrl+P / Ctrl+N** — browse command history and return to the unfinished command.
- **Ctrl+`** — switch focus between editor and terminal.
- **⌘/Ctrl+Shift+1** — toggle the editor full screen; **⌘/Ctrl+Shift+2** — toggle the terminal full screen. Press the same shortcut again, or **Escape**, to restore both panes. Expand buttons in each header do the same. Run and Stop remain available in the full-screen terminal. If a program needs input while the editor is full screen, the terminal opens automatically.
- **⌘/Ctrl+S** — save locally. The editor also supports its usual copy, paste, undo, redo, find, and Mac text navigation shortcuts.

## Browser runtime

The complete compiler and standard library are self-hosted on GitHub Pages, with no third-party runtime CDNs or API keys. A dedicated worker runs the compiler and a small WASI Preview 1 console host runs compiled programs. Output goes to the terminal. Programs can be stopped immediately and are stopped automatically after 10 seconds of uninterrupted execution or 150 KB of output. Time spent waiting for live input does not count against the execution timeout.

Live terminal input is enabled by default. On pages with cross-origin isolation it uses shared memory; otherwise Binaryen Asyncify suspends the program and resumes it through worker messages. This fallback needs no service worker, special headers, or SharedArrayBuffer and downloads an additional 2.5 MB the first time it prepares an input-capable program. Prompts are flushed before waiting, including prompts without a final newline. Preloaded input is consumed first, then execution waits for terminal input until you submit a line or send EOF with Ctrl+D. Turning off Live terminal input explicitly selects preloaded-input-only execution. Use a current Chrome, Edge, Firefox, or Safari browser.

This workspace is for standard C console programs: variables, conditions, loops, functions, arrays, strings, structs, pointers, dynamic allocation, and standard math. Networking, OS processes, threads, and persistent file I/O from compiled programs are outside this runtime. Editor files are kept separately in browser storage.

## Develop and deploy

```sh
npm ci
npm run dev
npm run check
npm test
npm run build
```

Serve `dist/` as static files. Relative asset paths support a GitHub Pages project subdirectory. Source lives on `main`; the compiled `dist/` contents are published on `gh-pages`. GitHub Pages serves the root of that branch. Rebuild and publish `dist/` to update the live site.

Compiler tests compile and execute real C for stdout/Unicode, stdin, `scanf`, math, arrays, `malloc`, live input/EOF, multiple files/headers, arguments, stderr, exit codes, and invalid source diagnostics.

## Third-party software

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The input fallback is `binaryen@132.0.0`; regenerate its vendored asset with `npm run vendor:input`. The vendored compiler is `@yowasp/clang@22.0.0-git20542-10`. The JavaScript loader is patched only to load gzip-compressed assets on static hosts and to support the same compressed files in Node tests. Compiler binaries are unmodified.

Compiler package SHA-1: `99e06cff031c57bc040b68ce0dbf41d239cde14c`.
