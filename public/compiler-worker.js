import {runWasi} from './wasi.js';
let compiler;
let binary;
let inputState;
let pendingInput = new Uint8Array();
let inputEnded = false;
const decoders = {stdout: new TextDecoder(), stderr: new TextDecoder()};
const emit = (type, extra = {}) => postMessage({type, ...extra});
async function load() {
  if (!compiler) {
    emit('status', {text: 'Loading C compiler…'});
    compiler = await import('./toolchain/bundle.js');
    await compiler.runClang(null, {}, {fetchProgress: ({doneLength, totalLength}) => emit('progress', {percent: Math.round(doneLength / totalLength * 100)})});
  }
  return compiler;
}
function readInput(len) {
  if (inputEnded) return new Uint8Array();
  if (pendingInput.length) {
    const result = pendingInput.slice(0, len); pendingInput = pendingInput.slice(len); return result;
  }
  Atomics.store(inputState, 0, 0);
  emit('input');
  Atomics.wait(inputState, 0, 0);
  const state = Atomics.load(inputState, 0);
  if (state === 2) { inputEnded = true; return new Uint8Array(); }
  const size = Atomics.load(inputState, 1);
  pendingInput = new Uint8Array(inputState.buffer, 8, size).slice();
  const result = pendingInput.slice(0, len); pendingInput = pendingInput.slice(len); return result;
}
onmessage = async ({data}) => {
  try {
    if (data.type === 'load') { await load(); emit('ready'); return; }
    if (data.type === 'compile') {
      const clang = await load();
      binary = null;
      const start = performance.now();
      emit('status', {text: 'Compiling…'});
      const flags = data.flags || ['-std=c17', '-Wall', '-Wextra', '-O0'];
      const files = await clang.commands.clang([...flags, ...data.sources, '-lm', '-o', 'main.wasm'], data.files, {
        decodeASCII: false,
        stdout: chunk => { if (chunk) emit('output', {stream: 'diagnostic', text: decoders.stdout.decode(chunk, {stream: true})}); },
        stderr: chunk => { if (chunk) emit('output', {stream: 'diagnostic', text: decoders.stderr.decode(chunk, {stream: true})}); }
      });
      binary = files['main.wasm'];
      if (!binary) throw new Error('No executable was produced. Check your source files and compiler flags.');
      emit('compiled', {ms: Math.round(performance.now() - start), size: binary.length});
    }
    if (data.type === 'run') {
      if (!binary) throw new Error('Compile your program first.');
      inputState = data.inputBuffer ? new Int32Array(data.inputBuffer) : null;
      pendingInput = new Uint8Array(); inputEnded = false;
      emit('running');
      const start = performance.now();
      const code = await runWasi(binary, {
        stdin: data.stdin, args: data.args,
        readInput: inputState ? readInput : null,
        onOutput: (stream, bytes) => emit('output', {stream, text: decoders[stream].decode(bytes, {stream: true})})
      });
      for (const stream of ['stdout', 'stderr']) { const text = decoders[stream].decode(); if (text) emit('output', {stream, text}); }
      emit('finished', {code, ms: Math.round(performance.now() - start)});
    }
  } catch (error) {
    emit('error', {text: error instanceof WebAssembly.RuntimeError ? `Runtime error: ${error.message}. Check array bounds, pointers, and division by zero.` : error.message || String(error)});
  }
};
