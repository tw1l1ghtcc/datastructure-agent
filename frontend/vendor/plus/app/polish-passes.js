/**
 * polish-passes.js -- 图元坐标后处理（**角色驱动**，不认识任何具体渲染器）
 *
 * 4 个 pass，全部只吃 `classify()` 的结果 + `POLICY` 里的数字：
 *
 *   mark    标注框贴住它圈的那一格、标注文字落到下标下方
 *   tidy    按层整理结点（叶子占格 / 父取孩子中点 / 单孩子偏反侧）、重算边与边标签、摆徽标
 *   header  轴标签给标题让位；气泡被标题挤住时把**内容整体下移**
 *   float   浮动标注（气泡）：同锚点的摊开成一行，仍撞就换位，并重锚指示线
 *
 * 这里**没有** `one-array` / `link-2d` / `tree` 这些名字，也没有 `cell-` / `nv-` / `ptr-` 这类键名：
 * 那些都在 `layout-policy.js` 的 ROLES 里声明。新渲染器（新的"数据结构 × 算法"组合）
 * 只要键名符合约定，默认就能吃到这里的排版；命名不同则注册一份 profile（纯数据）。
 */

import { classify, profileOf, primBox, chipBox, overlapRatio, hits, translate, textW } from './layout-policy.js';

/* ============================================================ 通用：落点评分 ========= */

/**
 * 给候选位置打分（**每次现算**，所以前面挪动过的图元会被后面看到）：
 *   撞文字/气泡/圆 = 1 分（撞标题 × header.weight）；撞框只在"半压边框"时才算分；
 *   **压到线（边/连线）也算 1 分**——否则气泡会落在两条边之间（树里尤其明显，看着像"错位"）。
 *   `containOk`（整个装进框里算正常）只对 **chip** 成立——"气泡贴着格子当小徽标"是允许的画法。
 * `exclude` 里的图元不参与（放自己的时候不能把自己算成障碍）。
 */
function makeScorer(c, exclude) {
  const P = c.profile.policy;
  const skip = new Set(exclude || []);
  const headSet = new Set(c.headers);
  const solid = c.ink.filter((p) => p.kind !== 'line' && p.kind !== 'poly' && !skip.has(p));
  const lines = c.list.filter((p) => p.kind === 'line' && /^(e|te|x|th)-/.test(p.key || '') && !skip.has(p));
  const pad = (P.float && P.float.edgeClearance) != null ? P.float.edgeClearance : 4;
  return (bb, movingKind) => {
    const chipLike = movingKind === 'chip';
    let score = 0;
    for (const q of solid) {
      const qb = primBox(q, P);
      if (!qb) continue;
      if (q.kind === 'rect') {
        const r = overlapRatio(bb, qb);
        if (r > P.eps && (r <= P.containOk || !chipLike)) score += 1;
        continue;
      }
      if (!hits(bb, qb, P)) continue;
      score += headSet.has(q) ? P.header.weight : 1;
    }
    // 线：按"线段是否穿过候选盒"判（bbox 对斜线太粗，会把整片区域都算成禁区）
    for (const ln of lines) {
      if (segHitsBox(ln.x1, ln.y1, ln.x2, ln.y2, bb, pad)) score += 1;
    }
    return score;
  };
}

/** 线段是否穿过盒子（采样 12 段，含 pad 外扩）——比 bbox 精确，也比精确求交便宜 */
function segHitsBox(x1, y1, x2, y2, bb, pad = 4) {
  if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) return false;
  const x0 = bb.x - pad;
  const y0 = bb.y - pad;
  const x3 = bb.x + bb.w + pad;
  const y3 = bb.y + bb.h + pad;
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    if (x >= x0 && x <= x3 && y >= y0 && y <= y3) return true;
  }
  return false;
}

/** 在候选里挑"分最低、同分里离原位最近"的那个 */
function pickBest(cands, box, score, origin, kind) {
  const hw = box.w / 2;
  const hh = box.h / 2;
  let best = null;
  for (const [x0, y0] of cands) {
    const bb = { x: x0 - hw, y: y0 - hh, w: box.w, h: box.h };
    const s = score(bb, kind);
    const d = origin ? Math.abs(x0 - origin[0]) + Math.abs(y0 - origin[1]) * 1.2 : 0;
    if (!best || s < best.s || (s === best.s && d < best.d)) best = { x: x0, y: y0, s, d };
  }
  return best;
}

const clampTo = (rect, box, x, y) => {
  const hw = box.w / 2;
  const hh = box.h / 2;
  return [
    Math.max(rect.x + hw + 2, Math.min(rect.x + rect.w - hw - 2, x)),
    Math.max(rect.y + hh + 2, Math.min(rect.y + rect.h - hh - 2, y)),
  ];
};

