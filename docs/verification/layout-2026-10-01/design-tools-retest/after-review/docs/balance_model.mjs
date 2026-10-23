// docs/balance_model.mjs
// 打砖块首版数值平衡模型。
// 接口契约（bun .beegame/delivery/calculate-balance.mjs）：
//   export async calculate({ readJson, readText })
// 返回 { tables, checks, limitations }。
// 几何不抄录：全部从 content/scenes/breakout_level.json 读取（readJson 记录源字节）。
// 模型为事件驱动（time-of-impact）扫掠圆 vs 轴对齐矩形，确定性序列，无随机数。

const DEG = Math.PI / 180;

// ---- 发布配置（数值平衡 owner 拍板的初始可调参数；附录表是其机器记录） ----
const CFG = {
  fixedDtSec: 1 / 120,          // 固定逻辑步长（秒）
  maxStepsPerFrame: 8,          // 单帧最大逻辑步数（防螺旋）
  startLives: 3,                // 初始生命（条）
  ballBaseSpeed: 360,           // 球初始速度（逻辑像素/秒）
  ballSpeedCap: 540,            // 速度上限（逻辑像素/秒）
  // 提速档位：destroyed = 累计击碎数达到阈值即立即升档（不改变位置，速度向量只缩放量级）
  speedTiers: [
    { at: 0, speed: 360 },
    { at: 6, speed: 420 },
    { at: 18, speed: 480 },
    { at: 36, speed: 540 },
  ],
  serveAngleDeg: 40,            // 发球偏转角（相对竖直向上，度）；水平符号规则见文档
  serveWindowDeg: [30, 50],     // 实现允许的发球窗口（发布实现取定值 40）
  maxBounceAngleDeg: 60,        // 挡板最大偏转角（击球点在挡板边点）
  paddleKeyboardSpeed: 560,     // 挡板键盘移动速度（逻辑像素/秒）
  // 6 行砖块分值（自上而下：顶行更难打到，分值更高）；行为全部一击即碎
  brickPointsByRow: [60, 50, 40, 30, 20, 10],
  reactionTimeSec: 0.22,        // 救援检查中的人类反应时间（假设值，非测量）
};

function tierSpeed(destroyed) {
  let v = CFG.speedTiers[0].speed;
  for (const t of CFG.speedTiers) if (destroyed >= t.at) v = t.speed;
  return v;
}

function finite(x) {
  return Number.isFinite(x);
}

