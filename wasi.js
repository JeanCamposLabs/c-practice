// Small WASI Preview 1 host for console programs. Programs run in a disposable worker.
const encoder = new TextEncoder();
export async function runWasi(binary, {stdin = '', args = [], onOutput = () => {}, readInput} = {}) {
  let instance;
  let offset = 0;
  let exitCode = 0;
  const input = encoder.encode(stdin);
  let pendingRead, resolvedRead, asyncStack;
  const argv = ['main', ...args].map(s => encoder.encode(s + '\0'));
  const view = () => new DataView(instance.exports.memory.buffer);
  const bytes = () => new Uint8Array(instance.exports.memory.buffer);
  const u32 = (p, n) => view().setUint32(p, n, true);
  const u64 = (p, n) => view().setBigUint64(p, BigInt(n), true);
  const wasi = {
    args_sizes_get(count, size) { u32(count, argv.length); u32(size, argv.reduce((n, s) => n + s.length, 0)); return 0; },
    args_get(ptr, buf) { for (let i = 0; i < argv.length; i++) { u32(ptr + i * 4, buf); bytes().set(argv[i], buf); buf += argv[i].length; } return 0; },
    environ_sizes_get(count, size) { u32(count, 0); u32(size, 0); return 0; },
    environ_get() { return 0; },
    fd_write(fd, iovs, count, written) {
      if (fd !== 1 && fd !== 2) return 8;
      let total = 0;
      for (let i = 0; i < count; i++) {
        const ptr = view().getUint32(iovs + i * 8, true);
        const len = view().getUint32(iovs + i * 8 + 4, true);
        onOutput(fd === 2 ? 'stderr' : 'stdout', bytes().slice(ptr, ptr + len)); total += len;
      }
      u32(written, total); return 0;
    },
    fd_read(fd, iovs, count, read) {
      if (fd !== 0) return 8;
      let capacity = 0;
      for (let i = 0; i < count; i++) capacity += view().getUint32(iovs + i * 8 + 4, true);
      if (!capacity) { u32(read, 0); return 0; }
      // Show prompts without a trailing newline before waiting, as a terminal does.
      if (instance.exports.asyncify_get_state?.() !== 2) instance.exports.fflush?.(0);
      let chunk;
      if (instance.exports.asyncify_get_state?.() === 2) {
        instance.exports.asyncify_stop_rewind(); chunk = resolvedRead; resolvedRead = null;
      } else if (offset < input.length) {
        chunk = input.subarray(offset, offset + capacity); offset += chunk.length;
      } else {
        chunk = readInput ? readInput(capacity) : new Uint8Array();
        if (chunk && typeof chunk.then === 'function') {
          if (!asyncStack) throw new Error('This program was not prepared for asynchronous terminal input.');
          pendingRead = chunk; instance.exports.asyncify_start_unwind(asyncStack); return 0;
        }
      }
      if (!(chunk instanceof Uint8Array) || chunk.length > capacity) throw new Error('Invalid terminal input response.');
      let total = 0;
      for (let i = 0; i < count; i++) {
        const ptr = view().getUint32(iovs + i * 8, true);
        const len = view().getUint32(iovs + i * 8 + 4, true);
        const part = chunk.subarray(total, total + len);
        bytes().set(part, ptr); total += part.length;
        if (total === chunk.length) break;
      }
      u32(read, total); return 0;
    },
    fd_fdstat_get(fd, ptr) {
      if (fd > 2) return 8;
      bytes().fill(0, ptr, ptr + 24); bytes()[ptr] = 2;
      u64(ptr + 8, fd === 0 ? 2n : 64n); return 0;
    },
    fd_filestat_get(fd, ptr) { if (fd > 2) return 8; bytes().fill(0, ptr, ptr + 64); bytes()[ptr + 16] = 2; return 0; },
    fd_seek() { return 70; }, fd_tell() { return 70; }, fd_close(fd) { return fd <= 2 ? 0 : 8; },
    fd_fdstat_set_flags() { return 0; }, fd_sync() { return 0; }, fd_datasync() { return 0; },
    fd_prestat_get() { return 8; }, fd_prestat_dir_name() { return 8; },
    path_open() { return 44; }, path_filestat_get() { return 44; }, path_unlink_file() { return 44; },
    clock_time_get(clock, precision, ptr) { u64(ptr, clock === 0 ? BigInt(Date.now()) * 1000000n : BigInt(Math.floor(performance.now() * 1000000))); return 0; },
    clock_res_get(clock, ptr) { u64(ptr, 1000000); return 0; },
    random_get(ptr, len) { for (let n = 0; n < len; n += 65536) crypto.getRandomValues(bytes().subarray(ptr + n, ptr + Math.min(n + 65536, len))); return 0; },
    proc_exit(code) { exitCode = code; throw exitSignal; },
    sched_yield() { return 0; }, poll_oneoff() { return 52; }
  };
  const exitSignal = {};
  const module = await WebAssembly.compile(binary);
  for (const item of WebAssembly.Module.imports(module)) {
    if (item.module !== 'wasi_snapshot_preview1' || !wasi[item.name]) {
      throw new Error(`Unsupported browser runtime feature: ${item.module}.${item.name}`);
    }
  }
  instance = await WebAssembly.instantiate(module, {wasi_snapshot_preview1: wasi});
  if (instance.exports.asyncify_start_unwind) {
    // Allocate through libc so C's malloc cannot reuse the suspended call stack.
    asyncStack = instance.exports.malloc(1024 * 1024 + 8);
    if (!asyncStack) throw new Error('Not enough memory for terminal input.');
    u32(asyncStack, asyncStack + 8); u32(asyncStack + 4, asyncStack + 8 + 1024 * 1024);
  }
  try {
    for (;;) {
      try { instance.exports._start(); } catch (e) { if (e !== exitSignal) throw e; }
      if (instance.exports.asyncify_get_state?.() !== 1) return exitCode;
      instance.exports.asyncify_stop_unwind();
      resolvedRead = await pendingRead; pendingRead = null;
      instance.exports.asyncify_start_rewind(asyncStack);
    }
  } finally { if (asyncStack) instance.exports.free(asyncStack); }
}
