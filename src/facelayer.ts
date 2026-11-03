// Drawing a solid's faces: by a depth buffer where the browser has WebGL, by
// the painter's where it has not.
//
// faces.ts says what the faces are — planar outlines in the world, an outward
// normal, a headlight shade — and nothing about pixels. This file is the two
// ways of turning that into a picture, side by side so they can be measured
// against each other (`test/e2e/depth.measure.ts`), and it is the only place
// either is chosen: `createFaceLayer` returns null where WebGL is missing, and
// the host paints instead.
//
// **The depth layer** draws into its own canvas under the 2D one, through the
// view's own orthographic projection (`clipMatrix`), with a depth test — so
// which face is in front is answered per pixel, exactly, and needs no order at
// all. A face whose one outline is convex is its own triangle fan and goes in
// one batched draw with every other such face: every wall quad and every piece
// of a swept strip. Anything else — a cap, with its holes and islands — is
// filled even-odd by the **stencil method**, no triangulation: a fan from the
// first vertex of each outline inverts one stencil bit with no colour written,
// so a pixel ends odd exactly where even-odd says it is inside; the same fans
// again then write colour and depth only where the bit is odd, and clear it as
// they go so the next cap starts clean. Exact for every outline faces.ts
// produces, and needing nothing faces.ts does not already hand over.
//
// **The painter's** is the 2D canvas path the app had before, kept as the
// fallback: faces far to near by centroid (`facesToDraw`), each filled
// even-odd and stroked a hair wide in its own colour (a curved wall's
// neighbouring pieces share an edge exactly, and anti-aliasing each against
// the background alone leaves a seam between them — fainter with the stroke,
// not gone; the depth layer's multisampling has none). Its sort is the plain
// one, and wrong where any sort is; see `facesToDraw`.
//
// **Both draw the solid's edges with it**: a fine dark line (`SOLID_EDGE`,
// `SOLID_EDGE_PX`) along every visible face's `edges`, as part of the solid —
// so a box reads as a box where two faces shade alike, now that the shaded
// view leaves a solid's own edges quiet in the sketch drawing (quiet.ts). The
// depth layer draws each edge as a thin quad square to the line of sight (GL's
// own lines are one device pixel, or whatever width the driver allows),
// depth-tested against faces pushed back by a polygon offset, so an edge on a
// face is in front of it and an edge behind another face is not drawn; the
// painter's strokes a face's edges right after filling it, so a nearer face
// painted later covers them.
//
// Neither ever picks: the depth canvas takes no pointer events, and the
// painter's draws into a canvas whose listeners ask the entities, not this.

import type { Model } from "./model.ts";
import { SOLID_EDGE, SOLID_EDGE_PX, faceColour, faceRGB, facesToDraw, visibleFaces } from "./faces.ts";
import { clipMatrix, viewAxes, type View } from "./view.ts";
import { cross3, dot3, sub3 } from "./vec3.ts";

/**
 * The painter's: every visible face, far to near, filled into a 2D context
 * already transformed to CSS pixels. What draws solids where there is no
 * WebGL.
 */
export function paintFaces(g: CanvasRenderingContext2D, model: Model, view: View): void {
  const faces = facesToDraw(model, view);
  if (!faces.length) return;
  g.save();
  g.lineJoin = "round";
  g.lineWidth = 0.75;
  for (const face of faces) {
    g.beginPath();
    for (const outline of face.outlines) {
      g.moveTo(...outline[0]);
      for (const p of outline.slice(1)) g.lineTo(...p);
      g.closePath();
    }
    const colour = faceColour(face.shade);
    g.fillStyle = colour;
    g.fill("evenodd");
    g.strokeStyle = colour;
    g.stroke();
    if (face.edges.length) {
      g.beginPath();
      for (const edge of face.edges) {
        g.moveTo(...edge[0]);
        for (const p of edge.slice(1)) g.lineTo(...p);
      }
      g.strokeStyle = SOLID_EDGE;
      g.lineWidth = SOLID_EDGE_PX;
      g.stroke();
      g.lineWidth = 0.75;
    }
  }
  g.restore();
}

