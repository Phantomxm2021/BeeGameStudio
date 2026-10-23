// Thin developer client, not another workflow engine. Never persist credentials
// or repeat a mutation after failure; all authority stays in the normal API.
const el = id => document.getElementById(id);
const pretty = value => JSON.stringify(value, null, 2);
let view, loaded, loadedConnection, connection, preview, questionView, questionConnection, observationConnection, observationSource, restoredChat, chatConnection, goalRequest, messageRequest, messageConnection, saveRequest, eventView, eventConnection, busy = false;
let pendingActions = 0, actionSequence = 0, stopping = false;
const urls = new Set();
const pendingReads = new Set();
let pendingConfirmation;
function finishConfirmation(accepted) {
  if (!pendingConfirmation) return;
  const resolve = pendingConfirmation;
  pendingConfirmation = undefined;
  el('action-confirm').close();
  resolve(accepted);
}
async function confirmAction(message) {
  if (pendingConfirmation) throw Error('已有操作等待确认；不会另发请求');
  const identity = credentials();
  el('action-confirm-message').textContent = message + '\n\n项目：' + identity.project;
  const answer = new Promise(resolve => { pendingConfirmation = resolve; });
  try {
    el('action-confirm-cancel').disabled = false;
    el('action-confirm-accept').disabled = false;
    el('action-confirm').showModal();
    el('action-confirm-cancel').focus();
    const accepted = await answer;
    if (accepted && !sameIdentity(identity, credentials())) throw Error('确认期间项目或身份改变；没有发送旧操作');
    return accepted;
  } finally { finishConfirmation(false); }
}
el('action-confirm-cancel').addEventListener('click', () => finishConfirmation(false));
el('action-confirm-accept').addEventListener('click', () => finishConfirmation(true));
el('action-confirm').addEventListener('cancel', event => { event.preventDefault(); finishConfirmation(false); });
el('action-confirm').addEventListener('close', () => { if (!el('action-confirm').open) finishConfirmation(false); });
function credentials() {
  const project = el('project').value.trim(), authMode = el('auth-mode').value;
  const token = authMode === 'session' ? '' : el('token').value.trim();
  if (!project || authMode !== 'session' && !token) throw Error('请输入项目 ID，并选择已有登录态或提供正常用户 Access Token');
  return { project, token, authMode };
}
function sameIdentity(a, b) { return a && b && a.project === b.project && a.token === b.token && a.authMode === b.authMode; }
function current() {
  const value = credentials();
  if (!view?.run || !sameIdentity(value, connection))
    throw Error('请先读取当前项目 Run');
  return view.run;
}
async function request(path, method = 'GET', body, binary = false) {
  const identity = credentials();
  const readController = method === 'GET' ? new AbortController() : undefined;
  if (readController) pendingReads.add(readController);
  try {
  const response = await fetch('/api/projects/' + encodeURIComponent(identity.project) + path, {
    method, redirect: 'error', credentials: identity.authMode === 'session' ? 'same-origin' : 'omit',
    // A stalled read must not hold the debug UI forever. This does not cancel,
    // replay or impose a time limit on the native Agent or server mutations.
    ...(readController ? { signal: AbortSignal.any([readController.signal, AbortSignal.timeout(15000)]) } : {}),
    headers: { ...(identity.authMode === 'session' ? {} : { Authorization: 'Bearer ' + identity.token }), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: pretty(body) } : {}),
  });
  if (!response.ok) {
    let detail;
    try { detail = await response.json(); } catch { detail = {}; }
    throw Error('HTTP ' + response.status + ' ' + (detail.code || '') + ': ' + (detail.error || '请求失败；没有自动重试'));
  }
  const result = binary ? await response.blob() : await response.json();
  // Changing project/credentials during an in-flight request never applies its
  // response to a different project. The old operation is NOT sent again.
  const now = credentials();
  if (!sameIdentity(now, identity))
    throw Error('请求期间项目或身份改变；旧操作可能已执行，请单独核对，不自动重试');
  return result;
  } finally { if (readController) pendingReads.delete(readController); }
}
function dropPreview() {
  preview = undefined;
  el('preview-frame').removeAttribute('src');
  el('preview-frame').hidden = true;
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear(); el('downloads').replaceChildren();
}
function option(value, text) { const node = document.createElement('option'); node.value = value; node.textContent = text; return node; }
async function load() {
  const result = await request('/workflow-v3');
  if (sameIdentity(connection, credentials()) && view?.run?.id === result.run?.id && view?.run?.version > result.run?.version)
    return { ignoredStaleRead: true, currentVersion: view.run.version };
  view = result; connection = credentials();
  if (questionView && (result.run?.paused || questionView.runId !== result.run?.id ||
      questionView.requirementsRevision !== result.run?.requirements?.revision ||
      questionView.questions.some(q => q.attemptId !== result.run?.writer?.attemptId))) {
    questionView = questionConnection = undefined;
    el('question').replaceChildren(); showQuestion();
  }
  eventView = undefined; eventConnection = undefined;
  dropPreview();
  el('run').textContent = pretty(result);
  // Default to the newest actual result, including failed/incomplete results;
  // never silently select an earlier success. Historical receipts remain selectable.
  el('measurement').replaceChildren(...(result.run?.agentTurns || []).flatMap(turn => turn.measurements || []).reverse().map(m =>
    option(m.id, m.id + ' · ' + (m.finishedAt || m.startedAt || '时间未知') + ' · ' + m.runtimeArtifact + ' · ' +
      (m.error || (m.finishedAt ? m.checks.map(c=>c.id+':'+c.status).join(', ') : '结果未知')))));
  // Leave loaded JSON/proposals and their ORIGINAL versions untouched.
  return result;
}
function showDocument() {
  const entry = loaded?.documents?.find(d => d.path === el('document').value);
  el('document-json').value = entry ? pretty(entry.document) : '';
}
function selected() {
  const run = current(), measurementId = el('measurement').value;
  if (!run.agentTurns?.some(t => t.measurements?.some(m => m.id === measurementId)))
    throw Error('没有选中的实际宿主测量；不能用报告 PASS 代替');
  return { measurementId, requirementsRevision: run.requirements.revision };
}
function showQuestion() {
  const question = questionView?.questions.find(q => q.toolUseID === el('question').value);
  el('question-detail').textContent = question ? pretty(question) : '没有当前可答原生问题；历史事件不是待答请求';
  el('answers').value = question ? pretty(Object.fromEntries(question.input.questions.map(q => [q.question, '']))) : '';
}
async function answerQuestion(decision) {
  const run = current(), question = questionView?.questions.find(q => q.toolUseID === el('question').value);
  if (!question?.canAnswer || run.paused || run.writer?.attemptId !== question.attemptId || !sameIdentity(questionConnection, connection) ||
      questionView.runId !== run.id || questionView.planRevision !== run.planRevision || questionView.requirementsRevision !== run.requirements.revision)
    throw Error('请读取当前可答问题；旧来源、暂停或历史问题不能授权');
  const answers = decision === 'allow' ? JSON.parse(el('answers').value) : undefined;
  if (!await confirmAction(decision === 'allow' ? '确认这是你对所显示原生问题的答复？源变化时宿主会拒绝。' : '确认拒绝本次问题？不会默认授权。')) return { cancelled: true };
  const result = await request('/permissions/' + encodeURIComponent(question.toolUseID), 'POST', { decision, scope: 'once', ...(answers ? { answers } : {}) });
  if (!result.resolved || result.stale) throw Error('原生问题已失效；答复未被接收，保留草稿，请重新核对');
  question.canAnswer = false;
  return { ...result, authorizationValidated: false, note: '仅交互接收；请显式读取 Question 验证结果或原始事件。不会自动重试。' };
}
const actions = {
  'read-measurement': () => {
    const selection=selected();
    if(!selection.measurementId)throw Error('此入口只核对自主 Agent 测量');
    return request('/workflow-v3/agent/measurements/'+encodeURIComponent(selection.measurementId));
  },
  load, events: async () => {
    current(); eventView = await request('/workflow-v3/events?limit=100'); eventConnection = { ...connection }; return eventView;
  },
  'events-earlier': async () => {
    const run = current();
    if (!eventView?.hasMore || eventView.nextBeforeId === null || eventView.runId !== run.id || !sameIdentity(eventConnection, connection))
      throw Error('请先读取当前项目事件；没有可继续的历史页');
    eventView = await request('/workflow-v3/events?limit=100&beforeId=' + encodeURIComponent(eventView.nextBeforeId) +
      '&attemptId=' + encodeURIComponent(eventView.attemptId));
    return eventView;
  },
  'restore-chat': async () => {
    const result = await request('/session/ensure', 'POST', {});
    restoredChat = result.session; chatConnection = credentials();
    return { ...result, dispatched: false, note: '只恢复正常项目 Chat；没有恢复暂停或执行任务。请核对其 ID 与现有 Run 绑定。' };
  },
  'prepare-goal': () => {
    if (!restoredChat?.id || !sameIdentity(chatConnection, credentials())) throw Error('请先恢复本项目所属 Chat');
    goalRequest = { requestKey: crypto.randomUUID(), chatSessionId: restoredChat.id };
    return { ...goalRequest, dispatched: false, note: '填写实际完整目标；不会默认生成方案或 Task' };
  },
  'submit-goal': async () => {
    if (!goalRequest || !sameIdentity(chatConnection, credentials())) throw Error('请先恢复 Chat 并准备接单身份');
    const brief = JSON.parse(el('goal-brief').value);
    if (!await confirmAction('把这份已确认完整目标交给原生 Agent 自主规划执行？可能产生模型费用；不是游戏验收。')) return { cancelled: true };
    const result = await request('/workflow-v3/agent/goal', 'POST', { ...goalRequest, brief });
    await load(); return result;
  },
  'prepare-message': () => {
    const run=current();
    if(!run.agentTurns || !restoredChat?.id || restoredChat.id!==run.chatSessionId || !sameIdentity(chatConnection,connection))
      throw Error('请读取 Agent Run 并恢复其所属 Chat');
    const intent=el('message-intent').value,text=el('message-text').value.trim();
    const contextMode=el('message-context').value;
    const previous=run.agentTurns.at(-1);
    if(contextMode==='focused' && (!['work','change','continue'].includes(intent)||
        !['ended','failed','interrupted'].includes(previous?.status)||!previous?.quiescedAt||!previous?.finishedAt))
      throw Error('聚焦模式须确认上轮已退出并完成结算；中断续作请选择 continue。旧权限、工具历史和仅存在于对话中的隐含决定不会转移');
    if(!text) throw Error('请输入实际用户消息');
    messageRequest={requestKey:crypto.randomUUID(),runId:run.id,chatSessionId:run.chatSessionId,
      expectedVersion:run.version,requirementsRevision:run.requirements.revision,intent,text,
      ...(contextMode==='focused'?{contextMode}:{}),
      ...(intent==='continue'?{continuationOf:run.agentTurns.at(-1)?.attemptId}:{})};
    messageConnection={...connection};
    return {...messageRequest,dispatched:false};
  },
  'submit-message': async () => {
    current();
    if(!messageRequest || !sameIdentity(messageConnection,credentials())) throw Error('请先准备本项目当前版本的消息');
    if(messageRequest.text!==el('message-text').value.trim() || messageRequest.intent!==el('message-intent').value ||
      (messageRequest.contextMode??'resume')!==el('message-context').value)
      throw Error('消息内容或授权改变，请重新准备；旧请求身份不能复用为新消息');
    if(!await confirmAction('确认发送此 '+messageRequest.intent+' 消息到原项目会话？可能产生模型费用；不会自动重复原始目标。')) return {cancelled:true};
    const result=await request('/workflow-v3/agent/messages','POST',messageRequest);
    await load();return result;
  },
  'artifact-index': () => { current(); return request('/artifact-index'); },
  'read-evidence': async () => {
    current();
    const identity={...credentials()};
    const path=el('evidence-path').value.trim();
    if(!path) throw Error('请输入现存设计或报告路径；不自动创建文档');
    const before=(await request('/workflow-v3')).run;
    const source=await request('/artifacts?path='+encodeURIComponent(path));
    const after=(await request('/workflow-v3')).run;
    if(!before || !after || before.id!==after.id || before.version!==after.version)
      throw Error('读取期间 Run 或需求改变；请重新核对，没有执行或自动重试');
    const bytes=new TextEncoder().encode(source.content);
    const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    if(!sameIdentity(identity,credentials())) throw Error('核对期间项目或身份改变；没有应用旧来源结果');
    return {runId:after.id,runVersion:after.version,requirements:after.requirements,
      requirementChanges:after.requirementChanges??[],source:{...source,utf8ContentSha256:fingerprint},
      recordedTurns:(after.agentTurns??[]).map(t=>({attemptId:t.attemptId,requirementsRevision:t.requirementsRevision,
        status:t.status,startedAt:t.startedAt,finishedAt:t.finishedAt,skillUses:t.skillUses,error:t.error})),
      writerActive:Boolean(after.writer),observedAt:new Date().toISOString(),acceptance:'unverified',
      note:'当前保存文本，不是构建绑定或历史验收证据；执行中可能继续变化。报告声明、Skill 加载和执行结束均不证明专业覆盖或品质。'};
  },
  stop: async () => { current(); const result = await request('/workflow-v3/stop', 'POST'); await load(); return result; },
  resume: async () => { const run = current(); const result = await request('/workflow-v3/resume', 'POST', { planRevision: run.planRevision }); await load(); return result; },
  'recover-writer': async () => {
    const run = current();
    if (!run.writer) throw Error('没有待收尾的写者');
    if (!await confirmAction('仅凭宿主完整退出证据收尾，部分成果不验收，不恢复暂停、不重试或重新收费。确认？')) return { cancelled: true };
    const result = await request('/workflow-v3/recover-writer', 'POST', { expectedVersion: run.version, attemptId: run.writer.attemptId, fence: run.writer.fence });
    await load(); return result;
  },
  'deny-tool-permission': async () => {
    const run = current(), id = el('tool-permission-id').value.trim(), message = el('tool-permission-message').value.trim();
    if (!run.writer || run.paused || !id || !message) throw Error('核对当前写者、普通权限 ID 与拒绝原因；暂停／历史权限不可操作');
    const result = await request('/permissions/' + encodeURIComponent(id), 'POST', { decision: 'deny', scope: 'once', message });
    if (!result.resolved || result.stale) throw Error('权限已失效；没有自动重试或授权');
    return result;
  },
  questions: async () => {
    current(); questionView = await request('/workflow-v3/questions'); questionConnection = { ...connection };
    el('question').replaceChildren(...questionView.questions.map(q => option(q.toolUseID, q.toolUseID + (q.canAnswer ? ' · 待答' : ' · 不可答'))));
    showQuestion(); return questionView;
  },
  answer: () => answerQuestion('allow'), 'deny-question': () => answerQuestion('deny'),
  'prepare-observation': () => {
    const run = current(), selection = selected();
    if (!preview || preview.runId !== run.id || preview.measurementId !== selection.measurementId)
      throw Error('请显式打开选中测量的当前已测 Preview，再准备观察');
    observationSource={runId:run.id,...selection,artifactSha256:preview.artifact.sha256};
    el('observation-json').value = pretty({ requestKey: crypto.randomUUID(), ...selection,
      artifactSha256: preview.artifact.sha256, steps: '', expected: '', observed: '' });
    observationConnection = { ...connection };
    return { prepared: 'observation', dispatched: false, note: '观察未保存；填写真实内容，不自动选需求或宣称缺陷' };
  },
  'observation-message': async () => {
    const run=current(), source=observationSource, body=JSON.parse(el('observation-json').value);
    if(!run.agentTurns || source?.runId!==run.id || !source.measurementId || !sameIdentity(observationConnection,connection))
      throw Error('请先从此自主 Run 的实际 Preview 准备观察');
    for(const key of ['measurementId','requirementsRevision','artifactSha256'])
      if(body[key]!==source[key])throw Error('观察来源已改变；不可把旧观察重绑到新构建');
    if(!['steps','expected','observed'].every(k=>typeof body[k]==='string' && body[k].trim()))
      throw Error('请填写实际操作、预期及观察结果');
    const measured=await request('/workflow-v3/agent/measurements/'+encodeURIComponent(source.measurementId));
    if(!measured.freshness.current)throw Error('该构建已非当前版本；保留原观察，重新核对实际版本，不自动重绑');
    el('message-text').value='请核查这份实际构建观察。它是用户观察，不是已证实缺陷；是否修改以本次消息授权为准。\n'+pretty({...source,steps:body.steps,expected:body.expected,observed:body.observed});
    // Preparing an ordinary chat draft does not dispatch a model.
    el('message-intent').value='message';messageRequest=undefined;
    return {prepared:'native-message-draft',dispatched:false,source};
  },
  content: async () => {
    current(); loaded = await request('/game-content');
    saveRequest = undefined;
    loadedConnection = { ...connection };
    el('document').replaceChildren(...(loaded.documents || []).map(d => option(d.path, d.path)));
    showDocument(); return loaded;
  },
  save: async () => {
    current();
    if (!loaded?.editing || loaded.readOnly || !sameIdentity(loadedConnection, connection))
      throw Error('请读取本项目可编辑 JSON；只读内容不能保存');
    const path = el('document').value, entry = loaded.documents.find(d => d.path === path);
    if (!entry || !loaded.editing.paths.includes(path)) throw Error('文档不在本次编辑授权内');
    const body = {
      path, expectedRevision: entry.revision, document: JSON.parse(el('document-json').value),
      workflow: { version: loaded.editing.version, planRevision: loaded.editing.planRevision, requirementsRevision: loaded.editing.requirementsRevision },
    };
    // An uncertain response retains the same save identity. Never retry the
    // operation automatically or turn a changed draft into the same request.
    const identity = pretty(body);
    if (!saveRequest || saveRequest.identity !== identity || !sameIdentity(saveRequest.connection, connection))
      saveRequest = { identity, connection: { ...connection }, requestKey: crypto.randomUUID() };
    const result = await request('/game-content/document', 'PUT', { ...body, requestKey: saveRequest.requestKey });
    saveRequest = undefined;
    // A successful save advances this editor only, never a stale draft after a
    // conflict. Re-reading is explicit and may discard a draft only on request.
    entry.revision = result.revision; entry.document = result.document;
    if (result.workflow) Object.assign(loaded.editing, result.workflow);
    await load(); return result;
  },
  preview: async () => {
    const selection = selected(), result = await request('/workflow-v3/preview', 'POST', selection);
    const url = new URL(result.preview.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin === location.origin || url.username || url.password) throw Error('Preview 必须在独立的 HTTP(S) 来源');
    dropPreview(); preview = result.preview;
    el('preview-frame').src = url.href; el('preview-frame').hidden = false; return result;
  },
  'close-preview': async () => { current(); if (!preview) return { preview: null };
    const result = await request('/workflow-v3/preview', 'DELETE', { id: preview.id }); dropPreview(); return result; },
};
for (const [id, kind] of [['static', 'static'], ['project-export', 'project']]) actions[id] = async () => {
  const selection = selected(), blob = await request('/workflow-v3/export', 'POST', { ...selection, kind }, true);
  if (blob.type !== 'application/zip') throw Error('返回内容不是 ZIP；没有创建下载');
  const url = URL.createObjectURL(blob); urls.add(url);
  const link = document.createElement('a'); link.href = url; link.download = 'bgs-v3-' + kind + '.zip'; link.textContent = '下载 ' + kind + ' ZIP';
  el('downloads').append(link); return { kind, bytes: blob.size, note: '点击链接下载；仅已有实际测量资格' };
};
for (const [id, action] of Object.entries(actions)) el(id).addEventListener('click', async () => {
  const isStop = id === 'stop';
  if (isStop ? stopping : busy) return;
  if (isStop) {
    stopping = true;
    // Free hung diagnostic connections before sending a normal user pause.
    // Never abort/replay a save, permission answer or model dispatch request.
    for (const controller of pendingReads) controller.abort();
  }
  busy = true; pendingActions++;
  const sequence = ++actionSequence;
  const controls = () => document.querySelectorAll('button').forEach(b => {
    if (!b.closest('#action-confirm')) b.disabled = b.id === 'stop' ? stopping : busy;
  });
  controls();
  el('status').textContent = '执行 ' + id;
  el('result').textContent = '';
  try {
    const result = await action();
    if (sequence === actionSequence) { el('result').textContent = pretty(result); el('status').textContent = '完成 ' + id; }
  }
  catch (error) { if (sequence === actionSequence) el('status').textContent = error.message; }
  finally { pendingActions--; busy = pendingActions > 0; if (isStop) stopping = false; controls(); }
});
el('document').addEventListener('change', showDocument);
el('question').addEventListener('change', showQuestion);
for (const id of ['project', 'token', 'auth-mode']) el(id).addEventListener('input', () => {
  finishConfirmation(false);
  view = loaded = loadedConnection = connection = questionView = questionConnection = observationConnection = restoredChat = chatConnection = goalRequest = messageRequest = messageConnection = undefined; dropPreview(); el('run').textContent = ''; el('result').textContent = '';
  el('message-text').value = '';
  el('evidence-path').value = '';
  el('measurement').replaceChildren();
  el('question').replaceChildren(); el('question-detail').textContent = ''; el('answers').value = '';
  el('document').replaceChildren(); el('document-json').value = '';
  el('observation-json').value = '';
});
window.addEventListener('pagehide', () => { finishConfirmation(false); dropPreview(); el('token').value = ''; view = loaded = loadedConnection = connection = questionView = questionConnection = observationConnection = restoredChat = chatConnection = goalRequest = messageRequest = messageConnection = undefined; });
