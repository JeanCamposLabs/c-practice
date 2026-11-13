# Third-party notices

## LLVM / Clang / LLD and standard libraries

The compiler is the npm distribution **@yowasp/clang, version 22.0.0-git20542-10**, from [YoWASP/clang](https://github.com/YoWASP/clang). Original upstream: [LLVM](https://github.com/llvm/llvm-project). The LLVM toolchain is distributed under Apache-2.0 with LLVM exceptions. The sysroot includes LLVM compiler runtime, libc++, libc++abi and [wasi-libc](https://github.com/WebAssembly/wasi-libc), whose component licenses include Apache-2.0, MIT, and BSD notices.

Copies of the upstream toolchain and library license notices are shipped in `public/toolchain/LICENSE-LLVM.txt`, `LICENSE-LIBCXX.txt`, and `LICENSE-WASI-LIBC.txt`. The compiler package also includes the YoWASP runtime and generated WebAssembly component bindings. The YoWASP JavaScript runtime is ISC licensed; see `public/toolchain/LICENSE-RUNTIME.txt`.

Changes to `public/toolchain/bundle.js`: fetch `.wasm.gz` and `.tar.gz` assets, decompress in the browser when the HTTP server has not already done so, and decompress local assets for Node tests. Wasm binaries and sysroot archive are unchanged apart from lossless gzip compression.

## CodeMirror

The editor uses [CodeMirror 6](https://codemirror.net/), by Marijn Haverbeke and contributors, licensed under MIT. Dependency versions are pinned in `package-lock.json`. The bundled language support and one-dark theme carry the same MIT license. License copies are in `public/licenses/`.

## Vite

[Vite](https://vite.dev/), copyright Evan You and contributors, is an MIT-licensed development and build tool. It is not a remote service used by the published application.
