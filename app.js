const STORAGE_KEY = 'tide-demo-state-v3';
const views = [...document.querySelectorAll('.view')];
const navItems = [...document.querySelectorAll('.nav-item[data-view]')];
const crumb = document.querySelector('#crumb-current');
const toast = document.querySelector('#toast');
const triageModal = document.querySelector('#triage-modal');
let linkActive = true;
let toastTimer;
let triageUrgent = false;

const viewNames = {
  astronaut: 'MY HEALTH', assistant: 'HEALTH ASSISTANT', medications: 'MEDICATION PLAN',
  consults: 'DOCTOR CONSULTS', medical: 'CREW MEDICAL', ground: 'MISSION HEALTH CENTER',
  protocols: 'PROTOCOL LIBRARY', data: 'DATA & SENSORS',
};

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      packets: Array.isArray(parsed.packets) ? parsed.packets : [],
      doses: Array.isArray(parsed.doses) ? parsed.doses : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      responses: Array.isArray(parsed.responses) ? parsed.responses : [],
      chat: Array.isArray(parsed.chat) ? parsed.chat : [],
      consults: Array.isArray(parsed.consults) ? parsed.consults : [],
    };
  } catch {
    return { packets: [], doses: [], notes: [], responses: [], chat: [], consults: [] };
  }
}

const demoState = loadState();

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(demoState));
  } catch {
    notify('Browser storage is unavailable. This action will not persist after closing the page.');
  }
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function shipTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function showView(name) {
  if (!viewNames[name]) return;
  views.forEach((view) => view.classList.toggle('active-view', view.id === `view-${name}`));
  navItems.forEach((item) => item.classList.toggle('active', item.dataset.view === name));
  if (crumb) crumb.textContent = viewNames[name];
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3400);
}