/** A face layer that draws by depth. `draw` clears and redraws the whole canvas. */
export interface FaceLayer {
  /**
   * Every visible face of every solid, through `view`, onto a canvas whose CSS
   * box is `width` × `height` (its backing store is whatever size the host
   * gave it; the projection maps onto all of it).
   */
  draw(model: Model, view: View, width: number, height: number): void;
  /** No faces at all: what a wireframe view (`view("wire")`) shows under the drawing. */
  clear(): void;
}

const VERTEX = `
attribute vec3 a_pos;
attribute vec3 a_rgb;
uniform mat4 u_clip;
varying vec3 v_rgb;
void main() {
  gl_Position = u_clip * vec4(a_pos, 1.0);
  v_rgb = a_rgb;
}`;

const FRAGMENT = `
precision mediump float;
varying vec3 v_rgb;
void main() {
  gl_FragColor = vec4(v_rgb, 1.0);
}`;

/** Floats per vertex: a position relative to the frame's anchor, and a colour. */
const STRIDE = 6;

/** `SOLID_EDGE` as the shader takes a colour. */
const EDGE_RGB = [1, 3, 5].map((i) => parseInt(SOLID_EDGE.slice(i, i + 2), 16) / 255);

/**
 * Whether a planar outline is convex and goes round once — so that a fan from
 * its first vertex covers it exactly once and nothing else, and it can skip
 * the stencil. Turning measured about its own face's normal; a star, whose
 * turns all agree but which goes round twice, is not.
 */
function convex(outline: number[][], normal: number[]): boolean {
  const n = outline.length;
  let sign = 0;
  let turning = 0;
  for (let i = 0; i < n; i++) {
    const a = sub3(outline[(i + 1) % n], outline[i]);
    const b = sub3(outline[(i + 2) % n], outline[(i + 1) % n]);
    const s = dot3(cross3(a, b), normal);
    const c = dot3(a, b);
    if (Math.abs(s) > 1e-12 * Math.max(1, Math.abs(c))) {
      if (sign && Math.sign(s) !== sign) return false;
      sign = Math.sign(s);
    }
    turning += Math.atan2(s, c);
  }
  return Math.abs(turning) < 3 * Math.PI;
}

/**
 * The depth layer on `canvas`, or null where it cannot be had — no WebGL, no
 * stencil buffer, a shader the driver refuses. Null is the one signal the host
 * reads to fall back to `paintFaces`.
 */
