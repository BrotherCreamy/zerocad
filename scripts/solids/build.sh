#!/usr/bin/env bash
# npm run build:solids — NVIDIA's SMLib (usd-brep, Apache-2.0) to WebAssembly,
# from pinned source, into src/solids/smlib-gen/ (gitignored, like the
# solver's src/kernel/wasm-gen/). docs/plans/solids-kernel.md.
#
#   bash scripts/solids/build.sh            # fetch what is missing, build -O2
#   OPT=-Oz bash scripts/solids/build.sh    # smaller, ~45% slower (measured in the spike)
#
# Everything it downloads goes under $SOLIDS_CACHE (default .solids-cache/,
# gitignored): the usd-brep checkout at the pinned commit, emsdk at the pinned
# release, and one object file per SMLib source. Objects are rebuilt only when
# their source or the compile flags change, so a second run only relinks
# (about 1.5 min; a cold build is about 15 min on a 4-core box). The Pages
# workflow caches the same directory by the pins.
#
# Already have them? SMLIB_SRC=<usd-brep checkout> and EMSDK=<emsdk dir,
# with the pinned version installed> skip the downloads; SOLIDS_OBJ=<dir>
# reuses an object directory. The checkout is then trusted to be at the pin —
# its VERSION is checked, its commit cannot be when it is not a git checkout.
#
# Why no premake, Packman, TBB or OpenUSD: upstream builds with premake +
# Packman (NVIDIA's package server) and links TBB and OpenUSD. None of that is
# needed for the geometry: SMLib and SM_API are plain C++17, TBB is only
# reached under `SM_USE_TBB`, which nothing defines, and threads only through
# pthread TLS, which Emscripten stubs for a single thread. So this compiles the
# two directories' sources directly and links them with our C glue
# (glue.cpp) — no premake, no Packman, no USD.
#
# The defines are upstream's Linux release set (premake5.lua) plus its
# `SMLIB_NO_DEBUG_GFX_CHECK` pair, which strips the debug-draw code a browser
# could never use. `-ffp-contract=off` is upstream's, for identical rounding
# across platforms. SMLib catches no exceptions anywhere (no `catch` in SMLib
# or SM_API) and throws only `std::bad_alloc` when its allocator fails
# (`SM_USE_EXCEPTIONS`, SmConfig.h / SmMemory.h). So the build keeps
# Emscripten's default, exception *catching* disabled: a throw aborts, which is
# what an uncaught throw does natively too, and no wasm exception-handling
# proposal is needed at all — which matters for older iOS Safari. An abort is
# a dead module; the Worker that holds it says so and is replaced
# (src/solids/client.ts).
set -euo pipefail

# ---- the pins: change one, and CI's cache key changes with it ---------------
USD_BREP_URL=https://github.com/NVIDIA-Omniverse/usd-brep
USD_BREP_COMMIT=3fd5b9548d19aa8c12c29bc9637a96d42a06f8a5   # VERSION 1.0.1
USD_BREP_VERSION=1.0.1
EMSDK_URL=https://github.com/emscripten-core/emsdk
EMSDK_VERSION=4.0.15

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
CACHE=${SOLIDS_CACHE:-$ROOT/.solids-cache}
OPT=${OPT:--O2}
OUT=${SOLIDS_OUT:-$ROOT/src/solids/smlib-gen}
mkdir -p "$CACHE"

if [[ "${1:-}" == "--pins" ]]; then
  # What CI keys its cache by: the pins, the flags and this recipe.
  echo "usd-brep=$USD_BREP_COMMIT emsdk=$EMSDK_VERSION opt=$OPT"
  exit 0
fi

# ---- sources ----------------------------------------------------------------
SRC=${SMLIB_SRC:-$CACHE/usd-brep}
if [[ -z "${SMLIB_SRC:-}" && ! -f "$SRC/VERSION" ]]; then
  echo "fetching usd-brep $USD_BREP_COMMIT"
  rm -rf "$SRC" && mkdir -p "$SRC"
  git -C "$SRC" init -q
  git -C "$SRC" fetch -q --depth 1 "$USD_BREP_URL" "$USD_BREP_COMMIT"
  git -C "$SRC" checkout -q FETCH_HEAD
fi
if [[ -d "$SRC/.git" ]]; then
  at=$(git -C "$SRC" rev-parse HEAD)
  [[ "$at" == "$USD_BREP_COMMIT" ]] || { echo "usd-brep at $at, not the pinned $USD_BREP_COMMIT" >&2; exit 1; }
fi
[[ "$(tr -d '[:space:]' < "$SRC/VERSION")" == "$USD_BREP_VERSION" ]] \
  || { echo "usd-brep VERSION is not $USD_BREP_VERSION" >&2; exit 1; }

