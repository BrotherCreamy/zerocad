// SPDX-License-Identifier: Apache-2.0
//
// A C ABI over NVIDIA's SM_API for the solid-kernel spike — the whole surface
// the TypeScript side (../src/smlib.ts) calls, and nothing else is exported.
//
// Why a hand-written C layer and not embind: every call is numbers in and
// numbers out (handles, coordinates, indices), so a C ABI costs nothing to
// marshal and keeps embind's ~100 kB runtime and its type registry out of the
// wasm. A B-rep is held here behind an integer handle; the TS side never sees
// a pointer.
//
// The kernel knows nothing of ZeroCAD: no points, no names, no profile
// members. What it offers instead is a **tag** — one long per face, stored as
// an SMLib attribute (`SM_AI_USER_1`) — which the caller sets after a sweep
// and reads back after any later operation. Whether SMLib carries a tag
// through booleans and fillets (its attribute propagation, SmAttribute.h §5)
// is exactly what the spike measures.

#include <SmApiBrep.h>
#include <SmApiCurves.h>
#include <SmApiFillets.h>
#include <SmApiGeneral.h>
#include <SmApiQueries.h>

#include <SmAssertArray.h>
#include <SmAttribute.h>
#include <SmBrep.h>
#include <SmCircle.h>
#include <SmCone.h>
#include <SmCylinder.h>
#include <SmEdge.h>
#include <SmFace.h>
#include <SmLine.h>
#include <SmPlane.h>
#include <SmPoly.h>
#include <SmSphere.h>
#include <SmTorus.h>
#include <SmVertex.h>

#include <emscripten/emscripten.h>
#include <malloc.h>

#include <cmath>
#include <unordered_map>
#include <vector>

#define API extern "C" EMSCRIPTEN_KEEPALIVE

namespace {

const ULONG TAG_ID = SM_AI_USER_1;

std::vector<SmBrep*> g_breps;          // handle -> brep (null once deleted)
std::vector<SmCurve*> g_profile;       // curves of the profile being built
std::vector<float> g_meshPos;          // last tessellation: xyz per vertex
std::vector<unsigned> g_meshTri;       // i0 i1 i2 face, per triangle
std::vector<float> g_edgePts;          // last boundary sampling: xyz per point
std::vector<unsigned> g_edgeRuns;      // edge index, point count, per edge

// SMLib's success is 1000 (SM_SUCCESS), not 0; the C ABI says 0.
int st(SmApiStatus s) { return s == SM_SUCCESS ? 0 : (int)s; }

int keep(SmBrep* b) {
  g_breps.push_back(b);
  return (int)g_breps.size() - 1;
}

SmBrep* get(int h) {
  return (h >= 0 && h < (int)g_breps.size()) ? g_breps[h] : nullptr;
}

void faces(SmBrep* b, SmTArray<SmFace*>& out) { b->GetFaces(out); }
void edges(SmBrep* b, SmTArray<SmEdge*>& out) { b->GetEdges(out); }

long tagOf(const SmAObject* o) {
  const SmAttribute* a = o->FindAttribute(TAG_ID);
  const SmLongAttribute* l = dynamic_cast<const SmLongAttribute*>(a);
  return l ? l->GetValue() : -1;
}

void setTag(SmAObject* o, long tag) {
  SmAttribute* old = o->FindAttribute(TAG_ID);
  if (old) o->RemoveAttribute(old);
  o->AddAttribute(new (*SmApiGetOrCreateContext()) SmLongAttribute(TAG_ID, tag, SM_AB_COPY));
}

// Surface kinds, for the STEP exporter's question "is this an analytic face".
// Most-derived first: a cylinder is a cone is a surface of revolution.
enum Kind { K_OTHER = 0, K_PLANE = 1, K_CYLINDER = 2, K_CONE = 3, K_SPHERE = 4, K_TORUS = 5,
            K_REVOLUTION = 6, K_BSPLINE = 7 };

// a, b: a cylinder's radius; a cone's radius at v = 0 and half-angle in
// degrees; a sphere's radius; a torus's major and minor radii; for a general
// surface of revolution, what its generating curve is (1 line, 2 circle,
// 3 rational B-spline — which can be an exact arc —, 4 other) and its degree.
int kindOf(const SmSurface* s, double& a, double& b) {
  a = b = 0;
  if (dynamic_cast<const SmPlane*>(s)) return K_PLANE;
  if (auto c = dynamic_cast<const SmCylinder*>(s)) { a = c->GetRadius(); return K_CYLINDER; }
  if (auto c = dynamic_cast<const SmCone*>(s)) {
    a = c->GetRadius(0);
    b = std::atan(c->GetRadius(1) - c->GetRadius(0)) * 180 / M_PI;
    return K_CONE;
  }
  if (auto c = dynamic_cast<const SmSphere*>(s)) { a = c->GetRadius(); return K_SPHERE; }
  if (auto c = dynamic_cast<const SmTorus*>(s)) { a = c->GetMajorRadius(); b = c->GetMinorRadius(); return K_TORUS; }
  if (auto r = dynamic_cast<const SmSurfOfRevolution*>(s)) {
    const SmBSplineCurve* g = r->GetGenCurve();
    a = !g ? 0 : dynamic_cast<const SmLine*>(g) ? 1 : dynamic_cast<const SmCircle*>(g) ? 2 : g->IsRational() ? 3 : 4;
    b = g ? g->GetDegree() : 0;
    return K_REVOLUTION;
  }
  if (dynamic_cast<const SmBSplineSurface*>(s)) return K_BSPLINE;
  return K_OTHER;
}

}  // namespace

