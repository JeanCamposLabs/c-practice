// Binaryen Asyncify lets a WASI read suspend for a normal worker message.
// Unlike shared-memory input, this also works without cross-origin isolation.
let binaryenPromise;
async function loadBinaryen() {
  if (!binaryenPromise) binaryenPromise = (async () => {
    if (typeof process !== 'undefined' && process.versions?.node) return (await import('binaryen')).default;
    const response = await fetch(new URL('./toolchain/binaryen.js.gz', import.meta.url));
    if (!response.ok) throw new Error('Could not load terminal input support. Please run again.');
    const data = new Uint8Array(await response.arrayBuffer());
    const source = data[0] === 0x1f && data[1] === 0x8b
      ? await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
      : data;
    const url = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
    try { return (await import(url)).default; }
    finally { URL.revokeObjectURL(url); }
  })().catch(error => { binaryenPromise = null; throw error; });
  return binaryenPromise;
}
export async function prepareAsyncInput(binary, onPrepare = () => {}) {
  const compiled = await WebAssembly.compile(binary);
  if (!WebAssembly.Module.imports(compiled).some(item => item.module === 'wasi_snapshot_preview1' && item.name === 'fd_read')) return binary;
  onPrepare();
  const binaryen = await loadBinaryen();
  const module = binaryen.readBinary(binary);
  try {
    binaryen.setPassArgument('asyncify-imports', 'wasi_snapshot_preview1.fd_read');
    module.runPasses(['asyncify']);
    if (!module.validate()) throw new Error('Could not prepare this program for terminal input.');
    return module.emitBinary();
  } finally { module.dispose(); binaryen.setPassArgument('asyncify-imports', null); }
}
