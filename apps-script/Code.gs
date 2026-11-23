/**
 * Good Measure venue surveys: Google Sheets back end.
 *
 * Paste this into Extensions > Apps Script on the responses spreadsheet, run `setup` once,
 * then deploy as a web app (Execute as: Me, Who has access: Anyone). See README.md.
 */

const SHEETS = {
  settings: 'Settings',
  venues: 'Venues',
  links: 'Links',
  staff: 'Staff responses',
  customer: 'Customer responses',
  owner: 'Owner responses',
  contacts: 'Contacts'
};

const CHANNELS = {
  staff: ['staff'],
  customer: ['qr', 'entry', 'exit'],
  owner: ['owner']
};

const CONTACT_KINDS = { 'guest-followup': 'customer', 'owner-named': 'owner' };
const FIXED_COLUMNS = ['response_id', 'received_at', 'venue_code', 'channel', 'version'];
const CONTACT_COLUMNS = ['contact_id', 'received_at', 'venue_code', 'kind', 'role', 'name', 'contact', 'participant_id'];
const MAX_BODY = 100000;
const MAX_KEYS = 400;
const MAX_VALUE = 5000;
const KEY_PATTERN = /^[A-Za-z0-9]{1,8}(_[A-Za-z0-9]{1,24})?$/;
const TOKEN_PATTERN = /^[a-f0-9]{16,64}$/i;

// ---------- spreadsheet menu and setup ----------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Good Measure')
    .addItem('Set up sheets', 'setup')
    .addItem('Create links for selected venue', 'createLinksForSelectedVenue')
    .addToUi();
}

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet(ss, SHEETS.settings, ['key', 'value', 'notes'], [
    ['base_url', 'https://YOUR-ACCOUNT.github.io/venue-surveys/', 'Where the survey pages are published, ending in /'],
    ['contacts_spreadsheet_id', '', 'Optional: ID of a separate, more restricted spreadsheet for contact details'],
    ['max_per_10_min', '300', 'Most submissions accepted per link in any 10 minutes']
  ]);
  ensureSheet(ss, SHEETS.venues, ['code', 'name', 'open', 'notes'], [
    ['DEMO', 'Demo Venue', true, 'Example row: replace with real venues']
  ]);
  ensureSheet(ss, SHEETS.links, ['token', 'venue_code', 'survey', 'channel', 'active', 'url', 'created_at']);
  ensureSheet(ss, SHEETS.staff, FIXED_COLUMNS);
  ensureSheet(ss, SHEETS.customer, FIXED_COLUMNS);
  ensureSheet(ss, SHEETS.owner, FIXED_COLUMNS);
  if (!setting_('contacts_spreadsheet_id')) ensureSheet(ss, SHEETS.contacts, CONTACT_COLUMNS);
  ss.toast('Sheets are ready. Add venues, then use Good Measure > Create links.', 'Good Measure', 8);
}

function ensureSheet(ss, name, headers, rows) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    if (rows && rows.length) sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
  return sheet;
}

function createLinksForSelectedVenue() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  if (sheet.getName() !== SHEETS.venues) return ui.alert('Select a venue row on the Venues sheet first.');
  const row = sheet.getActiveRange().getRow();
  if (row < 2) return ui.alert('Select a venue row (not the header) on the Venues sheet first.');
  const code = String(sheet.getRange(row, 1).getValue()).trim();
  if (!code) return ui.alert('That row has no venue code.');

  let base = String(setting_('base_url') || '').trim();
  if (!base || base.indexOf('YOUR-ACCOUNT') >= 0) return ui.alert('Set base_url on the Settings sheet first.');
  if (base.slice(-1) !== '/') base += '/';

  const plan = [['staff', 'staff'], ['owner', 'owner'], ['customer', 'qr'], ['customer', 'entry'], ['customer', 'exit']];
  const now = new Date();
  const rows = plan.map(function (p) {
    const token = Utilities.getUuid().replace(/-/g, '');
    return [token, code, p[0], p[1], true, base + '?t=' + token, now];
  });
  const links = ss.getSheetByName(SHEETS.links);
  links.getRange(links.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  ui.alert('Created ' + rows.length + ' links for ' + code + ' on the Links sheet. Treat the owner link like a password.');
}

// ---------- web app ----------

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'link') return json_(lookupLink_(p.t));
  return json_({ ok: true, service: 'Good Measure surveys' });
}

function doPost(e) {
  try {
    const body = e && e.postData && e.postData.contents;
    if (!body || body.length > MAX_BODY) return json_({ ok: false, message: 'Request too large or empty.' });
    const data = JSON.parse(body);

    const link = findLink_(data.token);
    if (!link || !link.active) return json_({ ok: false, message: 'This link isn’t recognised or has been closed.' });
    const venue = findVenue_(link.venue_code);
    if (!venue || !venue.open) return json_({ ok: false, message: 'This survey is closed.' });
    if (!CHANNELS[link.survey] || CHANNELS[link.survey].indexOf(link.channel) < 0) return json_({ ok: false, message: 'This link is set up incorrectly.' });
    if (!withinRateLimit_(link.token)) return json_({ ok: false, message: 'Too many submissions. Please try again later.' });

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      if (data.type === 'response') return json_(saveResponse_(link, data));
      if (data.type === 'contact') return json_(saveContacts_(link, data));
      return json_({ ok: false, message: 'Unknown request.' });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    console.error(err);
    return json_({ ok: false, message: 'Could not save. Please try again.' });
  }
}