const obstaclesOf = (c) => ({
  list: c.ink.filter((p) => p.kind !== 'line' && p.kind !== 'poly').map((p) => ({ prim: p, box: primBox(p, c.profile.policy) })),
  headers: c.headers,
});

/* ============================================================ pass: mark ========= */

export function passMark(c, rect) {
  const P = c.profile.policy;
  for (const m of c.marks) {
    if (!m.box || !c.anchors.length) continue;
    const mb = primBox(m.box, P);
    let best = null;
    for (const a of c.anchors) {
      const ab = primBox(a.prim, P);
      if (!ab) continue;
      const r = overlapRatio(mb, ab);
      const d = Math.abs((ab.x + ab.w / 2) - (mb.x + mb.w / 2));
      if (!best || r > best.r || (r === best.r && d < best.d)) best = { ab, r, d };
    }
    if (!best) continue;
    // 框贴住它圈的那一格（原来是"格子上下各外扩 6px"，正好压住格子上方的气泡）
    m.box.y = best.ab.y;
    m.box.h = best.ab.h;
    if (typeof m.box.r === 'number') m.box.r = Math.min(m.box.r, P.mark.radiusCap);
    // 标注文字落到"格子 + 地址/下标那一行"的下方
    if (m.label) {
      m.label.x = best.ab.x + best.ab.w / 2;
      m.label.y = best.ab.y + best.ab.h + P.mark.labelGap;
    }
  }
}

/* ============================================================ pass: header ========= */

export function passHeader(c, rect) {
  const P = c.profile.policy;
  if (!c.headers.length) return;
  const topTitles = new Set(c.list.filter((p) => p.kind === 'text' && c.profile.roles.titleTop && c.profile.roles.titleTop.test(p.key || '')));

  /* 0) 标题太长：先按卡片可用宽度把字号缩下来（有下限，绝不删字），
        缩完再算标题占位 —— 否则 384px 的卡片上 403px 的标题会直接把右上角的
        “层数 3” 盖掉（用户看到的就是一行字叠着另一行字）。 */
  const availRight = rect.x + rect.w - 12;
  for (const t of topTitles) {
    const tb = primBox(t, P);
    if (!tb || tb.x + tb.w <= availRight) continue;
    const size = parseFloat((String(t.font || '').match(/(\d+(?:\.\d+)?)px/) || [])[1] || '13');
    const room = Math.max(40, availRight - tb.x);
    const next = Math.max(P.header.minTitlePx || 10, Math.floor(size * (room / tb.w) * 10) / 10);
    if (next < size - 0.05) t.font = String(t.font || '').replace(/(\d+(?:\.\d+)?)px/, next.toFixed(1) + 'px');
  }

  const headBoxes = c.headers.map((h) => primBox(h, P)).filter(Boolean);
  if (!headBoxes.length) return;
  const headBottom = Math.max(...headBoxes.map((b) => b.y + b.h));
  /* 主标题 = 最靠左的那个（通常是 `name`）；其余角标（`depth`/`legend`）算"可以挪的同伴"。
     否则 depth 自己也是 titleTop，会和标题一起被保护住，两条字就那么叠着。 */
  const titlePrimary = [...topTitles].sort((a, b) => (a.x - b.x) || ((a.font || '') > (b.font || '') ? -1 : 1))[0] || null;
  const titleBoxes = [...topTitles].map((t) => primBox(t, P)).filter(Boolean);
  const titleBottom = titleBoxes.length ? Math.max(...titleBoxes.map((b) => b.y + b.h)) : headBottom;

  // 1) 轴标签给标题让位（轴字母是装饰，挪十几像素不影响语义）
  //    口径：只在能落到**完全不撞**的位置时才挪。宁可让这个小字母跟标题擦着
  //    （右上角一处文字相接），也不要把它挪到"半个字母压进格子"的地方——后者更显眼。
  for (const lab of c.axisLabels) {
    const lb = primBox(lab, P);
    if (!lb || !headBoxes.some((hb) => hits(lb, hb, P))) continue;
    const score = makeScorer(c, [lab]);
    const right = Math.max(...headBoxes.map((b) => b.x + b.w));
    const cands = [
      [right + 16 + lb.w / 2, headBoxes[0].y + headBoxes[0].h / 2],
      [lab.x, lab.y],
      [right + 16 + lb.w / 2, headBottom + 16],
      [lab.x, headBottom + 14],
      [lab.x, lab.y + 18],
      [lab.x + 18, lab.y],
      [lab.x - 18, lab.y],
      [lab.x, lab.y - 14],
    ].map(([x, y]) => clampTo(rect, lb, x, y));
    const best = pickBest(cands, lb, score, [lab.x, lab.y], lab.kind);
    if (best && best.s === 0 && score(lb, lab.kind) > 0) { lab.x = best.x; lab.y = best.y; }
  }

  /* 1.5) 还压在标题上的文字（“层数 3”“列数 N”这类统计角标）→ 挪到标题下面一行。
         标题已经缩到卡片宽度内，仍然相交说明是**别的文字**跑进了标题的横向范围。 */
  for (const p of c.list) {
    if (p.kind !== 'text' || p === titlePrimary) continue;
    const pb = primBox(p, P);
    if (!pb || !titleBoxes.some((tb) => hits(pb, tb, P))) continue;
    /* 注意：文字图元的 x 是**对齐基准**（左/中/右），不能当"盒子中心"用，
       所以这里只改 y，横向一律保持原 anchor，避免右对齐的角标被整体挪歪。 */
    const ys = [titleBottom + 12, titleBottom + 24, p.y + 16, p.y + 26];
    for (const y of ys) {
      if (y - pb.h / 2 < rect.y + 2 || y + pb.h / 2 > rect.y + rect.h - 2) continue;
      const nb = { x: pb.x, y: y - pb.h / 2, w: pb.w, h: pb.h };
      const bad = c.list.some((q) => q !== p && primBox(q, P) && hits(nb, primBox(q, P), P));
      if (!bad) { p.y = y; break; }
    }
  }

  // 2) 标注（气泡 / 徽标）压标题 → 把**内容整体下移**（画布还有余量就下移，装不下就不动）
  //    看的是标注"想去的位置"（徽标＝结点正上方，气泡＝当前位置），而不是它现在的落点：
  //    徽标现在可能只是"擦"着标题 0.5px，但挪到正上方就会压 21%，那也该给它腾地方。
  if (!topTitles.size) return;
  const T = P.tidy;
  const slots = [];
  for (const f of c.floats) slots.push(primBox(f.prim, P));
  for (const n of c.nodes.values()) {
    if (!n.badge || !n.body) continue;
    const box = chipBox(n.badge, P);
    const r = n.body.r || 16;
    slots.push({ x: n.body.cx - box.w / 2, y: n.body.cy - r - T.badgeGap - box.h / 2, w: box.w, h: box.h });
  }
  const blocked = slots.filter((s) => s && [...topTitles].some((h) => hits(s, primBox(h, P), P)));
  if (!blocked.length) return;
  // 只把**顶部标题**留在原地，其余（含 treelabel 这类段落标题、轴字母、落点圆点）跟着内容一起下移
  /* 这里绝不能再"顺便排除装饰物"：整体下移是一次**图层级平移**，只要有元素没跟着走，
     它就会悬在半空 —— `dot-<a>-<b>`（连接线落点小圆）正是这样比自己的箭头尖端高了 35.5px，
     用户看到的就是"这些点是什么，为什么忽然飞起来了"。 */
  const contentPrims = c.list.filter((p) => !topTitles.has(p));
  const minTop = Math.min(...slots.filter(Boolean).map((s) => s.y));
  let maxBottom = -Infinity;
  for (const p of contentPrims) {
    const b = primBox(p, P);
    if (b) maxBottom = Math.max(maxBottom, b.y + b.h);
  }
  const dy = Math.min(headBottom + P.header.pad - minTop, rect.y + rect.h - 4 - maxBottom);
  if (dy > 0.5) for (const p of contentPrims) translate(p, 0, dy);
}

