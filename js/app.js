import { CONFIG } from './config.js';

const app = document.getElementById('app');
const barTitle = document.getElementById('bar-title');
const params = new URLSearchParams(location.search);
const DEMO = !CONFIG.endpoint;
const SOURCE_OPTIONS = ['From records', 'Estimate', 'Don’t know'];
const REPEAT_CHANNELS = ['entry', 'exit'];

const state = {
  link: null,
  survey: null,
  answers: {},
  submitted: null,
  watchers: [],
  sending: false
};

// ---------- small helpers ----------

function h(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === false || value === null || value === undefined) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

function fill(text) {
  return String(text ?? '')
    .replaceAll('{venue}', state.link?.venueName || 'the venue')
    .replaceAll('{privateContact}', CONFIG.privateContact)
    .replaceAll('{deleteBy}', CONFIG.deleteBy)
    .replaceAll('{localRadius}', String(CONFIG.localRadius));
}

function focusTop() {
  window.scrollTo(0, 0);
  const heading = app.querySelector('h1, h2');
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
}

function randomId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function showMessage(title, text) {
  app.replaceChildren(h('h1', { text: title }), h('p', { text }));
  focusTop();
}

async function post(payload) {
  const res = await fetch(CONFIG.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  return res.json();
}

// ---------- start-up ----------

async function resolveLink() {
  const token = params.get('t');
  if (!DEMO) {
    if (!token) return null;
    const res = await fetch(`${CONFIG.endpoint}?action=link&t=${encodeURIComponent(token)}`);
    const link = await res.json();
    return { ...link, token };
  }
  const survey = params.get('s');
  if (!['staff', 'customer', 'owner'].includes(survey)) return null;
  const channel = params.get('c') || (survey === 'customer' ? 'qr' : survey);
  return { ok: true, open: true, survey, channel, venueName: params.get('v') || 'Demo Venue', token: 'demo' };
}

async function start() {
  try {
    const link = await resolveLink();
    if (!link) return showMessage('This link isn’t complete', 'Please use the full link or QR code you were given.');
    if (!link.ok) return showMessage('This link isn’t working', link.message || 'Please ask Good Measure for a new link.');
    if (!link.open) return showMessage('This survey is closed', 'Thank you for your interest. This survey is no longer taking answers.');
    state.link = link;

    const res = await fetch(`surveys/${link.survey}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Could not load survey file');
    state.survey = await res.json();
    barTitle.textContent = state.survey.title;
    document.title = `${state.survey.title} · Good Measure`;

    restoreDraft();
    if (params.get('view') === 'all') return renderAll();
    renderIntro();
  } catch (err) {
    console.error(err);
    showMessage('Something went wrong', 'We couldn’t load the survey. Check your connection and try again.');
  }
}

// ---------- drafts (owner survey only) ----------

function draftKey() {
  return `gm-draft:${state.link.survey}:${state.link.token}`;
}

function saveDraft() {
  if (!state.survey.autosave) return;
  try { localStorage.setItem(draftKey(), JSON.stringify(state.answers)); } catch { /* storage unavailable */ }
}

function restoreDraft() {
  if (!state.survey.autosave) return;
  try {
    const raw = localStorage.getItem(draftKey());
    if (raw) state.answers = JSON.parse(raw) || {};
  } catch { state.answers = {}; }
}

function clearDraft() {
  try { localStorage.removeItem(draftKey()); } catch { /* storage unavailable */ }
}

// ---------- answers and visibility ----------

function setAnswer(key, value) {
  const empty = value === '' || value === null || value === undefined || (Array.isArray(value) && value.length === 0);
  if (empty) delete state.answers[key];
  else state.answers[key] = value;
  saveDraft();
  state.watchers.forEach(fn => fn());
}

function isVisible(q) {
  if (!q.showIf) return true;
  const value = state.answers[q.showIf.id];
  const values = Array.isArray(value) ? value : [value];
  return values.some(v => q.showIf.in.includes(v));
}

function matches(key, list) {
  const value = state.answers[key];
  const values = Array.isArray(value) ? value : [value];
  return values.some(v => list.includes(v));
}

function keysFor(q) {
  const keys = [q.id];
  if (q.other) keys.push(`${q.id}_other`);
  if (q.fields) q.fields.forEach(f => keys.push(`${q.id}_${f.key}`));
  if (q.per) keys.push(`${q.id}_per`);
  if (q.hourly) keys.push(`${q.id}_hourly`);
  if (q.followUp) keys.push(`${q.id}_more`);
  if (q.example) keys.push(`${q.id}_example`);
  if (q.source) keys.push(`${q.id}_source`);
  return keys;
}

function collectAnswers() {
  const out = {};
  for (const section of state.survey.sections) {
    for (const q of section.questions) {
      if (!isVisible(q)) continue;
      for (const key of keysFor(q)) {
        let value = state.answers[key];
        if (value === undefined) continue;
        if (key === `${q.id}_other` && !matches(q.id, [q.other])) continue;
        if (key === `${q.id}_more` && q.followUp.when && !matches(q.id, q.followUp.when)) continue;
        if ((key === `${q.id}_per` || key === `${q.id}_hourly`) && typeof state.answers[q.id] !== 'number') continue;
        if (key === `${q.id}_hourly` && !salaried(q)) continue;
        if (Array.isArray(value)) value = value.join('; ');
        if (typeof value === 'string') value = value.trim();
        if (value === '') continue;
        out[key] = value;
      }
    }
  }
  return out;
}

// ---------- screens ----------

function renderIntro() {
  const s = state.survey;
  const resumed = s.autosave && Object.keys(state.answers).length > 0;
  app.replaceChildren(
    h('h1', { text: fill(s.intro.heading) }),
    ...s.intro.paragraphs.map(p => h('p', { text: fill(p) })),
    resumed ? h('p', { class: 'note', text: 'We’ve kept the answers you saved on this device, so you can carry on where you left off.' }) : null,
    s.autosave ? h('p', { class: 'muted', text: 'Your answers save on this device as you go. You can close this page and come back later using the same link, on the same device.' }) : null,
    DEMO ? h('p', { class: 'note', text: 'Demo mode: answers are not sent anywhere.' }) : null,
    h('div', { class: 'actions' },
      h('span'),
      h('button', { class: 'primary', type: 'button', onclick: () => renderPage(0) }, resumed ? 'Carry on' : 'Start'))
  );
  focusTop();
}

function renderPage(index) {
  const sections = state.survey.sections;
  const section = sections[index];
  const last = index === sections.length - 1;
  state.watchers = [];

  const fillBar = h('span', { class: 'fill' });
  fillBar.style.width = `${Math.round(((index + 1) / sections.length) * 100)}%`;

  const errorBox = h('p', { class: 'error', id: 'page-error', role: 'alert', hidden: true });
  const form = h('form', {
    class: 'page',
    novalidate: true,
    onsubmit: event => {
      event.preventDefault();
      const invalid = form.querySelector('.error.small:not([hidden])');
      if (invalid) {
        errorBox.hidden = false;
        errorBox.textContent = 'Please check the highlighted answer before carrying on.';
        invalid.closest('.q')?.scrollIntoView({ block: 'center' });
        return;
      }
      if (last) submit(errorBox, form);
      else renderPage(index + 1);
    }
  },
    h('p', { class: 'progress', text: `Part ${index + 1} of ${sections.length}` }),
    h('div', { class: 'progressbar', 'aria-hidden': 'true' }, fillBar),
    h('h2', { text: fill(section.title) }),
    section.intro ? h('p', { class: 'muted', text: fill(section.intro) }) : null,
    ...section.questions.map(renderQuestion),
    errorBox,
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'secondary', onclick: () => (index === 0 ? renderIntro() : renderPage(index - 1)) }, 'Back'),
      h('button', { type: 'submit', class: 'primary' }, last ? 'Send my answers' : 'Next'))
  );

  app.replaceChildren(form);
  state.watchers.forEach(fn => fn());
  focusTop();
}

function renderAll() {
  state.watchers = [];
  const s = state.survey;
  app.replaceChildren(
    h('h1', { text: fill(s.intro.heading) }),
    ...s.intro.paragraphs.map(p => h('p', { text: fill(p) })),
    ...s.sections.map(section => h('section', { class: 'all-section' },
      h('h2', { text: fill(section.title) }),
      section.intro ? h('p', { class: 'muted', text: fill(section.intro) }) : null,
      ...section.questions.map(renderQuestion)))
  );
  state.watchers.forEach(fn => fn());
}

async function submit(errorBox, form) {
  if (state.sending) return;
  const answers = collectAnswers();
  const payload = { type: 'response', token: state.link.token, version: state.survey.version, answers };
  state.submitted = answers;

  if (DEMO) {
    clearDraft();
    return renderOutro(payload);
  }

  const button = form.querySelector('button[type="submit"]');
  state.sending = true;
  button.disabled = true;
  button.textContent = 'Sending…';
  try {
    const result = await post(payload);
    if (!result || !result.ok) throw new Error(result?.message || 'Not saved');
    clearDraft();
    renderOutro();
  } catch (err) {
    console.error(err);
    errorBox.hidden = false;
    errorBox.textContent = 'Your answers haven’t been sent yet. Check your connection and press Send again. Nothing you’ve entered is lost.';
    button.disabled = false;
    button.textContent = 'Send my answers';
  } finally {
    state.sending = false;
  }
}

function renderOutro(demoPayload) {
  const s = state.survey;
  app.replaceChildren(
    h('h1', { text: fill(s.outro.heading) }),
    ...s.outro.paragraphs.map(p => h('p', { text: fill(p) }))
  );
  if (s.contactsForm === 'guest' && CONFIG.followUp) app.append(guestFollowUp());
  if (s.contactsForm === 'owner' && state.submitted?.O50 === 'Yes') app.append(ownerContacts());
  if (s.id === 'customer' && REPEAT_CHANNELS.includes(state.link.channel)) {
    app.append(h('div', { class: 'actions' }, h('span'), h('button', {
      type: 'button', class: 'primary',
      onclick: () => { state.answers = {}; state.submitted = null; renderIntro(); }
    }, 'Start again for the next guest')));
  }
  if (demoPayload) {
    app.append(h('details', {}, h('summary', { text: 'Demo mode: what would be sent' }), h('pre', { text: JSON.stringify(demoPayload, null, 2) })));
  }
  focusTop();
}

// ---------- contact forms (stored separately from answers) ----------

function guestFollowUp() {
  const error = h('p', { class: 'error small', role: 'alert', hidden: true });
  const contact = h('input', { type: 'text', id: 'fu-contact', autocomplete: 'email', maxlength: '200' });
  const consent = h('input', { type: 'checkbox', id: 'fu-consent' });
  const button = h('button', { type: 'submit', class: 'primary' }, 'Sign up');
  const panel = h('form', { class: 'panel', novalidate: true },
    h('h3', { text: 'Would you answer a few follow-up questions in about 30 and 90 days?' }),
    h('p', { text: 'It helps us see what lasts beyond one visit. Your contact details go on a separate list and are never linked to the answers you just gave.' }),
    h('div', { class: 'field' }, h('label', { for: 'fu-contact', text: 'Email or phone number' }), contact),
    h('label', { class: 'check', for: 'fu-consent' }, consent, h('span', { text: 'I’m happy for Good Measure to contact me about this. I can ask to be removed at any time.' })),
    error,
    h('div', { class: 'actions' }, h('span'), button)
  );
  panel.addEventListener('input', () => { error.hidden = true; });
  panel.addEventListener('submit', async event => {
    event.preventDefault();
    if (!contact.value.trim()) return showError(error, 'Enter an email or phone number first.');
    if (!consent.checked) return showError(error, 'Tick the box to confirm you’re happy to be contacted.');
    const payload = { type: 'contact', kind: 'guest-followup', token: state.link.token, contacts: [{ contact: contact.value.trim(), participantId: randomId() }] };
    await sendContacts(panel, button, error, payload, 'Thank you. We’ll be in touch in about 30 days.');
  });
  return panel;
}

function ownerContacts() {
  const roles = ['Guest', 'Group organiser', 'Performer or artist', 'Partner organisation'];
  const rows = [];
  const list = h('div');
  for (let i = 0; i < 6; i++) {
    const role = h('select', { id: `oc-role-${i}`, 'aria-label': `Person ${i + 1}: role` }, h('option', { value: '', text: 'Role' }), ...roles.map(r => h('option', { value: r, text: r })));
    const name = h('input', { type: 'text', id: `oc-name-${i}`, placeholder: 'Name', 'aria-label': `Person ${i + 1}: name`, maxlength: '120' });
    const contact = h('input', { type: 'text', id: `oc-contact-${i}`, placeholder: 'Email or phone', 'aria-label': `Person ${i + 1}: email or phone`, maxlength: '200' });
    rows.push({ role, name, contact });
    list.append(h('div', { class: 'contact-row' }, role, name, contact));
  }
  const consent = h('input', { type: 'checkbox', id: 'oc-consent' });
  const error = h('p', { class: 'error small', role: 'alert', hidden: true });
  const button = h('button', { type: 'submit', class: 'primary' }, 'Send contact details');
  const panel = h('form', { class: 'panel', novalidate: true },
    h('h3', { text: 'People we could contact' }),
    h('p', { text: 'Up to two guests, two group organisers and two performers or partners. These details are kept separately from your survey answers and used only to arrange short follow-up conversations.' }),
    list,
    h('label', { class: 'check', for: 'oc-consent' }, consent, h('span', { text: 'Each person listed has agreed to be contacted by Good Measure.' })),
    error,
    h('div', { class: 'actions' }, h('span'), button)
  );
  panel.addEventListener('input', () => { error.hidden = true; });
  panel.addEventListener('submit', async event => {
    event.preventDefault();
    const contacts = rows
      .map(r => ({ role: r.role.value, name: r.name.value.trim(), contact: r.contact.value.trim() }))
      .filter(c => c.name || c.contact);
    if (!contacts.length) return showError(error, 'Add at least one person first.');
    if (contacts.some(c => !c.contact)) return showError(error, 'Add an email or phone number for each person.');
    if (!consent.checked) return showError(error, 'Tick the box to confirm everyone has agreed to be contacted.');
    const payload = { type: 'contact', kind: 'owner-named', token: state.link.token, contacts };
    await sendContacts(panel, button, error, payload, 'Thank you. We’ve received their details.');
  });
  return panel;
}

function showError(node, message) {
  node.hidden = false;
  node.textContent = message;
}

async function sendContacts(panel, button, error, payload, thanks) {
  if (DEMO) {
    panel.replaceChildren(h('p', { text: thanks }), h('pre', { text: JSON.stringify(payload, null, 2) }));
    return;
  }
  button.disabled = true;
  button.textContent = 'Sending…';
  try {
    const result = await post(payload);
    if (!result || !result.ok) throw new Error(result?.message || 'Not saved');
    panel.replaceChildren(h('p', { text: thanks }));
  } catch (err) {
    console.error(err);
    showError(error, 'That didn’t send. Check your connection and try again.');
    button.disabled = false;
    button.textContent = 'Try again';
  }
}

// ---------- questions ----------

function renderQuestion(q) {
  const box = h('fieldset', { class: 'q', 'data-qid': q.id });
  box.append(h('legend', { id: `${q.id}-label` }, fill(q.text)));
  if (q.help) box.append(h('p', { class: 'help', text: fill(q.help) }));
  box.append(control(q));
  if (q.followUp) box.append(followUp(q));
  if (q.example) box.append(textBlock(`${q.id}_example`, 'Give an example (optional)', true));
  if (q.source) box.append(sourceChoice(q));
  if (q.alert) box.append(alertBox(q));
  state.watchers.push(() => { box.hidden = !isVisible(q); });
  return box;
}

function control(q) {
  switch (q.type) {
    case 'single': return radioGroup(q.id, q.options, q.other);
    case 'scale': return radioGroup(q.id, [...state.survey.scales[q.scale], ...(q.extra || [])]);
    case 'multi': return checkGroup(q);
    case 'nps': return npsScale(q.id);
    case 'text': return textInput(q.id, q.long, `${q.id}-label`);
    case 'number':
    case 'money':
    case 'percent': return numberInput(q.id, q.type, q.unit, `${q.id}-label`, q.alts, q.per ? periodChoice(q) : null);
    case 'fields': return fieldGroup(q);
    default: return h('p', { class: 'error', text: `Unknown question type: ${q.type}` });
  }
}

function radioGroup(key, options, other) {
  const wrap = h('div', { class: 'options' });
  options.forEach((option, i) => {
    const id = `${key}-${i}`;
    const input = h('input', { type: 'radio', name: key, id, value: option });
    input.checked = state.answers[key] === option;
    input.addEventListener('change', () => setAnswer(key, option));
    wrap.append(h('label', { class: 'option', for: id }, input, h('span', { text: option })));
  });
  if (other) wrap.append(conditionalText(`${key}_other`, 'Tell us', () => matches(key, [other])));
  return wrap;
}

function checkGroup(q) {
  const key = q.id;
  const wrap = h('div', { class: 'options' });
  const inputs = [];
  const current = () => state.answers[key] || [];
  const sync = () => {
    const values = current();
    inputs.forEach(input => {
      input.checked = values.includes(input.value);
      input.disabled = Boolean(q.max) && values.length >= q.max && !input.checked;
    });
  };
  q.options.forEach((option, i) => {
    const id = `${key}-${i}`;
    const input = h('input', { type: 'checkbox', id, value: option });
    input.addEventListener('change', () => {
      let values = current().filter(v => v !== option);
      if (input.checked) {
        if (q.exclusive && option === q.exclusive) values = [option];
        else values = [...values.filter(v => v !== q.exclusive), option];
      }
      setAnswer(key, q.options.filter(o => values.includes(o)));
      sync();
    });
    inputs.push(input);
    wrap.append(h('label', { class: 'option', for: id }, input, h('span', { text: option })));
  });
  sync();
  if (q.other) wrap.append(conditionalText(`${key}_other`, 'Tell us', () => matches(key, [q.other])));
  return wrap;
}

function npsScale(key) {
  const row = h('div', { class: 'nps-row' });
  for (let n = 0; n <= 10; n++) {
    const id = `${key}-${n}`;
    const input = h('input', { type: 'radio', name: key, id, value: String(n) });
    input.checked = state.answers[key] === n;
    input.addEventListener('change', () => setAnswer(key, n));
    row.append(h('label', { class: 'option', for: id }, input, h('span', { text: String(n) })));
  }
  return h('div', { class: 'nps' }, row, h('div', { class: 'nps-ends', 'aria-hidden': 'true' },
    h('span', { text: '0 = not at all likely' }), h('span', { text: '10 = extremely likely' })));
}

function textInput(key, long, labelledBy) {
  const input = long
    ? h('textarea', { id: `${key}-text`, 'aria-labelledby': labelledBy, maxlength: '2000' })
    : h('input', { type: 'text', id: `${key}-text`, 'aria-labelledby': labelledBy, maxlength: '500' });
  input.value = state.answers[key] ?? '';
  input.addEventListener('input', () => setAnswer(key, input.value));
  return input;
}

function textBlock(key, label, long) {
  const id = `${key}-text`;
  const input = long ? h('textarea', { id, maxlength: '2000' }) : h('input', { type: 'text', id, maxlength: '500' });
  input.value = state.answers[key] ?? '';
  input.addEventListener('input', () => setAnswer(key, input.value));
  return h('div', { class: 'sub' }, h('label', { for: id, text: label }), input);
}

function conditionalText(key, label, when) {
  const block = textBlock(key, label, false);
  state.watchers.push(() => { block.hidden = !when(); });
  return block;
}

function numberInput(key, kind, unit, labelledBy, alts, afterField) {
  const input = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: 'any', id: `${key}-num`, 'aria-labelledby': labelledBy });
  if (kind === 'percent') input.max = '100';
  const error = h('p', { class: 'error small', hidden: true });
  const current = state.answers[key];
  if (typeof current === 'number') input.value = String(current);

  input.addEventListener('input', () => {
    const raw = input.value.trim();
    if (raw === '') {
      error.hidden = true;
      setAnswer(key, '');
      return;
    }
    const n = Number(raw);
    const bad = !Number.isFinite(n) || n < 0 || (kind === 'percent' && n > 100);
    error.hidden = !bad;
    error.textContent = kind === 'percent' ? 'Enter a number from 0 to 100.' : 'Enter a number of 0 or more.';
    if (!bad) setAnswer(key, n);
  });

  const field = h('div', { class: 'num-field' },
    kind === 'money' ? h('span', { class: 'affix', text: '£' }) : null,
    input,
    kind === 'percent' ? h('span', { class: 'affix', text: '%' }) : null,
    unit ? h('span', { class: 'affix', text: unit }) : null);
  const wrap = h('div', { class: 'num' }, field, error, afterField);

  if (alts && alts.length) {
    const altWrap = h('div', { class: 'options alts' });
    const altInputs = alts.map((alt, i) => {
      const id = `${key}-alt-${i}`;
      const radio = h('input', { type: 'radio', name: `${key}-alt`, id, value: alt });
      radio.checked = state.answers[key] === alt;
      radio.addEventListener('change', () => {
        input.value = '';
        error.hidden = true;
        setAnswer(key, alt);
        syncAlt();
      });
      altWrap.append(h('label', { class: 'option', for: id }, radio, h('span', { text: alt })));
      return radio;
    });
    const typeInstead = h('button', { type: 'button', class: 'linkish', text: 'Enter an amount instead' });
    typeInstead.addEventListener('click', () => {
      setAnswer(key, '');
      altInputs.forEach(r => { r.checked = false; });
      syncAlt();
      input.focus();
    });
    const syncAlt = () => {
      const usingAlt = alts.includes(state.answers[key]);
      input.disabled = usingAlt;
      typeInstead.hidden = !usingAlt;
    };
    syncAlt();
    wrap.append(h('p', { class: 'help', text: 'Or choose:' }), altWrap, typeInstead);
  }
  return wrap;
}

function fieldGroup(q) {
  const grid = h('div', { class: 'fields' });
  for (const f of q.fields) {
    const key = `${q.id}_${f.key}`;
    const labelId = `${key}-label`;
    const label = h('label', { id: labelId, for: f.kind === 'text' ? `${key}-text` : `${key}-num`, text: fill(f.label) });
    const input = f.kind === 'text' ? textInput(key, false, labelId) : numberInput(key, f.kind, f.unit, labelId);
    grid.append(h('div', { class: 'field' }, label, input));
  }
  return grid;
}

// Pay period for a money question ("per": [...]); the first option is the hourly one.
function periodChoice(q) {
  const key = `${q.id}_per`;
  const group = h('fieldset', { class: 'inline-radios' }, h('legend', { text: 'That’s' }));
  group.append(radioGroup(key, q.per));
  const box = h('div', {}, group);
  if (q.hourly) {
    const hourlyKey = `${q.id}_hourly`;
    const labelId = `${hourlyKey}-label`;
    const sub = h('div', { class: 'sub' },
      h('label', { id: labelId, for: `${hourlyKey}-num`, text: fill(q.hourly) }),
      numberInput(hourlyKey, 'money', 'per hour', labelId));
    state.watchers.push(() => { sub.hidden = !salaried(q); });
    box.append(sub);
  }
  return box;
}

function salaried(q) {
  const per = state.answers[`${q.id}_per`];
  return Boolean(per) && per !== q.per[0];
}

function followUp(q) {
  const block = textBlock(`${q.id}_more`, fill(q.followUp.text), true);
  if (q.followUp.when) state.watchers.push(() => { block.hidden = !matches(q.id, q.followUp.when); });
  return block;
}

function sourceChoice(q) {
  const key = `${q.id}_source`;
  const group = h('fieldset', { class: 'inline-radios' }, h('legend', { text: 'Where is this figure from?' }));
  group.append(radioGroup(key, SOURCE_OPTIONS));
  return group;
}

function alertBox(q) {
  const box = h('div', { class: 'alert', role: 'status', text: fill(q.alert.text) });
  state.watchers.push(() => { box.hidden = !matches(q.id, q.alert.when); });
  return box;
}

start();