API int sm_init() {
  SmApiCreateContext();
  return SmApiGetOrCreateContext() != nullptr;
}

// ---- profiles: curves in the local XY plane, z = 0 -------------------------

API void sm_profile_clear() {
  for (SmCurve* c : g_profile) delete c;
  g_profile.clear();
}

API int sm_profile_line(double x0, double y0, double x1, double y1) {
  SmLine* l = nullptr;
  SmApiStatus s = SmApiCreateLineSegment(SmPoint3d(x0, y0, 0), SmPoint3d(x1, y1, 0), l);
  if (s != SM_SUCCESS || !l) return -(int)s - 1;
  g_profile.push_back(l);
  return (int)g_profile.size() - 1;
}

// Counter-clockwise from a0 to a1, in degrees.
API int sm_profile_arc(double cx, double cy, double r, double a0, double a1) {
  SmBSplineCurve* c = nullptr;
  SmApiStatus s = SmApiCreateArc(SmPoint3d(cx, cy, 0), r, a0, a1, c);
  if (s != SM_SUCCESS || !c) return -(int)s - 1;
  g_profile.push_back(c);
  return (int)g_profile.size() - 1;
}

API int sm_profile_circle(double cx, double cy, double r) {
  SmCircle* c = nullptr;
  SmApiStatus s = SmApiCreateCircle(SmPoint3d(cx, cy, 0), r, c);
  if (s != SM_SUCCESS || !c) return -(int)s - 1;
  g_profile.push_back(c);
  return (int)g_profile.size() - 1;
}

static SmTArray<SmCurve*> profileArray() {
  SmTArray<SmCurve*> a;
  for (SmCurve* c : g_profile) a.Add(c);
  return a;
}

// ---- solids -----------------------------------------------------------------

// Extrude the profile along +z (dist may be negative). Handle, or -status-1.
API int sm_extrude(double dist) {
  SmTArray<SmCurve*> a = profileArray();
  SmBrep* r = nullptr;
  SmApiStatus s = SmApiCreateLinearSweep(a, SmVector3d(0, 0, 1), dist, TRUE, r);
  if (s != SM_SUCCESS || !r) return -(int)s - 1;
  return keep(r);
}

API int sm_revolve(double px, double py, double pz, double ax, double ay, double az, double deg) {
  SmTArray<SmCurve*> a = profileArray();
  SmBrep* r = nullptr;
  SmApiStatus s = SmApiCreateRotationalSweep(a, SmPoint3d(px, py, pz), SmVector3d(ax, ay, az), deg, TRUE, r);
  if (s != SM_SUCCESS || !r) return -(int)s - 1;
  return keep(r);
}

// Move a brep from the local frame to one with this origin and these axes.
API int sm_place(int h, double ox, double oy, double oz, double xx, double xy, double xz,
                 double yx, double yy, double yz) {
  SmBrep* b = get(h);
  if (!b) return -1;
  SmAxis2Placement p(ox, oy, oz, xx, xy, xz, yx, yy, yz);
  return st(SmApiTransform(b, p));
}

API int sm_copy(int h) {
  SmBrep* b = get(h);
  SmBrep* r = nullptr;
  if (!b || SmApiBrepCopy(b, r) != SM_SUCCESS || !r) return -1;
  return keep(r);
}

API void sm_delete(int h) {
  SmBrep* b = get(h);
  if (b) { delete b; g_breps[h] = nullptr; }
}