/* ============================================================ pass: tidy ========= */

/**
 * tidy：按"层"重新摆放结点
 *   · 叶子按 DFS 顺序占格，父取孩子中点；
 *   · **只有一个孩子**时，父结点朝孩子的反侧偏 `singleChildShift` 格（否则单链会塌成一条竖线）；
 *   · **没有任何边的结点**（孤立/临时结点）也参与排布（否则会全叠在画布中心一点）。
 * 边 / 边标签 / 徽标 / 结点值文字全部跟着重算。
 */
export function passTidy(c, rect, layer) {
  const P = c.profile.policy;
  const T = P.tidy;
  const ids = c.ids;
  if (ids.size < 2) return;                                 // 单结点：结点不用排，交给 badge/float pass
  const kids = new Map();
  const hasParent = new Set();
  for (const e of c.edges) {
    if (e.kind !== 'e') continue;
    const tag = c.tags.get(e.to);
    const side = tag && (tag.text === 'L' || tag.text === 'R') ? tag.text : null;
    if (!kids.has(e.from)) kids.set(e.from, []);
    kids.get(e.from).push({ to: e.to, side });
    hasParent.add(e.to);
  }

  const xs = new Map();
  const depth = new Map();
  let cursor = 0;
  const assign = (id, d) => {
    if (depth.has(id)) return xs.get(id) ?? 0;
    depth.set(id, d);
    const ks = (kids.get(id) || []).filter((k) => ids.has(k.to));
    if (!ks.length) { xs.set(id, cursor); cursor += 1; return xs.get(id); }
    const cxs = ks.map((k) => assign(k.to, d + 1));
    let x = (Math.min(...cxs) + Math.max(...cxs)) / 2;
    if (ks.length === 1) x = cxs[0] + (ks[0].side === 'R' ? -T.singleChildShift : T.singleChildShift);
    xs.set(id, x);
    return x;
  };
  for (const id of ids) if (!hasParent.has(id)) assign(id, 0);
  for (const id of ids) if (!depth.has(id)) assign(id, 0);

  const maxDepth = Math.max(...depth.values());
  const rOf = (id) => (c.nodes.get(id).body && c.nodes.get(id).body.r) || 16;
  const maxR = Math.max(...[...ids].map(rOf));
  const spanMin = Math.min(...xs.values());
  const spanMax = Math.max(...xs.values());
  const span = spanMax - spanMin;
  const fitViewport = layer?.props?.fitViewport;
  const levelLimit = fitViewport ? 170 : T.levelGap.max;
  const levelPad = fitViewport ? Math.max(110, 2 * maxR + 42) : T.levelGap.pad;
  const levelGap = Math.min(levelLimit, Math.max(T.levelGap.min, (rect.h - levelPad) / Math.max(1, maxDepth)));
  const y0 = fitViewport ? rect.y + (rect.h - maxDepth * levelGap) / 2 : rect.y + T.top;
  const availW = rect.w - 2 * (maxR + T.sideRoom);
  const gapLimit = fitViewport ? Math.max(T.gapX.max, Math.min(230, levelGap * 1.55)) : T.gapX.max;
  const gapX = Math.min(gapLimit, Math.max(T.gapX.min, span > 0 ? availW / span : gapLimit));

  const pos = new Map();
  for (const id of ids) pos.set(id, { x: xs.get(id) * gapX, y: y0 + (depth.get(id) || 0) * levelGap });

  // 同层最小间距
  const byDepth = new Map();
  for (const id of ids) {
    const d = depth.get(id) || 0;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d).push(id);
  }
  for (const group of byDepth.values()) {
    group.sort((a, b) => pos.get(a).x - pos.get(b).x);
    for (let i = 1; i < group.length; i++) {
      const prev = pos.get(group[i - 1]);
      const cur = pos.get(group[i]);
      const need = rOf(group[i - 1]) + rOf(group[i]) + T.minSep;
      if (cur.x - prev.x < need) cur.x = prev.x + need;
    }
  }
  // 整组水平居中
  let minX = Infinity;
  let maxX = -Infinity;
  for (const id of ids) {
    minX = Math.min(minX, pos.get(id).x - rOf(id));
    maxX = Math.max(maxX, pos.get(id).x + rOf(id));
  }
  const shift = rect.x + rect.w / 2 - (minX + maxX) / 2;
  for (const p of pos.values()) p.x += shift;

  // 落位：结点本体 / 标签 / 值
  const delta = new Map();
  for (const id of ids) {
    const n = c.nodes.get(id);
    const p = pos.get(id);
    if (!n.body) continue;
    delta.set(id, { dx: p.x - n.body.cx, dy: p.y - n.body.cy });
    n.body.cx = p.x;
    n.body.cy = p.y;
    if (n.label) { n.label.x = p.x; n.label.y = p.y; }
    if (n.value) { n.value.x = p.x; n.value.y = p.y + rOf(id) + T.valueGap; }
  }

  // 边 + 边标签
  const score = makeScorer(c);
  for (const e of c.edges) {
    if (!pos.has(e.from) || !pos.has(e.to)) continue;
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (e.kind === 'th') {
      e.prim.x1 = a.x; e.prim.y1 = a.y; e.prim.x2 = b.x; e.prim.y2 = b.y;
    } else {
      e.prim.x1 = a.x; e.prim.y1 = a.y + rOf(e.from);
      e.prim.x2 = b.x; e.prim.y2 = b.y - rOf(e.to);
    }
    const tag = c.tags.get(e.to);
    if (tag && e.kind === 'e') {
      const dx = e.prim.x2 - e.prim.x1;
      const dy = e.prim.y2 - e.prim.y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const tb = primBox(tag, P);
      const cands = [];
      for (const t of T.tagAt) {
        for (const off of [T.tagOffset, -T.tagOffset]) {
          cands.push(clampTo(rect, tb, e.prim.x1 + dx * t + nx * off, e.prim.y1 + dy * t + ny * off));
        }
      }
      cands.push(clampTo(rect, tb, (e.prim.x1 + e.prim.x2) / 2, (e.prim.y1 + e.prim.y2) / 2));
      const best = pickBest(cands, tb, score, null, tag.kind);
      if (best) { tag.x = best.x; tag.y = best.y; }
    }
  }
}

