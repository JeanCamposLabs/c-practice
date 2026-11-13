import test from 'node:test';
import assert from 'node:assert/strict';
import {commands, runClang} from '../public/toolchain/bundle.js';
import {runWasi} from '../public/wasi.js';
import {prepareAsyncInput} from '../public/async-input.js';

let diagnostics = '';
async function compile(files, sources = ['main.c']) {
  diagnostics = '';
  const result = await commands.clang(['-std=c17', '-Wall', '-Wextra', '-O0', ...sources, '-lm', '-Wl,--export=malloc', '-Wl,--export=free', '-Wl,--export=fflush', '-o', 'main.wasm'], files, {
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
  await t.test('two fgets calls really pause without shared memory or replaying output', {timeout: 30000}, async () => {
    const binary = await prepareAsyncInput(await compile({'main.c': '#include <stdio.h>\nint main(void){char name[100],date[11];printf("Full name: ");if(!fgets(name,sizeof name,stdin))return 1;printf("Hello %sBirth date: ",name);if(!fgets(date,sizeof date,stdin))return 2;printf("Date: %s\\n",date);return 0;}'}));
    let stdout = '', finished = false, inputReady;
    const replies = [];
    const nextRead = () => new Promise(resolve => { inputReady = resolve; });
    const firstRead = nextRead();
    const running = runWasi(binary, {
      readInput: () => new Promise(resolve => { replies.push(resolve); inputReady(); }),
      onOutput: (stream, bytes) => { if (stream === 'stdout') stdout += new TextDecoder().decode(bytes); }
    }).then(code => { finished = true; return code; });
    await firstRead;
    assert.equal(finished, false); assert.equal(stdout, 'Full name: ');
    const secondRead = nextRead(); replies.shift()(new TextEncoder().encode('Test Person\n'));
    await secondRead;
    assert.equal(finished, false); assert.equal(stdout, 'Full name: Hello Test Person\nBirth date: ');
    replies.shift()(new TextEncoder().encode('01/02/2000\n'));
    assert.equal(await running, 0);
    assert.equal(stdout, 'Full name: Hello Test Person\nBirth date: Date: 01/02/2000\n');
  });
  await t.test('async input preserves heap and indirect call state across reads and EOF', async () => {
    const binary = await prepareAsyncInput(await compile({'main.c': '#include <stdio.h>\n#include <stdlib.h>\nint read_line(char*s,int n){return fgets(s,n,stdin)!=NULL;}\nint main(void){char *p=malloc(200000);if(!p)return 8;p[0]=42;p[199999]=24;char s[4];int count=0;int(*read)(char*,int)=read_line;while(read(s,sizeof s)){printf("%d:%s",++count,s);}printf("heap=%d,%d\\n",p[0],p[199999]);free(p);return 0;}'}));
    const lines = ['abcdef\n', '']; let requests = 0;
    const result = await execute(binary, {readInput: async () => { requests++; await Promise.resolve(); return new TextEncoder().encode(lines.shift()); }});
    assert.equal(result.code, 0); assert.equal(result.stdout, '1:abc2:def3:\nheap=42,24\n'); assert.equal(requests, 2);
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