export function createFaceLayer(canvas: HTMLCanvasElement): FaceLayer | null {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    depth: true,
    stencil: true,
    antialias: true,
    premultipliedAlpha: true,
    // Kept so the picture can be read back after it is shown — what the e2e
    // suite's pixel reads and the measurement depend on. The cost is a copy
    // a frame, inside the frame times the measurement reports.
    preserveDrawingBuffer: true,
  });
  if (!gl || !gl.getContextAttributes()?.stencil) return null;

  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let loc = { pos: -1, rgb: -1, clip: null as WebGLUniformLocation | null };

  /** Everything the context owns, made again — at the start and after a lost context comes back. */
  function setUp(): boolean {
    const shader = (type: number, src: string) => {
      const s = gl!.createShader(type)!;
      gl!.shaderSource(s, src);
      gl!.compileShader(s);
      return gl!.getShaderParameter(s, gl!.COMPILE_STATUS) ? s : null;
    };
    const vs = shader(gl!.VERTEX_SHADER, VERTEX);
    const fs = shader(gl!.FRAGMENT_SHADER, FRAGMENT);
    if (!vs || !fs) return false;
    const p = gl!.createProgram()!;
    gl!.attachShader(p, vs);
    gl!.attachShader(p, fs);
    gl!.linkProgram(p);
    if (!gl!.getProgramParameter(p, gl!.LINK_STATUS)) return false;
    program = p;
    buffer = gl!.createBuffer();
    loc = { pos: gl!.getAttribLocation(p, "a_pos"), rgb: gl!.getAttribLocation(p, "a_rgb"), clip: gl!.getUniformLocation(p, "u_clip") };
    return true;
  }
  if (!setUp()) return null;
  // A lost context (a GPU reset, a driver update mid-session) is given back
  // only to a page that asks for it; the next frame after it is restored
  // redraws everything, since every frame does.
  canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
  canvas.addEventListener("webglcontextrestored", () => { setUp(); });

  /** Everything back to empty — transparent, far, stencil zero — whatever the last frame left set. */
  const clearAll = () => {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clearStencil(0);
    gl.stencilMask(0xff);
    gl.depthMask(true);
    gl.colorMask(true, true, true, true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  };

  return {
    clear() {
      if (gl.isContextLost()) return;
      clearAll();
    },
    draw(model, view, width, height) {
      if (gl.isContextLost() || !program) return;
      clearAll();

      const faces = visibleFaces(model, view);
      if (!faces.length) return;

      // The depth range is the faces' own, each frame, with a margin so the
      // nearest and farthest points are not on the clipping planes.
      const { right, up, toward } = viewAxes(view);
      let lo = Infinity, hi = -Infinity;
      for (const f of faces) for (const o of f.outlines) for (const p of o) {
        const d = dot3(p, toward);
        if (d < lo) lo = d;
        if (d > hi) hi = d;
      }
      const pad = Math.max(1e-3 * (hi - lo), 1e-6 * Math.max(1, Math.abs(lo), Math.abs(hi)));
      // The anchor: the world point drawn at the middle of the canvas, at the
      // middle of the depth range — near everything on screen.
      const [a, b] = [(width / 2 - view.ox) / view.scale, (view.oy - height / 2) / view.scale];
      const mid = (lo + hi) / 2;
      const anchor = [0, 1, 2].map((i) => a * right[i] + b * up[i] + mid * toward[i]);

      // One buffer a frame: the convex faces' fans first, as one draw, then
      // each other face's fans as a run of its own.
      const fan = (out: number[], o: number[][], rgb: number[]) => {
        const put = (p: number[]) => out.push(p[0] - anchor[0], p[1] - anchor[1], p[2] - anchor[2], rgb[0], rgb[1], rgb[2]);
        for (let k = 1; k + 1 < o.length; k++) { put(o[0]); put(o[k]); put(o[k + 1]); }
      };
      const batch: number[] = [];
      const caps: { data: number[] }[] = [];
      for (const f of faces) {
        const rgb = faceRGB(f.shade).map((c) => c / 255);
        if (f.outlines.length === 1 && convex(f.outlines[0], f.normal)) fan(batch, f.outlines[0], rgb);
        else {
          const data: number[] = [];
          for (const o of f.outlines) fan(data, o, rgb);
          caps.push({ data });
        }
      }
      // The edges: each segment a quad in the plane square to the line of
      // sight, `SOLID_EDGE_PX` wide on screen and running on half that past
      // each end so neighbouring segments close their joints. Offset within
      // that plane only, so every corner keeps its segment's depth.
      const edges: number[] = [];
      const half = SOLID_EDGE_PX / 2 / view.scale;
      const put = (p: number[]) => edges.push(p[0] - anchor[0], p[1] - anchor[1], p[2] - anchor[2], EDGE_RGB[0], EDGE_RGB[1], EDGE_RGB[2]);
      for (const f of faces) for (const path of f.edges) for (let k = 0; k + 1 < path.length; k++) {
        const [p, q] = [path[k], path[k + 1]];
        const d = sub3(q, p);
        const [dx, dy] = [dot3(d, right), dot3(d, up)];
        const len = Math.hypot(dx, dy);
        if (!(len > 1e-12)) continue; // seen end-on: nothing of it to draw but a dot its neighbours already end at
        const [ux, uy] = [dx / len, dy / len];
        const along = [0, 1, 2].map((i) => (ux * right[i] + uy * up[i]) * half);
        const across = [0, 1, 2].map((i) => (-uy * right[i] + ux * up[i]) * half);
        const corner = (o: number[], sa: number, sc: number) => o.map((c, i) => c + sa * along[i] + sc * across[i]);
        const [a0, a1, b0, b1] = [corner(p, -1, -1), corner(p, -1, 1), corner(q, 1, -1), corner(q, 1, 1)];
        for (const v of [a0, b0, b1, a0, b1, a1]) put(v);
      }

      const all = new Float32Array(batch.length + caps.reduce((n, c) => n + c.data.length, 0) + edges.length);
      all.set(batch, 0);
      const runs: [number, number][] = [];
      let at = batch.length;
      for (const c of caps) {
        all.set(c.data, at);
        runs.push([at / STRIDE, c.data.length / STRIDE]);
        at += c.data.length;
      }
      all.set(edges, at);
      const edgeRun: [number, number] = [at / STRIDE, edges.length / STRIDE];

      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, all, gl.STREAM_DRAW);
      gl.enableVertexAttribArray(loc.pos);
      gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, STRIDE * 4, 0);
      gl.enableVertexAttribArray(loc.rgb);
      gl.vertexAttribPointer(loc.rgb, 3, gl.FLOAT, false, STRIDE * 4, 12);
      gl.uniformMatrix4fv(loc.clip, false, new Float32Array(clipMatrix(view, width, height, [lo - pad, hi + pad], anchor)));

      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.disable(gl.CULL_FACE); // culling is faces.ts's, by the outward normal; a fan's winding means nothing
      gl.disable(gl.BLEND);
      gl.disable(gl.STENCIL_TEST);
      // Faces a little back from where they are, by their own slope, so the
      // edges they bound — which lie in them, and reach half a line's width
      // across them — pass the depth test against them: enough slope for that
      // half-width in device pixels, and one more. A face in front of an edge
      // by more than that still hides it.
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1 + (SOLID_EDGE_PX / 2) * (canvas.width / Math.max(1, width)), 2);
      if (batch.length) gl.drawArrays(gl.TRIANGLES, 0, batch.length / STRIDE);

      gl.enable(gl.STENCIL_TEST);
      for (const [first, count] of runs) {
        // Parity: every fan triangle inverts the bit, depth ignored — the
        // fans are the face's own plane, so a test here could only lose
        // triangles to rounding and break the count.
        gl.colorMask(false, false, false, false);
        gl.depthMask(false);
        gl.disable(gl.DEPTH_TEST);
        gl.stencilFunc(gl.ALWAYS, 0, 1);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
        gl.drawArrays(gl.TRIANGLES, first, count);
        // Fill where odd, by depth; the bit is cleared whether the depth test
        // passes or not, so each pixel is written once and the next cap
        // starts from zero.
        gl.colorMask(true, true, true, true);
        gl.depthMask(true);
        gl.enable(gl.DEPTH_TEST);
        gl.stencilFunc(gl.EQUAL, 1, 1);
        gl.stencilOp(gl.KEEP, gl.ZERO, gl.ZERO);
        gl.drawArrays(gl.TRIANGLES, first, count);
      }
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.POLYGON_OFFSET_FILL);

      // The edges over them, where nothing nearer is. They write no depth:
      // two edges crossing should both draw.
      if (edgeRun[1]) {
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(false);
        gl.drawArrays(gl.TRIANGLES, edgeRun[0], edgeRun[1]);
        gl.depthMask(true);
        gl.depthFunc(gl.LESS);
      }
    },
  };
}