/** 结点几何：优先圆（body），没有就退到方框（nodeBox，如链表结点） */
function nodeGeom(n, P) {
  if (!n) return null;
  if (n.body) return { cx: n.body.cx, cy: n.body.cy, r: n.body.r || 16, box: primBox(n.body, P) };
  if (n.box) {
    const b = primBox(n.box, P);
    if (!b) return null;
    return { cx: b.x + b.w / 2, cy: b.y + b.h / 2, r: Math.min(b.w, b.h) / 2, box: b };
  }
  return null;
}
/** pass: badge —— 徽标单独成一个 pass，好在气泡摆完之后再让一次位 */
export function passBadge(c, rect) {
  const P = c.profile.policy;
  /* 徽标是"结点自己的标签"，优先级高于浮动气泡：
     先找出挡住"正上方"位置的气泡 → 给徽标打分时当它们不存在（徽标落回正上方）
     → 放完徽标再把那些气泡重排一轮，让它们自己让开。 */
  const blockers = new Set();
  for (const id of c.ids) {
    const n = c.nodes.get(id);
    const g = nodeGeom(n, P);
    if (!n || !n.badge || !g) continue;
    const box = primBox(n.badge, P) || chipBox(n.badge, P);
    const slot = { x: g.cx - box.w / 2, y: g.cy - g.r - P.tidy.badgeGap - box.h / 2, w: box.w, h: box.h };
    for (const f of c.floats) if (hits(slot, primBox(f.prim, P), P)) blockers.add(f.prim);
  }
  placeBadges(c, rect, null, blockers);
  if (blockers.size) passFloat(c, rect);
}