EMSDK_DIR=${EMSDK:-$CACHE/emsdk}
if [[ -z "${EMSDK:-}" && ! -x "$EMSDK_DIR/upstream/emscripten/em++" ]]; then
  echo "fetching emsdk $EMSDK_VERSION"
  rm -rf "$EMSDK_DIR"
  git clone -q --depth 1 --branch "$EMSDK_VERSION" "$EMSDK_URL" "$EMSDK_DIR"
  "$EMSDK_DIR/emsdk" install "$EMSDK_VERSION" >/dev/null
  "$EMSDK_DIR/emsdk" activate "$EMSDK_VERSION" >/dev/null
fi
EMXX="$EMSDK_DIR/upstream/emscripten/em++"
[[ -x "$EMXX" ]] || { echo "no em++ under $EMSDK_DIR — install emsdk $EMSDK_VERSION there" >&2; exit 1; }
# emsdk's own node and python are what em++ wants; its env script is the documented way to get them.
export EMSDK_QUIET=1
# shellcheck disable=SC1091
. "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1 || true

LIB="$SRC/source/SMLib"
API="$SRC/source/SM_API"

# ---- compile: one object per source, $JOBS at a time --------------------------
CFLAGS=(-std=c++17 "$OPT" -DNDEBUG -DNOMINMAX -DSM_NO_DEBUG_CODE -DSM_NO_GFX_OUTPUT_CODE
  -ffp-contract=off -w)
OBJ=${SOLIDS_OBJ:-$CACHE/obj$OPT}
mkdir -p "$OBJ"
# Objects compiled with other flags are not these objects.
STAMP="$OBJ/.flags"
if [[ -f "$STAMP" && "$(cat "$STAMP")" != "${CFLAGS[*]} emsdk=$EMSDK_VERSION" ]]; then
  echo "compile flags changed — rebuilding every object"
  rm -f "$OBJ"/*.o
fi
echo "${CFLAGS[*]} emsdk=$EMSDK_VERSION" > "$STAMP"

# Both directories have a `StdAfx.h`, so each compiles with its own include
# directory first, as upstream's premake does (SM_API's sources need SM_API's).
export LIBINC="-I$LIB/inc -I$API/inc" APIINC="-I$API/inc -I$LIB/inc"
compile() {
  local src=$1 obj
  obj="$OBJ/$(basename "$(dirname "$(dirname "$src")")")_$(basename "${src%.cpp}").o"
  if [[ ! -f "$obj" || "$src" -nt "$obj" ]]; then
    local inc=$LIBINC
    [[ "$src" == */SM_API/* ]] && inc=$APIINC
    # shellcheck disable=SC2086
    "$EMXX" "${CFLAGS[@]}" $inc -c "$src" -o "$obj"
  fi
}
export -f compile
export EMXX OBJ
export CFLAGS_STR="${CFLAGS[*]}"
t0=$(date +%s)
ls "$LIB"/src/*.cpp "$API"/src/*.cpp | grep -v 'StdAfx.cpp' \
  | xargs -P "${JOBS:-4}" -I{} bash -c 'IFS=" " read -r -a CFLAGS <<<"$CFLAGS_STR"; compile "$1"' _ {}
echo "compiled in $(( $(date +%s) - t0 ))s"

# ---- link ---------------------------------------------------------------------
mkdir -p "$OUT"
# shellcheck disable=SC2086
mkdir -p "$OBJ.glue"
"$EMXX" "${CFLAGS[@]}" $APIINC -c "$HERE/glue.cpp" -o "$OBJ.glue/glue.o"

# A Worker or Node imports it as an ES module. Memory grows (a B-rep's size is
# not known in advance) up to a ceiling well under what iOS Safari reliably
# gives a tab (300 MB to 1 GB, per WebKit's bug tracker; the spike's
# Findings): past it an allocation fails, SMLib's bad_alloc aborts the module,
# and the Worker is replaced — a refusal, not a killed tab. The client recycles
# the Worker long before (src/solids/client.ts, RECYCLE_BYTES).
"$EMXX" "$OPT" "$OBJ"/*.o "$OBJ.glue/glue.o" -o "$OUT/smlib.mjs" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -sMAXIMUM_MEMORY=536870912 -sSTACK_SIZE=4194304 \
  -sEXPORTED_FUNCTIONS=@"$HERE/exports.txt" \
  -sEXPORTED_RUNTIME_METHODS=HEAPF64,HEAP32,HEAPU8,UTF8ToString \
  -sFILESYSTEM=0

# Apache-2.0 §4: the licence goes with every copy of the work.
cp "$SRC/LICENSE" "$OUT/LICENSE"
printf 'usd-brep %s (%s)\nemsdk %s\n%s\n' "$USD_BREP_COMMIT" "$USD_BREP_VERSION" "$EMSDK_VERSION" "$OPT" > "$OUT/BUILD"
ls -l "$OUT"
