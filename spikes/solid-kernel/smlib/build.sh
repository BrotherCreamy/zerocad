#!/usr/bin/env bash
# Build NVIDIA's SMLib (usd-brep) to WebAssembly with Emscripten.
#
# The recipe, so CI can repeat it:
#   1. git clone https://github.com/NVIDIA-Omniverse/usd-brep  (pinned below)
#   2. emsdk install 4.0.15 && emsdk activate 4.0.15
#   3. bash build.sh <usd-brep checkout> <emsdk dir> <out dir> [opt]
#
# Upstream builds with premake + Packman (NVIDIA's package server) and links
# TBB and OpenUSD. None of that is needed for the geometry: SMLib and SM_API
# are plain C++17, TBB is only reached under `SM_USE_TBB`, which nothing
# defines, and threads only through pthread TLS, which Emscripten stubs for a
# single thread. So this compiles the two directories' sources directly and
# links them with our C glue (glue.cpp) — no premake, no Packman, no USD.
#
# The defines are upstream's Linux release set (premake5.lua) plus its
# `SMLIB_NO_DEBUG_GFX_CHECK` pair, which strips the debug-draw code a browser
# could never use. `-ffp-contract=off` is upstream's, for identical rounding
# across platforms. SMLib catches no exceptions anywhere (no `catch` in
# SMLib or SM_API) and throws only `std::bad_alloc` when its allocator fails
# (`SM_USE_EXCEPTIONS`, SmConfig.h / SmMemory.h). So the build keeps
# Emscripten's default, exception *catching* disabled: a throw aborts, which
# is what an uncaught throw does natively too, and no wasm exception-handling
# proposal is needed at all — which matters for older iOS Safari.
#
# Pinned upstream: 3fd5b9548d19aa8c12c29bc9637a96d42a06f8a5 (VERSION 1.0.1).
set -euo pipefail

SRC=${1:?usd-brep checkout}
EMSDK=${2:?emsdk dir}
OUT=${3:?out dir}
OPT=${4:--O2}

HERE=$(cd "$(dirname "$0")" && pwd)
EMXX="$EMSDK/upstream/emscripten/em++"
LIB="$SRC/source/SMLib"
API="$SRC/source/SM_API"

mkdir -p "$OUT/obj"

CFLAGS=(-std=c++17 "$OPT" -DNDEBUG -DNOMINMAX -DSM_NO_DEBUG_CODE -DSM_NO_GFX_OUTPUT_CODE
  -ffp-contract=off -w)
# Both directories have a `StdAfx.h`, so each compiles with its own include
# directory first, as upstream's premake does (SM_API's sources need SM_API's).
export LIBINC="-I$LIB/inc -I$API/inc" APIINC="-I$API/inc -I$LIB/inc"

# One object per source, four at a time; skip ones already built.
compile() {
  local src=$1 obj
  obj="$OUT/obj/$(basename "$(dirname "$(dirname "$src")")")_$(basename "${src%.cpp}").o"
  if [[ ! -f "$obj" || "$src" -nt "$obj" ]]; then
    local inc=$LIBINC
    [[ "$src" == */SM_API/* ]] && inc=$APIINC
    # shellcheck disable=SC2086
    "$EMXX" "${CFLAGS[@]}" $inc -c "$src" -o "$obj"
  fi
}
export -f compile
export EMXX OUT
export CFLAGS_STR="${CFLAGS[*]}"

ls "$LIB"/src/*.cpp "$API"/src/*.cpp | grep -v 'StdAfx.cpp' \
  | xargs -P "${JOBS:-4}" -I{} bash -c 'IFS=" " read -r -a CFLAGS <<<"$CFLAGS_STR"; compile "$1"' _ {}
[[ "${COMPILE_ONLY:-0}" == 1 ]] && exit 0

# shellcheck disable=SC2086
"$EMXX" "${CFLAGS[@]}" $APIINC -c "$HERE/glue.cpp" -o "$OUT/glue.o"

# A Worker or Node imports it as an ES module. Memory grows (a B-rep's size is
# not known in advance); the ceiling is left at Emscripten's default (2 GB).
"$EMXX" "$OPT" "$OUT"/obj/*.o "$OUT/glue.o" -o "$OUT/smlib.mjs" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -sSTACK_SIZE=4194304 \
  -sEXPORTED_FUNCTIONS=@"$HERE/exports.txt" \
  -sEXPORTED_RUNTIME_METHODS=HEAPF64,HEAP32,HEAPU8,UTF8ToString \
  -sFILESYSTEM=0

ls -l "$OUT/smlib.wasm" "$OUT/smlib.mjs"