function lookupLink_(token) {
  const link = findLink_(token);
  if (!link) return { ok: false, message: 'This link isn’t recognised. Please ask Good Measure for a new one.' };
  const venue = findVenue_(link.venue_code);
  if (!venue) return { ok: false, message: 'This link isn’t set up yet. Please ask Good Measure for help.' };
  return { ok: true, open: link.active && venue.open, survey: link.survey, channel: link.channel, venueName: venue.name };
}

function saveResponse_(link, data) {
  const answers = data.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return { ok: false, message: 'No answers received.' };
  const keys = Object.keys(answers);
  if (keys.length > MAX_KEYS) return { ok: false, message: 'Too many answers.' };
  for (let i = 0; i < keys.length; i++) {
    if (!KEY_PATTERN.test(keys[i])) return { ok: false, message: 'Unexpected answer field.' };
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS[link.survey]);
  const header = ensureColumns_(sheet, FIXED_COLUMNS.concat(keys));
  const id = Utilities.getUuid();
  const record = {
    response_id: id,
    received_at: new Date(),
    venue_code: link.venue_code,
    channel: link.channel,
    version: clean_(String(data.version || '').slice(0, 20))
  };
  keys.forEach(function (k) { record[k] = clean_(answers[k]); });
  sheet.appendRow(header.map(function (col) { return Object.prototype.hasOwnProperty.call(record, col) ? record[col] : ''; }));
  return { ok: true, id: id };
}

function saveContacts_(link, data) {
  const expectedSurvey = CONTACT_KINDS[data.kind];
  if (!expectedSurvey || expectedSurvey !== link.survey) return { ok: false, message: 'Contact details can’t be sent from this link.' };
  const list = Array.isArray(data.contacts) ? data.contacts.slice(0, 10) : [];
  const now = new Date();
  const rows = list
    .map(function (c) {
      c = c || {};
      return [Utilities.getUuid(), now, link.venue_code, data.kind, clean_(c.role || ''), clean_(c.name || ''), clean_(c.contact || ''), clean_(c.participantId || '')];
    })
    .filter(function (r) { return r[6] !== ''; });
  if (!rows.length) return { ok: false, message: 'No contact details received.' };
  const sheet = contactsSheet_();
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  return { ok: true };
}

// ---------- lookups ----------

function findLink_(token) {
  if (!token || !TOKEN_PATTERN.test(String(token))) return null;
  const values = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.links).getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(token)) {
      return {
        token: String(values[i][0]),
        venue_code: String(values[i][1]).trim(),
        survey: String(values[i][2]).trim(),
        channel: String(values[i][3]).trim(),
        active: truthy_(values[i][4])
      };
    }
  }
  return null;
}

function findVenue_(code) {
  const values = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.venues).getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === code) return { code: code, name: String(values[i][1]).trim() || code, open: truthy_(values[i][2]) };
  }
  return null;
}

function setting_(key) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.settings);
  if (!sheet) return '';
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === key) return values[i][1];
  }
  return '';
}

function contactsSheet_() {
  const id = String(setting_('contacts_spreadsheet_id') || '').trim();
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  return ensureSheet(ss, SHEETS.contacts, CONTACT_COLUMNS);
}

// ---------- utilities ----------

function ensureColumns_(sheet, keys) {
  const lastCol = sheet.getLastColumn();
  let header = lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  while (header.length && header[header.length - 1] === '') header.pop();
  const missing = keys.filter(function (k, i) { return header.indexOf(k) < 0 && keys.indexOf(k) === i; });
  if (missing.length) {
    sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    header = header.concat(missing);
  }
  return header;
}

// Stops answers being read as spreadsheet formulas and caps their length.
function clean_(value) {
  if (typeof value === 'number') return isFinite(value) ? value : '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) value = value.join('; ');
  let text = String(value === null || value === undefined ? '' : value).slice(0, MAX_VALUE).trim();
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return text;
}

function truthy_(value) {
  if (value === true) return true;
  const text = String(value).trim().toLowerCase();
  return text === 'true' || text === 'yes' || text === 'open';
}

function withinRateLimit_(token) {
  const cache = CacheService.getScriptCache();
  const key = 'rl_' + token;
  const count = Number(cache.get(key) || 0);
  const max = Number(setting_('max_per_10_min') || 300);
  if (count >= max) return false;
  cache.put(key, String(count + 1), 600);
  return true;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
