/**
 * Бэкенд конкурса QA Game на Google Apps Script.
 *
 * Хранилище — приватная Google-таблица, к которой имеет доступ только владелец.
 * Веб-приложение публикуется с «Выполнять от имени: я» и «Доступ: все»,
 * поэтому статическая страница на GitHub Pages может писать в таблицу,
 * не имея никаких прав на сам документ.
 *
 * Установка описана в README.md рядом с этим файлом.
 */

var SHEET_REPORTS = 'reports';
var SHEET_PARTICIPANTS = 'participants';

var REPORT_COLUMNS = [
  'id',
  'login',
  'title',
  'steps',
  'expected',
  'actual',
  'severity',
  'area',
  'createdAt',
  'elapsedSec',
  'status',
  'score',
  'reviewComment',
  'updatedAt',
];

var PARTICIPANT_COLUMNS = ['login', 'startedAt', 'lastSeenAt', 'finishedAt'];

function doPost(e) {
  try {
    var request = JSON.parse(e.postData.contents);
    var action = request.action;

    if (action === 'submit') return json({ ok: true, result: handleSubmit(request) });

    // Всё остальное — только для админа.
    requireAdmin(request);

    if (action === 'adminLogin') return json({ ok: true, result: { ok: true } });
    if (action === 'adminSnapshot') return json({ ok: true, result: handleSnapshot() });
    if (action === 'adminVerdict') return json({ ok: true, result: handleVerdict(request) });

    return json({ ok: false, error: 'Неизвестное действие: ' + action });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doGet() {
  return json({ ok: true, result: { service: 'qagame', status: 'ready' } });
}

function json(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function requireAdmin(request) {
  var props = PropertiesService.getScriptProperties();
  var expectedLogin = props.getProperty('ADMIN_LOGIN') || 'admin';
  var expectedPassword = props.getProperty('ADMIN_PASSWORD');
  if (!expectedPassword) throw new Error('На сервере не задан ADMIN_PASSWORD');
  if (String(request.login || '').toLowerCase() !== expectedLogin.toLowerCase()) {
    throw new Error('Неверный логин или пароль');
  }
  if (String(request.password || '') !== expectedPassword) {
    throw new Error('Неверный логин или пароль');
  }
}

function getSheet(name, columns) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(columns);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readAll(sheet, columns) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var header = values[0];
  var index = {};
  header.forEach(function (name, i) {
    index[name] = i;
  });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = {};
    columns.forEach(function (name) {
      var i = index[name];
      row[name] = i === undefined ? '' : values[r][i];
    });
    rows.push(row);
  }
  return rows;
}

function toRow(object, columns) {
  return columns.map(function (name) {
    var value = object[name];
    return value === undefined || value === null ? '' : value;
  });
}

/**
 * Приём прогресса участника. Блокировка нужна, потому что 100 участников
 * пишут в один документ параллельно, а Apps Script выполняет запросы конкурентно.
 */
function handleSubmit(request) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    upsertParticipant(request.participant);
    var accepted = upsertReports(request.reports || []);
    return { accepted: accepted };
  } finally {
    lock.releaseLock();
  }
}

function upsertParticipant(participant) {
  if (!participant || !participant.login) return;
  var sheet = getSheet(SHEET_PARTICIPANTS, PARTICIPANT_COLUMNS);
  var values = sheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === String(participant.login)) {
      // startedAt фиксируем один раз — иначе перезагрузка страницы обнулила бы время участника.
      sheet
        .getRange(r + 1, 1, 1, PARTICIPANT_COLUMNS.length)
        .setValues([
          [
            participant.login,
            values[r][1] || participant.startedAt,
            participant.lastSeenAt || new Date().toISOString(),
            participant.finishedAt || values[r][3] || '',
          ],
        ]);
      return;
    }
  }
  sheet.appendRow(toRow(participant, PARTICIPANT_COLUMNS));
}

function upsertReports(reports) {
  var sheet = getSheet(SHEET_REPORTS, REPORT_COLUMNS);
  var values = sheet.getDataRange().getValues();
  var rowById = {};
  for (var r = 1; r < values.length; r++) {
    rowById[String(values[r][0])] = r + 1;
  }

  var accepted = [];
  var newRows = [];

  reports.forEach(function (report) {
    if (!report || !report.id) return;
    var existingRow = rowById[String(report.id)];
    if (existingRow) {
      var current = values[existingRow - 1];
      // Вердикт админа приоритетнее данных клиента: участник его не перетирает.
      var merged = {
        id: report.id,
        login: report.login,
        title: report.title,
        steps: report.steps,
        expected: report.expected,
        actual: report.actual,
        severity: report.severity,
        area: report.area,
        createdAt: current[8] || report.createdAt,
        elapsedSec: report.elapsedSec,
        status: current[10] || 'pending',
        score: current[11] || 0,
        reviewComment: current[12] || '',
        updatedAt: new Date().toISOString(),
      };
      sheet
        .getRange(existingRow, 1, 1, REPORT_COLUMNS.length)
        .setValues([toRow(merged, REPORT_COLUMNS)]);
    } else {
      newRows.push(toRow(report, REPORT_COLUMNS));
    }
    accepted.push(report.id);
  });

  if (newRows.length > 0) {
    sheet
      .getRange(sheet.getLastRow() + 1, 1, newRows.length, REPORT_COLUMNS.length)
      .setValues(newRows);
  }
  return accepted;
}

function handleSnapshot() {
  return {
    participants: readAll(getSheet(SHEET_PARTICIPANTS, PARTICIPANT_COLUMNS), PARTICIPANT_COLUMNS),
    reports: readAll(getSheet(SHEET_REPORTS, REPORT_COLUMNS), REPORT_COLUMNS).map(function (r) {
      r.elapsedSec = Number(r.elapsedSec) || 0;
      r.score = Number(r.score) || 0;
      r.status = r.status || 'pending';
      return r;
    }),
  };
}

function handleVerdict(request) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet(SHEET_REPORTS, REPORT_COLUMNS);
    var values = sheet.getDataRange().getValues();
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][0]) === String(request.id)) {
        sheet.getRange(r + 1, 11).setValue(request.status);
        sheet.getRange(r + 1, 12).setValue(request.score);
        sheet.getRange(r + 1, 13).setValue(request.reviewComment || '');
        sheet.getRange(r + 1, 14).setValue(new Date().toISOString());
        return { ok: true };
      }
    }
    throw new Error('Дефект не найден: ' + request.id);
  } finally {
    lock.releaseLock();
  }
}