/** 徽标（结点上方的气泡）：优先正上方，撞了就左/右/下/更上一层 */
function placeBadges(c, rect, score, ignore) {
  const P = c.profile.policy;
  const T = P.tidy;
  const own = (id) => c.nodes.get(id);
  for (const id of c.ids) {
    const n = own(id);
    const g = nodeGeom(n, P);
    if (!n || !n.badge || !g) continue;
    const r = g.r;
    const box = primBox(n.badge, P) || chipBox(n.badge, P);   // 徽标可能是 text（link-2d 就是）
    const cx = g.cx;
    const cy = g.cy;
    const cands = [
      [cx, cy - r - T.badgeGap],
      [cx - r - 10 - box.w / 2, cy],
      [cx + r + 10 + box.w / 2, cy],
      [cx, cy + r + T.badgeGap],
      [cx, cy - r - T.badgeGap - box.h],
    ].map(([x, y]) => clampTo(rect, box, x, y));
    // 徽标打分 = **先数"撞了几个"**（整数优先，保证有干净位置时一定去），
    // 全被占时才用"重叠面积"挑最小的那个。只用连续面积分会让"轻微压一点"赢过
    // "稍微远一点但完全不撞"的位置（实测能差出 119 处 badge×文字）。
    const evalAt = (bb) => {
      let cnt = 0;
      let area = 0;
      for (const q of c.ink) {
        if (q === n.badge || (ignore && ignore.has(q)) || q.kind === 'line' || q.kind === 'poly') continue;
        const qb = primBox(q, P);
        if (!qb) continue;
        const rr = overlapRatio(bb, qb);
        if (rr <= P.eps) continue;
        const w = c.headers.includes(q) ? P.header.weight : 1;
        cnt += w;
        area += rr * w;
      }
      return cnt * 1000 + area * 10;
    };
    let best = null;
    for (const [x, y] of cands) {
      const s = evalAt({ x: x - box.w / 2, y: y - box.h / 2, w: box.w, h: box.h });
      if (!best || s < best.s - 1e-6) best = { x, y, s };
    }
    void pickBest;
    if (best) { n.badge.x = best.x; n.badge.y = best.y; }
  }
}

/* ============================================================ pass: float ========= */

/**
 * float：浮动标注摆位
 *   ① 同一个锚点上的多个气泡先**横向摊开**（摊得开就一行，人不犯我）；
 *   ② 仍撞标题/别的气泡/半压框 → 在"离原位最近"的候选里换位；
 *   ③ 气泡若带指示线，线头跟着气泡走（方向由线自己决定，不看键名）。
 */