// op: 1 union, 2 intersection, 3 difference (SmBooleanOperationType).
// Consumes both operands on success (the result reuses h1). On failure the
// operands are left allocated but SMLib may have modified them.
API int sm_boolean(int h1, int h2, int op) {
  SmBrep* a = get(h1);
  SmBrep* b = get(h2);
  if (!a || !b) return -1;
  SmBrep* r = nullptr;
  SmApiStatus s = SmApiBoolean(a, b, (SmBooleanOperationType)op, r);
  if (s != SM_SUCCESS || !r) return -(int)s - 1;
  g_breps[h2] = nullptr;  // deleted by SMLib on success
  g_breps[h1] = r;
  return h1;
}

// xsect: 1 circular fillet, 0 linear (a chamfer). In place.
API int sm_fillet(int h, const int* idx, int n, double r, int xsect) {
  SmBrep* b = get(h);
  if (!b) return -1;
  SmTArray<SmEdge*> all, chosen;
  edges(b, all);
  for (int i = 0; i < n; i++) {
    if (idx[i] < 0 || idx[i] >= (int)all.GetSize()) return -2;
    chosen.Add(all[idx[i]]);
  }
  return st(SmApiFilletEdges(b, chosen, r, (ULONG)xsect, 1, 1.0));
}

// Hollow the solid to wall thickness `dist`, opening the listed faces. New handle.
API int sm_shell(int h, const int* idx, int n, double dist) {
  SmBrep* b = get(h);
  if (!b) return -1;
  SmTArray<SmFace*> all;
  faces(b, all);
  SmTArray<const SmFace*> open;
  for (int i = 0; i < n; i++) {
    if (idx[i] < 0 || idx[i] >= (int)all.GetSize()) return -2;
    open.Add(all[idx[i]]);
  }
  SmBrep* r = nullptr;
  SmApiStatus s = SmApiShellBrepFull(b, dist, TRUE, TRUE, FALSE, open, r);
  if (s != SM_SUCCESS || !r) return -(int)s - 1;
  return keep(r);
}

// ---- queries ----------------------------------------------------------------

API double sm_volume(int h) {
  SmBrep* b = get(h);
  double v = NAN;
  if (b && SmApiBrepComputeVolume(b, 1e-9, v) != SM_SUCCESS) v = NAN;
  return v;
}

API int sm_bbox(int h, double* out) {
  SmBrep* b = get(h);
  if (!b) return -1;
  SmPoint3d lo, hi;
  SmApiStatus s = SmApiBrepBoundingBox(b, TRUE, lo, hi);
  out[0] = lo.x; out[1] = lo.y; out[2] = lo.z;
  out[3] = hi.x; out[4] = hi.y; out[5] = hi.z;
  return st(s);
}

API int sm_is_manifold(int h) {
  SmBrep* b = get(h);
  SmBoolean m = FALSE;
  if (!b || SmApiBrepIsManifoldSolid(b, m) != SM_SUCCESS) return -1;
  return m ? 1 : 0;
}

// The kernel's own consistency checks (what upstream's _smlib_dev.assert_valid
// runs). Number of failed reports; 0 is valid.
API int sm_check(int h) {
  SmBrep* b = get(h);
  if (!b) return -1;
  SmAssertArray failures;
  SmBoolean ok = b->AssertValid(&failures, SM_LEVEL_2, SM_WALK, nullptr);
  int failed = 0;
  for (ULONG i = 0; i < failures.GetSize(); i++) {
    const SmAssertReport* r = failures.GetAt(i);
    if (r && !r->m_bOK) failed++;
  }
  return ok ? failed : (failed ? failed : 1);
}

// kind: 0 faces, 1 edges, 2 vertices
API int sm_count(int h, int kind) {
  SmBrep* b = get(h);
  if (!b) return -1;
  if (kind == 0) { SmTArray<SmFace*> f; faces(b, f); return (int)f.GetSize(); }
  if (kind == 1) { SmTArray<SmEdge*> e; edges(b, e); return (int)e.GetSize(); }
  SmTArray<SmVertex*> v; b->GetVertices(v); return (int)v.GetSize();
}

// Per face, 8 doubles: kind, tag, internal point xyz, param a, param b, area.
API int sm_faces(int h, double* out, int cap) {
  SmBrep* b = get(h);
  if (!b) return -1;
  SmTArray<SmFace*> f;
  faces(b, f);
  int n = (int)f.GetSize();
  for (int i = 0; i < n && (i + 1) * 8 <= cap; i++) {
    double* o = out + i * 8;
    double a, c;
    o[0] = kindOf(f[i]->GetSurface(), a, c);
    o[1] = (double)tagOf(f[i]);
    SmPoint3d p(NAN, NAN, NAN);
    SmApiFaceInternalPoint(f[i], p);
    o[2] = p.x; o[3] = p.y; o[4] = p.z;
    o[5] = a; o[6] = c;
    double area = NAN;
    SmApiFaceComputeArea(f[i], 1e-6, area);
    o[7] = area;
  }
  return n;
}

