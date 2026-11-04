// Raw, gzip -9 and brotli -11 sizes of each file given — what a PWA would
// download and cache. Reads bytes; runs nothing.
//
//   node --experimental-strip-types scripts/solids/bench/sizes.ts <file>...

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

for (const f of process.argv.slice(2)) {
  const b = readFileSync(f);
  const gz = gzipSync(b, { level: 9 }).length;
  const br = brotliCompressSync(b, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: b.length },
  }).length;
  console.log(JSON.stringify({ file: basename(f), raw: b.length, gzip: gz, brotli: br }));
}