export function passFloat(c, rect) {
  const P = c.profile.policy;
  if (!c.floats.length) return;
  // 声明了 priority 的先占位（接口里的软优先级），没声明的保持原顺序
  c.floats.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  const anchorsByBox = c.anchors.map((a) => ({ id: a.id, box: primBox(a.prim, P) })).filter((a) => a.box);
  const nodeBox = (id) => {
    const n = c.nodes.get(id);
    return n && n.body ? primBox(n.body, P) : null;
  };
  const ownerBox = (f) => {
    const b = (f.ownerId && (nodeBox(f.ownerId) || (anchorsByBox.find((a) => a.id === f.ownerId) || {}).box)) || null;
    if (b) return b;
    // 归属不到结点/容器时，用指示线落点造一个零尺寸锚，好让"相对锚点的候选位置"仍然成立
    return f.anchorPoint ? { x: f.anchorPoint.x, y: f.anchorPoint.y, w: 0, h: 0 } : null;
  };

  /* ① 同锚点/同列的气泡成簇横向摊开 */
  const groups = new Map();
  for (const f of c.floats) {
    const key = f.ownerKey || f.ownerId || ('x' + Math.round(f.prim.x / (P.cluster.radius * 2)));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.prim.x - b.prim.x);
    const boxes = group.map((f) => chipBox(f.prim, P));
    const widest = Math.max(...boxes.map((b) => b.w));
    const gap = Math.max(P.cluster.gap, widest + P.cluster.gapPad);
    // 簇的基准 x 优先取**锚点中心**（结点/格子现在的位置），否则才用气泡当前 x 的平均：
    // 树/图经过 tidy 之后结点已经挪过，拿气泡的旧 x 当基准会把气泡留在原来的地方。
    const ob0 = ownerBox(group[0]);
    const anchorX = ob0 ? ob0.x + ob0.w / 2 : group.reduce((s, f) => s + f.prim.x, 0) / group.length;
    let prevRight = -Infinity;
    group.forEach((f, i) => {
      const box = chipBox(f.prim, P);
      let x = clampTo(rect, box, anchorX + (i - (group.length - 1) / 2) * gap, f.prim.y)[0];
      // 同行左右找空位（不压标题、不压别的气泡）
      const sc = makeScorer(c, [f.prim, f.connector].filter(Boolean));
      const blockedAt = (cx) => sc({ x: cx - box.w / 2, y: f.prim.y - box.h / 2, w: box.w, h: box.h }, f.prim.kind) > 0;
      if (blockedAt(x)) {
        for (const step of [8, 16, 24, 32, 40, 48, 56, 64]) {
          let done = false;
          for (const dir of [1, -1]) {
            const cand = x + dir * step;
            if (cand - box.w / 2 < rect.x + 2 || cand + box.w / 2 > rect.x + rect.w - 2) continue;
            if (!blockedAt(cand)) { x = cand; done = true; break; }
          }
          if (done) break;
        }
      }
      f.prim.x = x;
      // 这一行确实排不开才换行（方向：气泡在锚点上方就往上，反之往下）
      const ob = ownerBox(f);
      const above = ob ? f.prim.y < ob.y + ob.h / 2 : true;
      if (i > 0 && x - box.w / 2 < prevRight + 2) {
        const y = f.prim.y + (above ? -P.cluster.rowStep : P.cluster.rowStep);
        f.prim.y = clampTo(rect, box, x, y)[1];
      }
      prevRight = x + box.w / 2;
      anchorConnector(f, P, ownerBox(f));
    });
  }

  /* ② 逐个气泡：撞了就换到最近的干净位置（跑两轮，后挪的会追尾前面挪好的） */
  for (let round = 0; round < 2; round++)
  for (const f of c.floats) {
    const box = chipBox(f.prim, P);
    const sc = makeScorer(c, [f.prim, f.connector].filter(Boolean));
    const home = sc({ x: f.prim.x - box.w / 2, y: f.prim.y - box.h / 2, w: box.w, h: box.h }, f.prim.kind);
    const ob = ownerBox(f);
    const hw = box.w / 2;
    const hh = box.h / 2;
    // 声明式气泡的"当前位置"只是补出来的占位（画布中心），不能当候选，否则它自己就赢了
    const cands = f.declared ? [] : [[f.prim.x, f.prim.y]];
    const rel = {
      insideR: ob ? [ob.x + ob.w - hw - 4, ob.y + ob.h / 2] : null,
      insideL: ob ? [ob.x + hw + 4, ob.y + ob.h / 2] : null,
      above: ob ? [ob.x + ob.w / 2, ob.y - hh - 8] : null,
      below: ob ? [ob.x + ob.w / 2, ob.y + ob.h + hh + 8] : null,
      right: ob ? [ob.x + ob.w + hw + 12, ob.y + ob.h / 2] : null,
      left: ob ? [ob.x - hw - 12, ob.y + ob.h / 2] : null,
    };
    const PREF = { above: ['above'], below: ['below'], left: ['left', 'insideL'], right: ['right', 'insideR'], inside: ['insideR', 'insideL'] };
    for (const k of (PREF[f.prefer] || [])) if (rel[k]) cands.push(rel[k]);
    if (ob) {
      cands.push([ob.x + ob.w - hw - 4, ob.y + ob.h / 2]);
      cands.push([ob.x + hw + 4, ob.y + ob.h / 2]);
      cands.push([f.prim.x, ob.y - hh - 8]);
      cands.push([f.prim.x, ob.y + ob.h + hh + 8]);
      cands.push([f.prim.x, ob.y + ob.h + 26 + hh]);
      cands.push([ob.x + ob.w + hw + 12, ob.y + ob.h / 2]);
      cands.push([ob.x - hw - 12, ob.y + ob.h / 2]);
      // 上下再让出一档：树里"结点正上方是徽标"，气泡常得再往外一层
      cands.push([ob.x + ob.w / 2, ob.y - hh - 8 - 26]);
      cands.push([ob.x + ob.w / 2, ob.y + ob.h + hh + 8 + 26]);
    }
    for (const dy of P.search.dySteps) {
      for (const unit of P.search.dxUnits) {
        const dx = unit === 0 ? 0 : hw + 16 * unit;
        if (dx === 0) cands.push([f.prim.x, f.prim.y + dy], [f.prim.x, f.prim.y - dy]);
        else cands.push([f.prim.x + dx, f.prim.y + dy], [f.prim.x - dx, f.prim.y + dy]);
      }
    }
    const clamped = cands.map(([x, y]) => clampTo(rect, box, x, y));
    // 声明式气泡不受"只在附近找"的限制（它本来就该挪到声明的方位）
    const near = f.declared ? clamped : clamped.filter(([x, y]) => Math.abs(x - f.prim.x) + Math.abs(y - f.prim.y) * 1.2 <= P.search.limit);
    // 声明了方位（meta.anchor / annotations[].anchor）时按候选顺序取胜，不再按"离原位近"
    const origin = f.prefer ? null : [f.prim.x, f.prim.y];
    const best = pickBest(near.length ? near : clamped, box, sc, origin, f.prim.kind);
    // 声明式（meta / annotations）的气泡必须落到声明方位；其余仍守"不比原位差"的原则
    if (best && (best.s < home || (f.declared && best.s <= home))) { f.prim.x = best.x; f.prim.y = best.y; }
    anchorConnector(f, P, ownerBox(f));
  }
}