function addPacket({ type, title, body, priority = 'routine', direction = 'to-ground' }) {
  const packet = {
    id: `DEMO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type, title, body, priority, direction, time: shipTime(), delivered: linkActive,
  };
  demoState.packets.unshift(packet);
  saveState();
  renderQueues();
  if (direction === 'to-ground') {
    notify(linkActive
      ? 'Demo handoff added to the local mission health center queue. No clinician was notified.'
      : 'Saved in this browser demo queue. No clinician was notified; the link is simulated.');
  } else {
    notify(linkActive
      ? 'Demo response added to the astronaut view. No real ground clinician is connected.'
      : 'Response saved in the local demo queue pending simulated link restoration.');
  }
  return packet;
}

function renderQueues() {
  const toGround = demoState.packets.filter((packet) => packet.direction === 'to-ground');
  const delivered = toGround.filter((packet) => packet.delivered);
  const pending = toGround.filter((packet) => !packet.delivered);
  const groundCount = document.querySelector('#ground-message-count');
  const followupCount = document.querySelector('#open-followup-count');
  const alertCount = document.querySelector('#ground-alert-count');
  const alertTitle = document.querySelector('#ground-alert-title');
  const alertDetail = document.querySelector('#ground-alert-detail');
  const packetList = document.querySelector('#ground-packet-list');
  const dynamicCases = document.querySelector('#dynamic-case-list');

  if (groundCount) groundCount.textContent = String(pending.length).padStart(2, '0');
  if (followupCount) followupCount.textContent = String(2 + toGround.filter((packet) => packet.priority === 'urgent').length).padStart(2, '0');
  if (alertCount) alertCount.textContent = pending.length ? `${pending.length} QUEUED` : `${delivered.length} RECEIVED`;
  if (alertTitle) {
    alertTitle.textContent = pending.length
      ? `${pending.length} demo packet${pending.length === 1 ? '' : 's'} waiting for simulated link restoration`
      : delivered.length
        ? `${delivered.length} synthetic care packet${delivered.length === 1 ? '' : 's'} in the local ground view`
        : 'Demo link is active · synthetic case T-042 is available';
  }
  if (alertDetail) {
    alertDetail.textContent = 'Local browser simulation only. No flight surgeon, station, or external alert service is connected.';
  }
  if (packetList) {
    packetList.innerHTML = delivered.length
      ? delivered.map((packet) => `<div class="ground-packet ${packet.priority === 'urgent' ? 'packet-urgent' : ''}"><div><b>${escapeHTML(packet.title)}</b><small>${escapeHTML(packet.type)} · ${escapeHTML(packet.time)} ship time · ${escapeHTML(packet.id)}</small></div><p>${escapeHTML(packet.body)}</p></div>`).join('')
      : '<p class="empty-state">No new packets have reached the simulated ground queue.</p>';
  }
  if (dynamicCases) {
    dynamicCases.innerHTML = toGround.map((packet) => `<div class="alert-queue-item"><strong>${packet.priority === 'urgent' ? 'URGENT DEMO FLAG' : 'DEMO FOLLOW-UP'} · ${escapeHTML(packet.title)}</strong><p>${escapeHTML(packet.body)}</p><small>${packet.delivered ? 'Visible in local ground view' : 'Waiting in local demo queue'} · ${escapeHTML(packet.time)}</small></div>`).join('');
  }
  renderResponses();
}

function renderResponses() {
  const list = document.querySelector('#clinician-response-list');
  if (!list) return;
  const responses = demoState.packets.filter((packet) => packet.direction === 'to-crew' && packet.delivered);
  list.innerHTML = responses.length
    ? responses.map((response) => `<div class="returned-response"><b>${escapeHTML(response.title)}</b><small>Local demo reply · ${escapeHTML(response.time)} ship time</small><p>${escapeHTML(response.body)}</p></div>`).join('')
    : '<p class="empty-state">No demo responses received yet. A response entered in the Ground Health Center appears here.</p>';
}

function openTriage() {
  triageUrgent = false;
  document.querySelector('#triage-step-1').hidden = false;
  document.querySelector('#triage-step-2').hidden = true;
  triageModal.showModal();
}

function appendChat(role, content, { urgent = false, time = shipTime(), persist = true } = {}) {
  const thread = document.querySelector('#assistant-thread');
  const message = document.createElement('div');
  message.className = `chat-message ${role === 'user' ? 'user-message' : 'bot-message'}${urgent ? ' assistant-alert-message' : ''}`;
  const avatar = role === 'user' ? 'MK' : 'T';
  message.innerHTML = `<span class="chat-avatar">${avatar}</span><div><p>${escapeHTML(content).replace(/\n/g, '<br>')}</p><small>${role === 'user' ? 'You' : 'TIDE local demo'} · ${escapeHTML(time)} ship time</small></div>`;
  thread.append(message);
  thread.scrollTop = thread.scrollHeight;
  if (persist) {
    demoState.chat.push({ role, content, urgent, time });
    if (demoState.chat.length > 40) demoState.chat.splice(0, demoState.chat.length - 40);
    saveState();
  }
}

function renderChatHistory() {
  const thread = document.querySelector('#assistant-thread');
  if (!thread || !demoState.chat.length) return;
  thread.replaceChildren();
  demoState.chat.forEach((message) => appendChat(message.role, message.content, { ...message, persist: false }));
}

function assistantReply(text) {
  const message = text.toLowerCase();
  const urgentPattern = /can't breathe|cannot breathe|difficulty breathing|chest pain|unconscious|passed out|fainted|severe bleeding|medical emergency|rapidly worsening/;
  if (urgentPattern.test(message)) {
    addPacket({
      type: 'Potential urgent phrase · demo only',
      title: 'Possible urgent concern reported',
      body: 'A demo phrase match created this local queue item. It is not a validated emergency detector. Crew should use the mission-approved emergency procedure and contact the onboard medical officer.',
      priority: 'urgent',
    });
    return {
      urgent: true,
      text: 'This demo recognized wording that may describe an urgent problem. Contact your crew medical officer now and follow the mission-approved emergency procedure. Do not wait for an Earth response. A simulated priority item has been added to this browser’s onboard and ground views; no real person was paged.',
    };
  }
  if (/medication|medicine|dose|pill|prescription/.test(message)) {
    return {
      text: 'I can show the fictional medication schedule and record a dose or note. I cannot decide which medicine you need, check a real drug interaction, or change a dose. Use your signed mission plan and ask the crew medical officer about any change or concern.',
    };
  }
  if (/doctor|flight surgeon|consult|earth|video/.test(message)) {
    return {
      text: 'I can prepare a consultation packet. In a Mars-like profile, the prototype uses store-and-forward because a live back-and-forth would be delayed. The onboard medical officer remains the first human contact; the demo cannot place a real call.',
    };
  }
  if (/sleep|tired|fatigue|stress|mood|hydration|heart|pulse|headache|pain|nausea|dizz|rash|symptom|ill|sick/.test(message)) {
    return {
      text: 'I can help record when this started, how it is changing, and what observations might be useful for your crew medical officer. I cannot determine the cause from this chat. If it is severe, worsening, or affecting your ability to function, contact the onboard medical officer now. Would you like to prepare a care packet?',
    };
  }
  return {
    text: 'I can organize a symptom report, show the synthetic health snapshot, record a medication-plan event, or prepare a clinician consultation. I can’t diagnose an illness or prescribe. Please tell me what changed and when, or choose one of those actions.',
  };
}

function sendChat(text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  appendChat('user', trimmed);
  const response = assistantReply(trimmed);
  appendChat('bot', response.text, { urgent: Boolean(response.urgent) });
}

function logDose(slot) {
  if (demoState.doses.some((dose) => dose.slot === slot && dose.day === 142)) {
    notify('This demo reminder already has a dose entry for today.');
    return;
  }
  demoState.doses.unshift({ slot, day: 142, time: shipTime(), status: 'taken' });
  saveState();
  renderMedicationLog();
  const status = document.querySelector(slot === 'morning' ? '#morning-dose-status' : '#evening-dose-status');
  const button = document.querySelector(slot === 'morning' ? '#dose-am' : '#dose-pm');
  if (status) status.textContent = `Recorded as taken · ${shipTime()} ship time`;
  if (button) { button.textContent = '✓ Recorded'; button.classList.add('is-done'); }
  notify('Dose recorded in local demo history. This does not verify that medication was taken.');
}

function renderMedicationLog() {
  const log = document.querySelector('#medication-log');
  if (!log) return;
  if (!demoState.doses.length && !demoState.notes.length) {
    log.innerHTML = '<span class="eyebrow">RECENT LOG</span><p>No medication events recorded in this browser yet.</p>';
    return;
  }
  const items = [
    ...demoState.doses.map((dose) => ({ time: dose.time, text: `${dose.slot} reminder · ${dose.status}` })),
    ...demoState.notes.map((note) => ({ time: note.time, text: `Private observation · ${note.text}` })),
  ].slice(0, 5);
  log.innerHTML = `<span class="eyebrow">RECENT LOG · LOCAL DEMO</span>${items.map((item) => `<div class="med-log-item">${escapeHTML(item.time)} · ${escapeHTML(item.text)}</div>`).join('')}`;
}

function updateConsultMode() {
  const mode = document.querySelector('#consult-mode');
  if (!mode) return;
  const explainer = document.querySelector('#mode-explainer');
  const label = document.querySelector('#consult-link-state');
  const button = document.querySelector('#submit-consult');
  if (mode.value === 'mars') {
    explainer.textContent = 'Default: asynchronous consult. Video/audio can be attached as a recorded message; Earth’s reply arrives later when communication allows.';
    label.textContent = linkActive ? 'MARS-LIKE PROFILE · ASYNC MODE' : 'MARS-LIKE PROFILE · LINK DELAYED';
    button.textContent = 'Queue async consult ↗';
  } else if (mode.value === 'lunar') {
    explainer.textContent = 'Several-second one-way latency is expected in this demo profile. A clinician consult may be scheduled, but this prototype cannot establish a live call.';
    label.textContent = linkActive ? 'LUNAR PROFILE · CONSULT REQUEST' : 'LUNAR PROFILE · LINK DELAYED';
    button.textContent = 'Prepare clinician consult ↗';
  } else {
    explainer.textContent = 'Near-Earth links may support near-real-time consultation. This prototype only creates a request; it has no video-call service or connected doctor.';
    label.textContent = linkActive ? 'NEAR-EARTH PROFILE · LIVE MAY BE POSSIBLE' : 'NEAR-EARTH PROFILE · LINK DELAYED';
    button.textContent = 'Request consult (demo) ↗';
  }
}

function syncDemoQueue() {
  const unsent = demoState.packets.filter((packet) => !packet.delivered);
  unsent.forEach((packet) => { packet.delivered = true; });
  saveState();
  renderQueues();
}

navItems.forEach((item) => item.addEventListener('click', () => showView(item.dataset.view)));
document.querySelectorAll('[data-view]:not(.nav-item)').forEach((item) => {
  item.addEventListener('click', () => showView(item.dataset.view));
});

document.querySelector('#sync-toggle').addEventListener('click', () => {
  linkActive = !linkActive;
  const button = document.querySelector('#sync-toggle');
  button.classList.toggle('offline', !linkActive);
  button.setAttribute('aria-pressed', String(linkActive));
  document.querySelector('#sync-label').textContent = linkActive ? 'DEMO LINK ACTIVE' : 'LINK DELAYED';
  if (linkActive) {
    syncDemoQueue();
    notify('Simulated link restored. Local demo packets moved to the local ground view; no external server was contacted.');
  } else {
    notify('Simulated link delayed. Onboard demo views remain available.');
  }
  updateConsultMode();
});

document.querySelector('#open-checkin').addEventListener('click', openTriage);
document.querySelector('#open-checkin-2').addEventListener('click', openTriage);
document.querySelector('#open-triage').addEventListener('click', openTriage);
document.querySelector('#scroll-pattern').addEventListener('click', () => {
  document.querySelector('#pattern-section').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

document.querySelector('#assistant-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = document.querySelector('#assistant-input');
  sendChat(input.value);
  input.value = '';
  input.focus();
});

document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.addEventListener('click', () => {
    const prompt = button.dataset.prompt;
    if (prompt.includes('Medication')) { showView('medications'); return; }
    if (prompt.includes('doctor')) { showView('consults'); return; }
    document.querySelector('#assistant-input').value = prompt;
    document.querySelector('#assistant-input').focus();
  });
});

document.querySelector('#continue-triage').addEventListener('click', () => {
  const severity = document.querySelector('#worse').value;
  const title = document.querySelector('#triage-result-title');
  const result = document.querySelector('#triage-result-text');
  triageUrgent = severity !== 'no';
  if (triageUrgent) {
    title.textContent = 'Contact your crew medical officer now.';
    result.textContent = 'You selected severe, worsening, function-limiting, or uncertain symptoms. This generic demo directs you to a human; it is not a validated emergency protocol. Follow the approved onboard procedure and do not wait for Earth.';
    document.querySelector('#share-triage').textContent = 'Queue demo priority handoff';
  } else {
    title.textContent = 'Let’s make a clear follow-up plan.';
    result.textContent = 'This prototype cannot determine the cause. Record the symptom and follow your mission’s approved protocol. Contact the crew medical officer if you are concerned or things worsen.';
    document.querySelector('#share-triage').textContent = 'Prepare demo care handoff';
  }
  document.querySelector('#triage-step-1').hidden = true;
  document.querySelector('#triage-step-2').hidden = false;
});

document.querySelector('#back-triage').addEventListener('click', () => {
  document.querySelector('#triage-step-1').hidden = false;
  document.querySelector('#triage-step-2').hidden = true;
});

document.querySelector('#share-triage').addEventListener('click', () => {
  const symptom = document.querySelector('#symptom').selectedOptions[0].textContent;
  triageModal.close();
  addPacket({
    type: triageUrgent ? 'Potential urgent concern · demo only' : 'Symptom check-in · demo only',
    title: triageUrgent ? 'Possible urgent concern reported' : 'Astronaut requested care follow-up',
    body: `${symptom}. The crew member selected ${triageUrgent ? 'severe, worsening, or uncertain' : 'not severe or rapidly worsening'}. This is synthetic and not a medical assessment.`,
    priority: triageUrgent ? 'urgent' : 'routine',
  });
});

document.querySelectorAll('.action-check').forEach((button) => {
  button.addEventListener('click', () => {
    const done = button.classList.toggle('done');
    button.textContent = done ? '✓' : '＋';
    notify(done ? 'Added to your personal demo follow-up plan.' : 'Removed from your demo follow-up plan.');
  });
});

document.querySelector('#ack-case').addEventListener('click', (event) => {
  event.currentTarget.textContent = '✓ Follow-up acknowledged';
  event.currentTarget.classList.add('button-outline');
  event.currentTarget.classList.remove('button-primary');
  notify('Synthetic follow-up acknowledged in the local onboard view.');
});

document.querySelector('#send-ground').addEventListener('click', () => addPacket({
  type: 'Ground consultation request · demo only',
  title: 'Recovery pattern review requested',
  body: 'Synthetic case T-042 asks the flight surgeon to review a three-day pattern. No real health data is included.',
}));

document.querySelector('#assistant-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    document.querySelector('#assistant-form').requestSubmit();
  }
});

document.querySelector('#dose-am').addEventListener('click', () => logDose('morning'));
document.querySelector('#dose-pm').addEventListener('click', () => logDose('evening'));
document.querySelector('#review-medication').addEventListener('click', () => addPacket({
  type: 'Medication-plan review · demo only',
  title: 'Medication plan review requested',
  body: 'Astronaut requested clinician review of a fictional medication plan. No prescription or dosage change was made.',
}));

document.querySelector('#side-effect-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const field = document.querySelector('#side-effect-note');
  const text = field.value.trim();
  if (!text) { notify('Write an optional note before saving.'); return; }
  demoState.notes.unshift({ text, time: shipTime() });
  saveState();
  renderMedicationLog();
  field.value = '';
  notify('Observation saved in this browser only. It has not been shared with a clinician.');
});

document.querySelector('#consult-mode').addEventListener('change', updateConsultMode);
document.querySelector('#consult-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const question = document.querySelector('#consult-question').value.trim();
  if (!question) { document.querySelector('#consult-question').focus(); notify('Add the question you want the clinician to review.'); return; }
  const mode = document.querySelector('#consult-mode').value;
  const file = document.querySelector('#consult-attachment').files[0];
  const consent = document.querySelector('#share-notes').checked;
  const summary = `${question}${document.querySelector('#share-vitals').checked ? ' [Synthetic trend summary included]' : ''}${consent ? ' [Astronaut opted to include private notes]' : ''}${file ? ` [Attachment selected: ${file.name}; this demo stores the name only]` : ''}`;
  demoState.consults.unshift({ summary, time: shipTime(), mode });
  saveState();
  addPacket({
    type: mode === 'mars' ? 'Asynchronous consult · demo only' : `${mode === 'leo' ? 'Near-Earth' : 'Lunar'} consult request · demo only`,
    title: 'Clinician consultation requested',
    body: summary,
  });
  document.querySelector('#consult-question').value = '';
  document.querySelector('#consult-attachment').value = '';
});

document.querySelector('#send-response').addEventListener('click', () => {
  const response = document.querySelector('#clinician-response');
  if (!response.value.trim()) {
    response.focus();
    notify('Write a demo reply before adding it to the astronaut view.');
    return;
  }
  addPacket({
    type: 'Clinician reply · demo only',
    title: 'Ground health center sent a demo response',
    body: response.value.trim(),
    direction: 'to-crew',
  });
  response.value = '';
});

triageModal.addEventListener('click', (event) => {
  if (event.target === triageModal) triageModal.close();
});
triageModal.addEventListener('close', () => { triageUrgent = false; });

document.querySelector('#sync-label').textContent = 'DEMO LINK ACTIVE';
document.querySelector('#sync-toggle').setAttribute('aria-pressed', 'true');
renderQueues();
renderChatHistory();
renderMedicationLog();
updateConsultMode();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./service-worker.js').catch(() => {
    notify('Offline caching is unavailable in this browser context.');
  });
}