// Distance from a point to face i (trimmed), or NaN.
API double sm_face_distance(int h, int i, double x, double y, double z) {
  SmBrep* b = get(h);
  if (!b) return NAN;
  SmTArray<SmFace*> f;
  faces(b, f);
  if (i < 0 || i >= (int)f.GetSize()) return NAN;
  SmPoint3d q;
  double d = NAN;
  if (SmApiFaceClosestPoint(f[i], SmPoint3d(x, y, z), q, d) != SM_SUCCESS) return NAN;
  return d;
}

API int sm_tag_face(int h, int i, int tag) {
  SmBrep* b = get(h);
  if (!b) return -1;
  SmTArray<SmFace*> f;
  faces(b, f);
  if (i < 0 || i >= (int)f.GetSize()) return -2;
  setTag(f[i], tag);
  return 0;
}

// Per edge, 12 doubles: face index 0, face index 1 (-1 if none), start xyz,
// end xyz, mid xyz, tag.
API int sm_edges(int h, double* out, int cap) {
  SmBrep* b = get(h);
  if (!b) return -1;
  SmTArray<SmFace*> f;
  faces(b, f);
  SmTArray<SmEdge*> e;
  edges(b, e);
  int n = (int)e.GetSize();
  for (int i = 0; i < n && (i + 1) * 12 <= cap; i++) {
    double* o = out + i * 12;
    SmTArray<SmFace*> ef;
    e[i]->GetFaces(ef);
    for (int k = 0; k < 2; k++) {
      o[k] = -1;
      if (k < (int)ef.GetSize())
        for (ULONG j = 0; j < f.GetSize(); j++)
          if (f[j] == ef[k]) { o[k] = (double)j; break; }
    }
    SmVertex *v0 = nullptr, *v1 = nullptr;
    e[i]->GetVertices(v0, v1);
    SmPoint3d s = v0 ? v0->GetPoint() : SmPoint3d(NAN, NAN, NAN);
    SmPoint3d t = v1 ? v1->GetPoint() : SmPoint3d(NAN, NAN, NAN);
    o[2] = s.x; o[3] = s.y; o[4] = s.z;
    o[5] = t.x; o[6] = t.y; o[7] = t.z;
    double lo = 0, hi = 0;
    SmVector3d m(NAN, NAN, NAN);
    if (e[i]->GetCurve() && SmApiEdgeParameterRange(e[i], lo, hi) == SM_SUCCESS) {
      SmVector3d pd[3];
      if (e[i]->GetCurve()->Evaluate(0.5 * (lo + hi), 0, true, pd) == SM_SUCCESS) m = pd[0];
    }
    o[8] = m.x; o[9] = m.y; o[10] = m.z;
    o[11] = (double)tagOf(e[i]);
  }
  return n;
}

// Exact geometry of a face's surface, for STEP: degree u, degree v, control
// point counts u and v, rational flag, then ucount*vcount control points as
// x y z w. Returns the number of doubles written, or the number needed.
API int sm_face_nurbs(int h, int i, double* out, int cap) {
  SmBrep* b = get(h);
  if (!b) return -1;
  SmTArray<SmFace*> f;
  faces(b, f);
  if (i < 0 || i >= (int)f.GetSize()) return -2;
  const SmBSplineSurface* s = dynamic_cast<const SmBSplineSurface*>(f[i]->GetSurface());
  if (!s) return -3;
  ULONG nu = 0, nv = 0;
  SmTArray<SmPoint3d> cps;
  SmTArray<double> w;
  if (s->GetControlPointNet(nu, nv, cps, w) != SM_SUCCESS) return -4;
  int need = 5 + (int)(nu * nv) * 4;
  if (need > cap) return need;
  out[0] = s->GetDegree(SM_SP_U); out[1] = s->GetDegree(SM_SP_V);
  out[2] = nu; out[3] = nv; out[4] = w.GetSize() ? 1 : 0;
  for (ULONG k = 0; k < nu * nv; k++) {
    out[5 + k * 4] = cps[k].x; out[6 + k * 4] = cps[k].y; out[7 + k * 4] = cps[k].z;
    out[8 + k * 4] = w.GetSize() ? w[k] : 1.0;
  }
  return need;
}

// ---- tessellation -----------------------------------------------------------