/** 指示线跟着气泡走：线本来指向哪边，就把起点锚在那一边 */
function anchorConnector(f, P, ob) {
  const ln = f.connector;
  if (!ln) return;
  const box = chipBox(f.prim, P);
  if (!ob) { ln.opacity = 0; return; }   // 归属不明：宁可隐藏，也不要留一根指向旧位置的线
  if (ob && ob.w != null) {
    /* 有 owner：**两端都重锚**。只挪气泡那一端会留下"线指向旧位置"的错位
       （树的指针线原本按旧圆心算 cx+8/cy-8，结点被 tidy 挪过后就对不上了）。 */
    const cx = ob.x + ob.w / 2;
    const cy = ob.y + ob.h / 2;
    const r = Math.max(6, Math.min(ob.w, ob.h) / 2 + 2);
    const ang = Math.atan2(cy - f.prim.y, cx - f.prim.x);
    const hw = box.w / 2;
    const hh = box.h / 2;
    const tc = Math.abs(Math.cos(ang)) > 1e-6 ? hw / Math.abs(Math.cos(ang)) : Infinity;
    const ts = Math.abs(Math.sin(ang)) > 1e-6 ? hh / Math.abs(Math.sin(ang)) : Infinity;
    const t = Math.min(tc, ts) + 1;
    ln.x1 = f.prim.x + Math.cos(ang) * t;
    ln.y1 = f.prim.y + Math.sin(ang) * t;
    ln.x2 = cx - Math.cos(ang) * r;
    ln.y2 = cy - Math.sin(ang) * r;
    return;
  }
  const above = ln.y2 >= ln.y1;
  ln.x1 = f.prim.x;
  ln.y1 = above ? box.y + box.h + 2 : box.y - 2;
}

/* ============================================================ pass: thread ======= */

/** 点到线段距离 */
function distToSeg(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1, vy = y2 - y1;
  const vl2 = vx * vx + vy * vy || 1;
  let t = ((px - x1) * vx + (py - y1) * vy) / vl2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + vx * t), py - (y1 + vy * t));
}

/**
 * 线索虚线（`th-*`）不要和树边实线"从同一个地方出来"。
 *
 * 真实场景（BiThrTree 中序线索化）：C 的左链为空 → 指向前驱 A，而 **A→C 本身就是一条树边**；
 * D 的后继是 A，而 A 在 D 正上方。渲染器把树边画成"父结点下沿 → 子结点上沿"、
 * 把线索画成"源结点中心 → 目标结点中心"，于是近端两条线贴着同一点出发，
 * 在 384px 的卡片上就是"虚线压在实线上"，看不出哪条是线索。
 *
 * 规则（纯几何，不认案例、不认 key 语义）：
 *   ① 线索改从**结点侧面**出入（按目标在左/右选左/右侧边框），不再和树边抢同一出口；
 *   ② 若侧面化之后中段仍有 ≥35% 的采样点贴着某条实线（说明真的压住了），
 *      再把它弯开：首尾不动、中点沿法向鼓出 `bow`，取"离实线更远、且不撞结点"的一侧。
 */
