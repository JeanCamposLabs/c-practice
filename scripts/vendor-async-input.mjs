import {readFile, writeFile, copyFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
const root = new URL('../', import.meta.url);
const source = await readFile(new URL('node_modules/binaryen/index.js', root));
await writeFile(new URL('public/toolchain/binaryen.js.gz', root), gzipSync(source, {level: 9}));
await copyFile(new URL('node_modules/binaryen/LICENSE', root), new URL('public/toolchain/LICENSE-BINARYEN.txt', root));