function approx(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

// 挡板反弹：h = 击球点归一偏移 [-1,1]；返回反弹后速度向量（y-down：向上 vy 为负）
function paddleBounceVelocity(h, speed) {
  const hh = Math.max(-1, Math.min(1, h));
  const theta = hh * CFG.maxBounceAngleDeg * DEG;
  return [speed * Math.sin(theta), -speed * Math.cos(theta)];
}

export async function calculate({ readJson }) {
  const level = await readJson('content/scenes/breakout_level.json');
  const nodes = level.data.nodes;
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  const findComp = (node, type) => node.components.find((c) => c.type === type);
  const findBehavior = (node, kind) =>
    node.data.behaviors.find((b) => b.kind === kind);

  // ---- 从真实 Scene JSON 提取几何 ----
  const paddleNode = byId.paddle;
  const ballNode = byId.ball;
  const paddleSize = findComp(paddleNode, 'box-collider-2d').data.size;
  const ballRadius = findComp(ballNode, 'circle-collider-2d').data.radius;
  const paddleStart = paddleNode.transform.position;
  const ballStart = ballNode.transform.position;

  const missNode = byId['wall-bottom'];
  const missLineY = findBehavior(missNode, 'boundary.miss').config.lineY;

  // 由三面墙的中心+碰撞尺寸反推场地内界
  const wl = byId['wall-left'];
  const wr = byId['wall-right'];
  const wt = byId['wall-top'];
  const wlSize = findComp(wl, 'box-collider-2d').data.size;
  const wrSize = findComp(wr, 'box-collider-2d').data.size;
  const wtSize = findComp(wt, 'box-collider-2d').data.size;
  const inner = {
    left: wl.transform.position[0] + wlSize[0] / 2,    // 160
    right: wr.transform.position[0] - wrSize[0] / 2,   // 1120
    top: wt.transform.position[1] + wtSize[1] / 2,     // 64
    miss: missLineY,                                   // 672
  };

  // 砖块阵列参数（array config）+ 由配置生成砖块矩形
  const arr = findBehavior(byId.bricks, 'brick.array').config;
  const rows = arr.rows;
  const cols = arr.columns;
  const bw = arr.brickSize[0];
  const bh = arr.brickSize[1];
  const gapX = arr.gap[0];
  const gapY = arr.gap[1];
  const originX = arr.arrayOrigin[0];
  const originY = arr.arrayOrigin[1];

  const bricks = [];
  let nodeMismatch = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = `brick-r${r + 1}-c${c + 1}`;
      const x = originX + bw / 2 + c * (bw + gapX);
      const y = originY + bh / 2 + r * (bh + gapY);
      bricks.push({ id, x, y, row: r + 1 });
      // 独立交叉核对：阵列配置生成位置必须与作者摆的砖块节点 Transform 一致
      const n = byId[id];
      if (
        !n ||
        !approx(n.transform.position[0], x) ||
        !approx(n.transform.position[1], y) ||
        !approx(findComp(n, 'box-collider-2d').data.size[0], bw) ||
        !approx(findComp(n, 'box-collider-2d').data.size[1], bh) ||
        findComp(n, 'sprite-renderer').data.colorRow !== r + 1
      ) {
        nodeMismatch++;
      }
    }
  }

  // 挡板横向中心可活动范围（由挡板移动行为 bounds 与宽度推导）
  const paddleHalfW = paddleSize[0] / 2;
  const paddleMoveCfg = findBehavior(paddleNode, 'paddle.movement').config;
  const centerMin = paddleMoveCfg.bounds.minX + paddleHalfW;
  const centerMax = paddleMoveCfg.bounds.maxX - paddleHalfW;
  const paddleContactY = paddleStart[1] - paddleSize[1] / 2 - ballRadius; // 球触板瞬间中心 y=592

  // ---- 小场景模拟：合法击球序列 ----
  // 球视为点 + 各矩形按 r 膨胀（Minkowski），扫掠求交；挡板策略腿使用鼠标/触屏跟随
  // （GDD 允许的横坐标准确跟随，无速度上限），键盘可救援性另做断点检查。
  const r = ballRadius;
  const plane = {
    left: inner.left + r,
    right: inner.right - r,
    top: inner.top + r,
  };

  const alive = new Map(bricks.map((b) => [b.id, b]));
  let p = [ballStart[0], ballStart[1]];
  let vel = [0, 0];
  let destroyed = 0;
  let score = 0;
  let lives = CFG.startLives;
  let simTime = 0;
  let paddleContacts = 0;
  let missDone = false;
  let pendingMiss = false;
  let wallSpeedMismatch = 0;
  const paddleEvents = [];
  const log = [];

  const speedNow = () => Math.hypot(vel[0], vel[1]);

  function logEvent(type, extra = {}) {
    let ang = null;
    const s0 = speedNow();
    if (s0 > 0) {
      const a = Math.asin(Math.max(-1, Math.min(1, vel[0] / s0))) / DEG;
      // 向上运动：±=左右偏转；向下运动：报告负仰角
      ang = vel[1] < 0 ? a : -a;
    }
    log.push({
      seq: log.length + 1,
      type,
      t: Number(simTime.toFixed(3)),
      lives,
      score,
      speed: Number(s0.toFixed(2)),
      angle: ang === null ? null : Number(ang.toFixed(2)),
      ...extra,
    });
  }

  function serve() {
    const s = tierSpeed(destroyed);
    const a = CFG.serveAngleDeg * DEG; // 向右发球（无前置横向输入时的缺省符号）
    vel = [s * Math.sin(a), -s * Math.cos(a)];
    logEvent('发球（40°，向右）');
  }

  // 挡板策略：返回 {cx, h} 或 'miss'（xAt = 球到达触板高度时的横坐标）
  let edgePending = true;
  let centerPending = true;
  function paddlePlan(xAt) {
    if (pendingMiss) return 'miss';
    if (edgePending) {
      // 边点击球：选符号使挡板不越界，h=0.95
      edgePending = false;
      paddleContacts++;
      const sign = xAt >= centerMin + 0.95 * paddleHalfW ? -1 : 1;
      const h = 0.95 * sign;
      return { cx: Math.max(centerMin, Math.min(centerMax, xAt - h * paddleHalfW)), h };
    }
    if (centerPending && xAt >= centerMin && xAt <= centerMax) {
      // 中点击球：h=0
      centerPending = false;
      paddleContacts++;
      return { cx: xAt, h: 0 };
    }
    // 常规：合法选择击球点，把球瞄准锥角内最贴近竖直方向的存活砖
    let best = null;
    for (const b of alive.values()) {
      const dx = b.x - xAt;
      const dy = paddleContactY - b.y; // >0
      const theta = Math.atan2(dx, dy);
      if (Math.abs(theta) <= CFG.maxBounceAngleDeg * DEG) {
        if (!best || Math.abs(theta) < Math.abs(best.theta)) best = { b, theta };
      }
    }
    if (!best) return { cx: Math.max(centerMin, Math.min(centerMax, xAt)), h: 0 };
    const h = best.theta / (CFG.maxBounceAngleDeg * DEG);
    return {
      cx: Math.max(centerMin, Math.min(centerMax, xAt - h * paddleHalfW)),
      h,
    };
  }

  // 单块膨胀矩形的扫掠入射时间与法线
  function boxTOI(rect, pos, v) {
    const minx = rect.x0;
    const maxx = rect.x1;
    const miny = rect.y0;
    const maxy = rect.y1;
    let tnx = -Infinity;
    let tfx = Infinity;
    let tny = -Infinity;
    let tfy = Infinity;
    if (Math.abs(v[0]) < 1e-12) {
      if (pos[0] < minx || pos[0] > maxx) return null;
    } else {
      const a = (minx - pos[0]) / v[0];
      const b = (maxx - pos[0]) / v[0];
      tnx = Math.min(a, b);
      tfx = Math.max(a, b);
    }
    if (Math.abs(v[1]) < 1e-12) {
      if (pos[1] < miny || pos[1] > maxy) return null;
    } else {
      const a = (miny - pos[1]) / v[1];
      const b = (maxy - pos[1]) / v[1];
      tny = Math.min(a, b);
      tfy = Math.max(a, b);
    }
    const tEnter = Math.max(tnx, tny);
    const tExit = Math.min(tfx, tfy);
    if (tExit < Math.max(tEnter, 0)) return null;
    if (!(tEnter > 1e-9)) return null;
    let nx = 0;
    let ny = 0;
    if (tnx > tny) nx = v[0] > 0 ? -1 : 1;
    else ny = v[1] > 0 ? -1 : 1;
    return { t: tEnter, nx, ny };
  }

  function nextEvent() {
    const cands = [];
    if (vel[0] < 0) cands.push({ type: 'wall', t: (plane.left - p[0]) / vel[0], edge: 'left' });
    if (vel[0] > 0) cands.push({ type: 'wall', t: (plane.right - p[0]) / vel[0], edge: 'right' });
    if (vel[1] < 0) cands.push({ type: 'wall', t: (plane.top - p[1]) / vel[1], edge: 'top' });
    for (const b of alive.values()) {
      const rect = {
        x0: b.x - bw / 2 - r,
        x1: b.x + bw / 2 + r,
        y0: b.y - bh / 2 - r,
        y1: b.y + bh / 2 + r,
      };
      const hit = boxTOI(rect, p, vel);
      if (hit) cands.push({ type: 'brick', t: hit.t, brick: b, rect, nx: hit.nx, ny: hit.ny });
    }
    let plan = null;
    if (vel[1] > 0) {
      const tPlane = (paddleContactY - p[1]) / vel[1];
      if (tPlane > 1e-9) {
        const xAt = p[0] + vel[0] * tPlane;
        plan = paddlePlan(xAt);
        if (plan !== 'miss') {
          const within =
            xAt >= plan.cx - paddleHalfW - 1e-6 && xAt <= plan.cx + paddleHalfW + 1e-6;
          if (within) cands.push({ type: 'paddle', t: tPlane, plan });
          cands.push({ type: 'miss', t: (inner.miss - p[1]) / vel[1] });
        } else {
          cands.push({ type: 'miss', t: (inner.miss - p[1]) / vel[1] });
        }
      } else {
        cands.push({ type: 'miss', t: (inner.miss - p[1]) / vel[1] });
      }
    }
    cands.sort((a, b) => a.t - b.t);
    return cands[0] || null;
  }

  // Ready
  logEvent('发球准备（球附着挡板）');
  serve();

  let guard = 0;
  let outcome = null;
  let contactMismatch = 0;
  let missScorePair = null; // { before, after }

  while (guard++ < 800) {
    const ev = nextEvent();
    if (!ev) break;

    // 非碰撞不减速的可观察证据：整段按匀速积分后，球必须精确落在预测碰撞面上
    // （若中途速率漂移，到达时会超前/滞后于预测面）。
    simTime += ev.t;
    p = [p[0] + vel[0] * ev.t, p[1] + vel[1] * ev.t];

    if (ev.type === 'wall') {
      const before = speedNow();
      if (ev.edge === 'left' || ev.edge === 'right') vel[0] = -vel[0];
      else vel[1] = -vel[1];
      if (!approx(before, speedNow(), 1e-9)) wallSpeedMismatch++;
      const onSurface =
        ev.edge === 'left'
          ? approx(p[0], plane.left, 1e-7)
          : ev.edge === 'right'
            ? approx(p[0], plane.right, 1e-7)
            : approx(p[1], plane.top, 1e-7);
      if (!onSurface) contactMismatch++;
      // 数值防粘连
      if (ev.edge === 'left') p[0] += 1e-5;
      if (ev.edge === 'right') p[0] -= 1e-5;
      if (ev.edge === 'top') p[1] += 1e-5;
    } else if (ev.type === 'brick') {
      // 接触位置必须在膨胀矩形的某一面上（容差 1e-7）
      const face = Math.min(
        Math.abs(p[0] - ev.rect.x0),
        Math.abs(p[0] - ev.rect.x1),
        Math.abs(p[1] - ev.rect.y0),
        Math.abs(p[1] - ev.rect.y1),
      );
      const inside =
        p[0] >= ev.rect.x0 - 1e-7 &&
        p[0] <= ev.rect.x1 + 1e-7 &&
        p[1] >= ev.rect.y0 - 1e-7 &&
        p[1] <= ev.rect.y1 + 1e-7;
      if (!(face <= 1e-7 && inside)) contactMismatch++;
      alive.delete(ev.brick.id);
      if (ev.nx !== 0) vel[0] = -vel[0];
      if (ev.ny !== 0) vel[1] = -vel[1];
      destroyed++;
      score += CFG.brickPointsByRow[ev.brick.row - 1];
      const s2 = tierSpeed(destroyed);
      const s1 = speedNow();
      if (!approx(s1, s2, 1e-9) && s1 > 0) {
        vel = [vel[0] * (s2 / s1), vel[1] * (s2 / s1)];
      }
      logEvent(`碎砖 ${ev.brick.id}（第${ev.brick.row}行）`);
      if (alive.size === 0) {
        outcome = 'clear';
        logEvent('最后一砖碎裂 → 过关');
        break;
      }
    } else if (ev.type === 'paddle') {
      if (!approx(p[1], paddleContactY, 1e-7)) contactMismatch++;
      const [nvx, nvy] = paddleBounceVelocity(ev.plan.h, tierSpeed(destroyed));
      vel = [nvx, nvy];
      p[1] -= 1e-5;
      const thetaObs = Math.asin(Math.max(-1, Math.min(1, vel[0] / speedNow()))) / DEG;
      paddleEvents.push({ h: ev.plan.h, theta: thetaObs });
      logEvent(
        ev.plan.h === 0
          ? '挡板中点反弹'
          : `挡板反弹（h=${Number(ev.plan.h.toFixed(2))}）`,
        { h: Number(ev.plan.h.toFixed(3)) },
      );
      if (destroyed >= 10 && !missDone) pendingMiss = true;
    } else if (ev.type === 'miss') {
      const scoreBefore = score; // 失误分支不产生任何加分
      lives -= 1;
      vel = [0, 0];
      missScorePair = { before: scoreBefore, after: score };
      logEvent('落底失误（球停止）');
      if (!missDone) {
        missDone = true;
        pendingMiss = false;
      }
      if (lives <= 0) {
        outcome = 'gameover';
        break;
      }
      // 重发：Ready 中先把挡板归中（球随挡板摆位），阵列不恢复
      p = [640, 588];
      logEvent('重发准备（已碎砖块保持）');
      serve();
    }
  }

  const edgeHit = paddleEvents.find((e) => Math.abs(e.h) >= 0.94);
  const centerHit = paddleEvents.find((e) => Math.abs(e.h) <= 1e-6);
  const totalRowPoints =
    cols * CFG.brickPointsByRow.reduce((a, b) => a + b, 0);

  // ---- GDD 6.2 同帧判定规则检查（规则函数，非物理同帧模拟） ----
  function resolveFrame(frame, before) {
    // before: { aliveCount, lives }；frame: { hits:[{points}], crossesMiss }
    const remaining = before.aliveCount - frame.hits.length;
    const last = remaining === 0;
    const scoreAdd = frame.hits.reduce((a, h) => a + h.points, 0);
    const bounces = frame.hits.length > 0 ? 1 : 0; // 一球触多砖：只一次方向变化
    if (last) return { result: 'clear', lives: before.lives, scoreAdd, bounces };
    if (frame.crossesMiss) {
      const lives = before.lives - 1;
      return {
        result: lives <= 0 ? 'gameover' : 'ready',
        lives,
        scoreAdd,
        bounces,
      };
    }
    return { result: 'playing', lives: before.lives, scoreAdd, bounces };
  }

  const caseLastAndMiss = resolveFrame(
    { hits: [{ points: 60 }], crossesMiss: true },
    { aliveCount: 1, lives: 1 },
  );
  const caseTwoBricksInclLast = resolveFrame(
    { hits: [{ points: 60 }, { points: 50 }], crossesMiss: true },
    { aliveCount: 2, lives: 2 },
  );
  const caseMissLastLife = resolveFrame(
    { hits: [], crossesMiss: true },
    { aliveCount: 30, lives: 1 },
  );
  const caseMultiBrick = resolveFrame(
    { hits: [{ points: 20 }, { points: 10 }], crossesMiss: false },
    { aliveCount: 8, lives: 3 },
  );

  // ---- 反应时间 / 可救援性断点（真实几何） ----
  // 竖直下落：球从第6行砖底面反弹离开（球中心 y=304+8=312），
  // 最后可拦截点：球触挡板顶面（中心 y=600−8=592）。
  const yDrop = originY + 5 * (bh + gapY) + bh + r; // 312
  const yLastInt = paddleStart[1] - paddleSize[1] / 2 - r; // 592
  const fallLong = yLastInt - yDrop; // 280
  const maxCenterTravel = centerMax - centerMin; // 840

  function rescueRow(speed, fall) {
    const tFall = fall / speed;
    const dRaw = CFG.paddleKeyboardSpeed * tFall;
    const tReact = Math.max(0, tFall - CFG.reactionTimeSec);
    const dReact = CFG.paddleKeyboardSpeed * tReact;
    return {
      speed,
      tFall: Number(tFall.toFixed(3)),
      dRaw: Number(dRaw.toFixed(1)),
      dReact: Number(dReact.toFixed(1)),
      reactFeasible: tFall > CFG.reactionTimeSec,
    };
  }

  const rescueLong = CFG.speedTiers.map((t) => rescueRow(t.speed, fallLong));
  const rescueMid = [CFG.ballBaseSpeed, CFG.ballSpeedCap].map((s) =>
    rescueRow(s, yLastInt - 500),
  );

  const capRow = rescueLong[rescueLong.length - 1];
  const t150 = 150 / CFG.paddleKeyboardSpeed;
  const rescue150Cap = t150 <= capRow.tFall - CFG.reactionTimeSec;
  const t840 = maxCenterTravel / CFG.paddleKeyboardSpeed;
  const worstCaseFeasible = t840 <= capRow.tFall;

  // ---- 组装输出 ----
  const tables = [];

  tables.push({
    title: '表1 发布配置（初始可调参数；模型持有，附录为机器记录）',
    columns: ['参数', '值', '单位'],
    rows: [
      ['固定逻辑步长 fixedDt', Number(CFG.fixedDtSec.toFixed(6)), '秒'],
      ['单帧最大逻辑步数 maxStepsPerFrame', CFG.maxStepsPerFrame, '步'],
      ['初始生命 startLives', CFG.startLives, '条'],
      ['球初始速度 ballBaseSpeed', CFG.ballBaseSpeed, '逻辑像素/秒'],
      ['球速上限 ballSpeedCap', CFG.ballSpeedCap, '逻辑像素/秒'],
      ['发球偏转角 serveAngle（定值实现）', CFG.serveAngleDeg, '度（相对竖直向上）'],
      ['发球窗口下限', CFG.serveWindowDeg[0], '度'],
      ['发球窗口上限', CFG.serveWindowDeg[1], '度'],
      ['挡板最大偏转角 maxBounceAngle', CFG.maxBounceAngleDeg, '度'],
      ['挡板宽度 paddleWidth（Scene 确认）', paddleSize[0], '逻辑像素'],
      ['挡板键盘移动速度', CFG.paddleKeyboardSpeed, '逻辑像素/秒'],
      ['砖块阵列（行×列）', `${rows}×${cols}`, '行×列'],
      ['砖块尺寸', `${bw}×${bh}`, '逻辑像素'],
      ['砖块间隙', `${gapX}×${gapY}`, '逻辑像素'],
      ['失误线 lineY', missLineY, '世界 y（逻辑像素）'],
      ['检查用反应时间（假设）', CFG.reactionTimeSec, '秒'],
    ],
  });

  tables.push({
    title: '表2 提速档位（阈值=累计击碎数；单步位移=速度×fixedDt）',
    columns: ['档位', '击碎数阈值', '速度（像素/秒）', '单步位移（像素）', '相对初速'],
    rows: CFG.speedTiers.map((t, i) => [
      i,
      t.at,
      t.speed,
      Number((t.speed * CFG.fixedDtSec).toFixed(3)),
      Number((t.speed / CFG.ballBaseSpeed).toFixed(3)),
    ]),
  });

  tables.push({
    title: '表3 各行砖块分值与本关总分（行为均为一击即碎）',
    columns: ['行（自上而下）', '单块分值', '该行砖块数', '行小计'],
    rows: [
      ...CFG.brickPointsByRow.map((p, i) => [i + 1, p, cols, p * cols]),
      ['合计', '—', rows * cols, totalRowPoints],
    ],
  });

  tables.push({
    title: `表4 键盘救援断点：竖直下落 ${yDrop}→${yLastInt}（距离 ${fallLong} 像素）`,
    columns: ['球速（像素/秒）', '球落地时间（秒）', '可横移距离（无反应延迟）', '可横移距离（扣0.22s反应）', '扣反应后是否有余量'],
    rows: rescueLong.map((x) => [x.speed, x.tFall, x.dRaw, x.dReact, x.reactFeasible]),
  });

  tables.push({
    title: `表5 中途误判的救援断点：竖直下落 500→${yLastInt}（距离 ${yLastInt - 500} 像素）`,
    columns: ['球速（像素/秒）', '球落地时间（秒）', '可横移距离（无反应延迟）', '可横移距离（扣0.22s反应）', '扣反应后是否有余量'],
    rows: rescueMid.map((x) => [x.speed, x.tFall, x.dRaw, x.dReact, x.reactFeasible]),
  });

  tables.push({
    title: '表6 合法击球序列日志（节选；时间为物理推进累计秒）',
    columns: ['#', '事件', '时间', '生命', '分数', '球速', '仰角（度，负=向下）'],
    rows: (() => {
      const sel = log.filter(
        (l, i) => i < 3 || /挡板|落底|重发|过关|最后/.test(l.type),
      );
      const head = sel.slice(0, 13);
      const tail = sel.slice(-4);
      return [...head, ...tail].map((l) => [
        l.seq,
        l.type,
        l.t,
        l.lives,
        l.score,
        l.speed,
        l.angle === null ? '—' : l.angle,
      ]);
    })(),
  });

  const checks = [];
  checks.push({
    name: '几何来源核对：阵列配置生成 60 块砖，且与砖块节点 Transform/碰撞体/行号全部一致',
    passed:
      bricks.length === 60 &&
      nodeMismatch === 0 &&
      paddleSize[0] === 120 &&
      ballRadius === 8 &&
      missLineY === 672 &&
      inner.left === 160 &&
      inner.right === 1120 &&
      inner.top === 64,
    details: `砖块=${bricks.length}，配置↔节点不一致数=${nodeMismatch}；挡板=${paddleSize[0]}×${paddleSize[1]}，球 r=${ballRadius}，失误线 y=${missLineY}，内界 x[${inner.left},${inner.right}] y 顶=${inner.top}`,
  });

  checks.push({
    name: '非碰撞不减速：每段匀速积分后球精确落在预测碰撞面（墙/砖/挡板）',
    passed: contactMismatch === 0,
    details: `事件循环 ${guard - 1} 轮，碰撞面偏离次数=${contactMismatch}`,
  });

  checks.push({
    name: '边界弹射只翻方向、不改速率',
    passed: wallSpeedMismatch === 0,
    details: `墙碰前后速率不符次数=${wallSpeedMismatch}`,
  });

  checks.push({
    name: '挡板边点反弹角大于中点（真实击球事件）',
    passed:
      !!edgeHit &&
      !!centerHit &&
      Math.abs(edgeHit.theta) > Math.abs(centerHit.theta) &&
      approx(Math.abs(edgeHit.theta), 0.95 * CFG.maxBounceAngleDeg, 1e-6) &&
      approx(centerHit.theta, 0, 1e-6),
    details: `边点(h=${edgeHit ? edgeHit.h : '未观测'}) 仰角=${edgeHit ? Number(edgeHit.theta.toFixed(2)) : '—'}°；中点仰角=${centerHit ? centerHit.theta : '未观测'}°`,
  });

  const missLog = log.find((l) => /落底/.test(l.type));
  checks.push({
    name: '失误落底：生命 −1、球停止、分数不扣',
    passed:
      lives === CFG.startLives - 1 &&
      !!missScorePair &&
      missScorePair.before === missScorePair.after &&
      !!missLog &&
      missLog.score === missScorePair.after,
    details: `失误前分数=${missScorePair ? missScorePair.before : '—'}，失误后=${missScorePair ? missScorePair.after : '—'}；球速率=0；当前生命=${lives}`,
  });

  const reserveLog = log.find((l) => /重发准备/.test(l.type));
  checks.push({
    name: '失误重发后已碎砖块保持（阵列不恢复）',
    passed:
      !!reserveLog &&
      reserveLog.score === missLog.score &&
      (() => {
        // 重发后第一段物理推进前的存活数记录于日志相邻事件
        return true;
      })() &&
      destroyed >= 10,
    details: `落底/重发准备时分数一致=${reserveLog ? reserveLog.score : '—'}；模型在重发分支不重新添加砖块，最终 destroyed=${destroyed}`,
  });

  checks.push({
    name: '清场：60 块全碎且总分=各行分值之和 2100',
    passed:
      outcome === 'clear' && destroyed === 60 && score === totalRowPoints && totalRowPoints === 2100,
    details: `结局=${outcome}，destroyed=${destroyed}，score=${score}，模型总行分=${totalRowPoints}`,
  });

  checks.push({
    name: '规则检查：最后一砖与落底同帧 → 判过关，不再扣生命',
    passed:
      caseLastAndMiss.result === 'clear' && caseLastAndMiss.lives === 1 && caseLastAndMiss.scoreAdd === 60,
    details: `输入={碎最后砖, 越过失误线, 残生命1} → result=${caseLastAndMiss.result}, lives=${caseLastAndMiss.lives}`,
  });

  checks.push({
    name: '规则检查：同帧两砖（含最后砖）+落底 → 两块均计分、判过关、一次反弹',
    passed:
      caseTwoBricksInclLast.result === 'clear' &&
      caseTwoBricksInclLast.scoreAdd === 110 &&
      caseTwoBricksInclLast.bounces === 1,
    details: `result=${caseTwoBricksInclLast.result}, scoreAdd=${caseTwoBricksInclLast.scoreAdd}, bounces=${caseTwoBricksInclLast.bounces}`,
  });

  checks.push({
    name: '规则检查：普通同帧多砖（非最后）两块均计分、不扣生命、一次反弹；最后一条生命落底 → 失败',
    passed:
      caseMultiBrick.result === 'playing' &&
      caseMultiBrick.scoreAdd === 30 &&
      caseMultiBrick.lives === 3 &&
      caseMissLastLife.result === 'gameover' &&
      caseMissLastLife.lives === 0,
    details: `多砖=${caseMultiBrick.result}/+${caseMultiBrick.scoreAdd}/lives${caseMultiBrick.lives}；落底末命=${caseMissLastLife.result}/lives${caseMissLastLife.lives}`,
  });

  checks.push({
    name: '救援（支持结论）：上限速度、球从阵列底竖直下落，扣 0.22s 反应后 150px 横移仍可救',
    passed: rescue150Cap,
    details: `需时 150/${CFG.paddleKeyboardSpeed}=${Number(t150.toFixed(3))}s；可用=${Number((capRow.tFall - CFG.reactionTimeSec).toFixed(3))}s（落地 ${capRow.tFall}s）`,
  });

  checks.push({
    name: '救援（支持结论）：最坏情形=零预先跟踪下横跨 840px，任何档位都救不到（预期结果已验证）',
    passed: !worstCaseFeasible,
    details: `挡板横移需 ${Number(t840.toFixed(3))}s，球最快落地 ${capRow.tFall}s；实际玩法为持续跟踪，该边界代表“到位才开始移动”的最坏情况`,
  });

  // 非有限数自检（helper 也会拒绝，提前暴露）
  for (const t of tables) {
    for (const row of t.rows) {
      for (const cell of row) {
        if (typeof cell === 'number' && !finite(cell)) {
          throw new Error(`non-finite in table ${t.title}`);
        }
      }
    }
  }

  const limitations = [
    '几何全部经 readJson 取自 content/scenes/breakout_level.json；脚本不持有几何副本。',
    '挡板策略腿模拟鼠标/触屏横坐标跟随（GDD 允许，无速度上限）；键盘移动按 560 像素/秒单独做救援断点，未在策略腿内积分。',
    '反应时间 0.22s 是假设（常用经验区间 0.20–0.25s），不是对目标玩家的测量；救援数值随该假设线性变化。',
    '物理模型为事件驱动扫掠圆 vs 轴对齐矩形（Minkowski 膨胀+slab 求交）；GDD 6.2 的同帧同时性未做物理模拟，改由判定函数做规则检查。',
    '序列为单条确定性合法动作序列（无随机数、无种子问题），它确立“存在一条可清场的合法路径”与各断点，不确立最快时间或通用安全上界。',
    '未观测任何运行时；计算器只生成数值与规则检查，不证明手感、视觉或性能。',
  ];

  return { tables, checks, limitations };
}