export function passThread(c) {
  const P = c.profile.policy;
  const T = P.thread || { touch: 2, bow: 13, sideGap: 1 };
  const ths = c.list.filter((p) => p.kind === 'line' && p.dash && /^th-/.test(String(p.key || '')));
  if (!ths.length) return;
  const solids = c.list.filter((p) => p.kind === 'line' && !p.dash);
  const circles = c.list.filter((p) => p.kind === 'circle');
  if (!solids.length) return;

  const rAt = (x, y) => {
    for (const cc of circles) if (Math.hypot(cc.cx - x, cc.cy - y) <= 2.5) return { r: cc.r, x: cc.cx, y: cc.cy };
    return null;
  };
  /* 一条线贴着实线的"占比"：沿中段采 9 点，看有多少点在 touch 之内 */
  const hugRatio = (pts, touch) => {
    let n = 0, hit = 0;
    const segs = [];
    for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]]);
    const lens = segs.map((s) => Math.hypot(s[2] - s[0], s[3] - s[1]));
    const total = lens.reduce((a, b) => a + b, 0) || 1;
    for (let k = 1; k <= 9; k++) {
      const u = 0.1 + (k - 1) * 0.1;          // 0.1 … 0.9
      let want = total * u, idx = 0;
      while (idx < lens.length - 1 && want > lens[idx]) { want -= lens[idx]; idx++; }
      const s = segs[idx];
      const t = lens[idx] ? Math.min(1, want / lens[idx]) : 0;
      const px = s[0] + (s[2] - s[0]) * t, py = s[1] + (s[3] - s[1]) * t;
      n += 1;
      for (const so of solids) if (distToSeg(px, py, so.x1, so.y1, so.x2, so.y2) < touch) { hit += 1; break; }
    }
    return hit / Math.max(1, n);
  };

  for (const th of ths) {
    const ax = th.x1, ay = th.y1, bx = th.x2, by = th.y2;
    const a0 = rAt(ax, ay), b0 = rAt(bx, by);
    if (a0 && b0) {
      /* ① 从结点**侧面**出入：目标在右就走右侧，在左就走左侧（同侧所以线是直的一条，不会拐） */
      const side = (bx - ax) < -1 ? -1 : 1;
      const pad = (T.sideGap != null ? T.sideGap : 1);
      const nx1 = a0.x + side * (a0.r + pad), ny1 = a0.y;
      const nx2 = b0.x + side * (b0.r + pad), ny2 = b0.y;
      if (Math.hypot(nx2 - nx1, ny2 - ny1) > 4) { th.x1 = nx1; th.y1 = ny1; th.x2 = nx2; th.y2 = ny2; }
    }
    /* ② 侧面化之后仍然压住实线 → 弯开 */
    if (hugRatio([[th.x1, th.y1], [th.x2, th.y2]], T.touch) < 0.35) continue;
    const ux = th.x2 - th.x1, uy = th.y2 - th.y1;
    const ul = Math.hypot(ux, uy) || 1;
    const nx = -uy / ul, ny = ux / ul;
    const mx = (th.x1 + th.x2) / 2, my = (th.y1 + th.y2) / 2;
    const cost = (side) => {
      const cx = mx + nx * T.bow * side, cy = my + ny * T.bow * side;
      let s2 = 0;
      for (const p of circles) {
        if (distToSeg(p.cx, p.cy, th.x1, th.y1, cx, cy) < p.r + 1) s2 += 3;
        if (distToSeg(p.cx, p.cy, cx, cy, th.x2, th.y2) < p.r + 1) s2 += 3;
      }
      return s2;
    };
    let best = null;
    for (const side of [1, -1]) {
      const cx = mx + nx * T.bow * side, cy = my + ny * T.bow * side;
      const p0 = [th.x1, th.y1], p1 = [th.x2, th.y2];
      const pts = [p0];
      for (let i = 1; i <= 3; i++) {
        const t = i / 4, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, d = t * t;
        pts.push([a * p0[0] + b * cx + d * p1[0], a * p0[1] + b * cy + d * p1[1]]);
      }
      pts.push(p1);
      const score = hugRatio(pts, T.touch) * 100 + cost(side);
      if (!best || score < best.score) best = { score, pts };
    }
    if (!best) continue;
    th.kind = 'poly';
    th.pts = best.pts;
    delete th.x1; delete th.y1; delete th.x2; delete th.y2;
  }
}