// Triangulate; each triangle carries the index of the B-rep face it lies on.
// Returns the triangle count, or a negative status.
API int sm_tessellate(int h, double chord, double angleDeg) {
  SmBrep* b = get(h);
  if (!b) return -1;
  SmTArray<SmFace*> f;
  faces(b, f);
  SmTessellationParams p;
  p.dChordHeightTol = chord;
  p.dCurveAngleTolDeg = angleDeg;
  p.dSurfaceAngleTolDeg = angleDeg;
  SmPolyBrep* poly = nullptr;
  SmApiStatus s = SmApiTessellate(b, poly, p);
  if (s != SM_SUCCESS || !poly) return -(int)s - 1;
  g_meshPos.clear();
  g_meshTri.clear();
  SmTArray<SmPolyVertex*> pv;
  SmTArray<SmPolyFace*> pf;
  poly->GetPolyVertices(pv);
  poly->GetPolyFaces(pf);
  std::unordered_map<SmPolyVertex*, unsigned> index;
  for (ULONG i = 0; i < pv.GetSize(); i++) {
    index[pv[i]] = (unsigned)i;
    SmPoint3d q = pv[i]->GetPoint();
    g_meshPos.push_back((float)q.x); g_meshPos.push_back((float)q.y); g_meshPos.push_back((float)q.z);
  }
  std::unordered_map<SmFace*, unsigned> faceIndex;
  for (ULONG i = 0; i < f.GetSize(); i++) faceIndex[f[i]] = (unsigned)i;
  for (ULONG i = 0; i < pf.GetSize(); i++) {
    SmPolyLoop* loop = pf[i]->GetOuterPolyLoop();
    if (!loop) continue;
    SmTArray<SmPolyEdge*> pe;
    loop->GetPolyEdges(pe);
    auto it = faceIndex.find(pf[i]->GetOriginalFace());
    unsigned fi = it == faceIndex.end() ? 0xffffffffu : it->second;
    // A poly face is a convex polygon from the tessellator; fan it.
    for (ULONG k = 1; k + 1 < pe.GetSize(); k++) {
      g_meshTri.push_back(index[pe[0]->GetStartPolyVertex()]);
      g_meshTri.push_back(index[pe[k]->GetStartPolyVertex()]);
      g_meshTri.push_back(index[pe[k + 1]->GetStartPolyVertex()]);
      g_meshTri.push_back(fi);
    }
  }
  delete poly;
  return (int)(g_meshTri.size() / 4);
}

API const float* sm_mesh_positions() { return g_meshPos.data(); }
API int sm_mesh_vertex_count() { return (int)(g_meshPos.size() / 3); }
API const unsigned* sm_mesh_triangles() { return g_meshTri.data(); }

// Sample every edge as a polyline, for drawing and picking edges by id.
// Returns the number of edges sampled.
API int sm_edge_polylines(int h, double angleDeg) {
  SmBrep* b = get(h);
  if (!b) return -1;
  SmTArray<SmEdge*> all;
  edges(b, all);
  std::unordered_map<SmEdge*, unsigned> edgeIndex;
  for (ULONG i = 0; i < all.GetSize(); i++) edgeIndex[all[i]] = (unsigned)i;
  SmTArray<SmPoint3d> pts;
  SmTArray<ULONG> counts;
  SmTArray<SmEdge*> es;
  SmApiStatus s = SmApiTessellateBoundaries(b, angleDeg, pts, counts, es);
  if (s != SM_SUCCESS) return -(int)s - 1;
  g_edgePts.clear();
  g_edgeRuns.clear();
  for (ULONG i = 0; i < pts.GetSize(); i++) {
    g_edgePts.push_back((float)pts[i].x); g_edgePts.push_back((float)pts[i].y); g_edgePts.push_back((float)pts[i].z);
  }
  for (ULONG i = 0; i < counts.GetSize(); i++) {
    auto it = i < es.GetSize() ? edgeIndex.find(es[i]) : edgeIndex.end();
    g_edgeRuns.push_back(it == edgeIndex.end() ? 0xffffffffu : it->second);
    g_edgeRuns.push_back((unsigned)counts[i]);
  }
  return (int)counts.GetSize();
}

API const float* sm_edge_points() { return g_edgePts.data(); }
API const unsigned* sm_edge_runs() { return g_edgeRuns.data(); }

// ---- memory -----------------------------------------------------------------

API double sm_heap_in_use() { return (double)mallinfo().uordblks; }
API double sm_live_breps() {
  int n = 0;
  for (SmBrep* b : g_breps) n += b != nullptr;
  return n;
}
