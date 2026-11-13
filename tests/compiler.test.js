import test from 'node:test';
import assert from 'node:assert/strict';
import {commands, runClang} from '../public/toolchain/bundle.js';
import {runWasi} from '../public/wasi.js';

let diagnostics = '';
async function compile(files, sources = ['main.c']) {
  diagnostics = '';
  const result = await commands.clang(['-std=c17', '-Wall', '-Wextra', '-O0', ...sources, '-lm', '-o', 'main.wasm'], files, {
    decodeASCII: false, stdout: () => {}, stderr: bytes => { if (bytes) diagnostics += new TextDecoder().decode(bytes); }
  });
  assert.ok(result['main.wasm'] instanceof Uint8Array);
  return result['main.wasm'];
}
async function execute(binary, options = {}) {
  let stdout = '', stderr = '';
  const code = await runWasi(binary, {...options, onOutput: (stream, bytes) => { if (stream === 'stdout') stdout += new TextDecoder().decode(bytes); else stderr += new TextDecoder().decode(bytes); }});
  return {code, stdout, stderr};
}
test('real compiler and browser WASI runtime', async t => {
  await runClang(null, {}, {fetchProgress: () => {}});
  await t.test('hello world with Unicode', async () => {
    const binary = await compile({'main.c': '#include <stdio.h>\nint main(void) { puts("Hello, Jean! — C works"); return 0; }'});
    assert.deepEqual(await execute(binary), {code: 0, stdout: 'Hello, Jean! — C works\n', stderr: ''});
  });
  await t.test('scanf, fgets, math, arrays and malloc', async () => {
    const binary = await compile({'main.c': '#include <stdio.h>\n#include <stdlib.h>\n#include <math.h>\nint main(void) { int n; char word[40]; if(scanf("%d %39s", &n, word)!=2) return 3; int *p=malloc(sizeof(int)*2); if(!p)return 4; p[0]=n*2; printf("%s %d %.1f\\n",word,p[0],sqrt((double)n)); free(p); return 0; }'});
    assert.equal((await execute(binary, {stdin: '9 Jean\n'})).stdout, 'Jean 18 3.0\n');
  });
  await t.test('live terminal input callback and EOF', async () => {
    const binary = await compile({'main.c': '#include <stdio.h>\nint main(void){char s[20];while(fgets(s,sizeof s,stdin))printf("Read: %s",s);return 0;}'});
    const lines = ['hello\n', 'again\n'];
    const result = await execute(binary, {readInput: () => new TextEncoder().encode(lines.shift() || '')});
    assert.equal(result.stdout, 'Read: hello\nRead: again\n');
  });
  await t.test('multiple source files and local headers', async () => {
    const binary = await compile({'main.c': '#include <stdio.h>\n#include "sum.h"\nint main(void){printf("%d\\n",sum(4,5));}', 'sum.h': 'int sum(int a,int b);', 'sum.c': '#include "sum.h"\nint sum(int a,int b){return a+b;}'}, ['main.c', 'sum.c']);
    assert.equal((await execute(binary)).stdout, '9\n');
  });
  await t.test('arguments, stderr and nonzero exit code', async () => {
    const binary = await compile({'main.c': '#include <stdio.h>\nint main(int argc,char **argv){fprintf(stderr,"problem\\n");printf("%d %s\\n",argc,argv[1]);return 7;}'});
    assert.deepEqual(await execute(binary, {args: ['hello world']}), {code: 7, stdout: '2 hello world\n', stderr: 'problem\n'});
  });
  await t.test('invalid C produces a compiler diagnostic', async () => {
    await assert.rejects(compile({'main.c': '#include <stdio.h>\nint main(void){printf("missing semicolon") return 0;}'}));
    assert.match(diagnostics, /error: expected ';'/);
  });
});
