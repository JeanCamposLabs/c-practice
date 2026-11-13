# C Practice

Jean’s browser workspace for learning C. Open **[C Practice](https://jeancamposlabs.github.io/c-practice/)** — no editor installation or account is required.

## Get started

1. Edit `main.c` and click **Run code**, or press **Ctrl+Enter** / **⌘+Enter**.
2. For `scanf` / `fgets`, put input in **Program input** before running. If **Live terminal input** is enabled, you can also type into the terminal when the program asks for input. **Ctrl+D** sends EOF.
3. Try the eight exercises in the practice path. Each opens a separate file and compares your program’s output with the exercise’s sample output. This checks the example, not every possible input.
4. Download individual files or **Back up workspace** to save a JSON backup. Import `.c`, `.h`, or a workspace backup to restore work.

The compiler downloads about **27 MB on the first visit**. Compilation and execution happen on your device; source code is never submitted to a compiler server. Files, program input, selected standard, and exercise progress are saved in this browser’s local storage. Clearing browser data removes these saves. They do not sync between computers; use backups to move work.

## Editor and terminal

CodeMirror provides C syntax highlighting, line numbers, indentation, completion, bracket matching, search, undo, and folding. Choose C99, C11, C17 (default), or C23. The compiler is Clang 22 through the pinned YoWASP WebAssembly build.

The terminal supports `help`, `run`, `compile`, `clang`, `gcc` (a Clang alias), `./main`, `ls`, `cat`, `pwd`, and `clear`, plus command history. This is a practice terminal with these commands, not a full operating system shell.

The toolbar compiles the active `.c` file and any local headers it includes. Compile multiple source files using the terminal:

```sh
clang main.c helpers.c -Wall -Wextra -o main
./main
```

Arguments can be set in the input panel or supplied to `./main`. Quoted arguments are supported. The math library is linked automatically.

## Browser runtime

The complete compiler and standard library are self-hosted on GitHub Pages, with no third-party runtime CDNs or API keys. A dedicated worker runs the compiler and a small WASI Preview 1 console host runs compiled programs. Output goes to the terminal. Programs can be stopped immediately and are stopped automatically after 10 seconds of uninterrupted execution or 150 KB of output. Time spent waiting for live input does not count against the execution timeout.

Live input uses `SharedArrayBuffer` with a service worker that adds the cross-origin isolation headers unavailable in GitHub Pages settings. The first visit may reload once to enable it. When a browser cannot enable isolation, preloaded input remains available. Use a current Chrome, Edge, Firefox, or Safari browser.

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

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The vendored compiler is `@yowasp/clang@22.0.0-git20542-10`. The JavaScript loader is patched only to load gzip-compressed assets on static hosts and to support the same compressed files in Node tests. Compiler binaries are unmodified.

Compiler package SHA-1: `99e06cff031c57bc040b68ce0dbf41d239cde14c`.
