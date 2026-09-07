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
var SHEET_STATE = 'state';
var SHEET_RESULTS = 'results';

var REPORT_COLUMNS = [
  'id',
  'round',
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
  // Код эталонного дефекта, проставленный при разборе. Добавлен позже остальных,
  // поэтому стоит в конце: порядок прежних колонок менять нельзя.
  'bugCode',
];

var PARTICIPANT_COLUMNS = ['login', 'round', 'startedAt', 'lastSeenAt', 'finishedAt', 'peeked'];

var STATE_COLUMNS = ['number', 'status', 'title', 'startedAt', 'endsAt', 'finishedAt'];

/**
 * Опубликованные итоги игры. Хранятся кусками: в ячейку Sheets влезает 50 000
 * символов, а таблица со ста участниками и номинациями может оказаться длиннее.
 */
var RESULTS_COLUMNS = ['round', 'publishedAt', 'part', 'payload'];
var RESULTS_CHUNK = 40000;

/** Запас на расхождение часов клиента и сервера, мс. */
var CLOCK_GRACE_MS = 60000;

function doPost(e) {
  try {
    var request = JSON.parse(e.postData.contents);
    var action = request.action;

    if (action === 'submit') return json({ ok: true, result: handleSubmit(request) });
    if (action === 'round') return json({ ok: true, result: readState() });
    if (action === 'results') return json({ ok: true, result: readResults(request.round) });

    // Всё остальное — только для админа.
    requireAdmin(request);

    if (action === 'adminLogin') return json({ ok: true, result: { ok: true } });
    if (action === 'adminSnapshot') return json({ ok: true, result: handleSnapshot() });
    if (action === 'adminVerdict') return json({ ok: true, result: handleVerdict(request) });
    if (action === 'adminStartRound') return json({ ok: true, result: startRound(request) });
    if (action === 'adminFinishRound') return json({ ok: true, result: finishRound() });
    if (action === 'adminReset') return json({ ok: true, result: resetCompetition() });
    if (action === 'adminPublishResults') return json({ ok: true, result: writeResults(request) });
    if (action === 'adminReference') return json({ ok: true, result: referenceList() });

    return json({ ok: false, error: 'Неизвестное действие: ' + action });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/**
 * Эталонный список дефектов. Лежит в Reference.gs этого же проекта и отдаётся
 * только организатору: в бандл участника он не попадает, иначе ответы можно было
 * бы прочитать прямо из исходников страницы.
 */
function referenceList() {
  if (typeof KNOWN_BUGS === 'undefined') {
    throw new Error(
      'В проекте нет файла Reference.gs с эталонным списком. Соберите его командой ' +
        '«npm run build:reference» и добавьте в Apps Script как отдельный файл.',
    );
  }
  return KNOWN_BUGS;
}

function doGet() {
  return json({ ok: true, result: { service: 'qagame', status: 'ready' } });
}

function json(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

/**
 * Сверка организатора со свойствами скрипта.
 *
 * Пробелы по краям срезаются с обеих сторон: при копировании значения в свойства
 * скрипта легко прихватить лишний символ, а отличить такую опечатку по одинаковому
 * сообщению об ошибке невозможно. Сообщения намеренно разные — это внутренний
 * инструмент, и организатору важнее понять, что именно не совпало.
 */
function requireAdmin(request) {
  var props = PropertiesService.getScriptProperties();
  var expectedLogin = trim(props.getProperty('ADMIN_LOGIN') || 'admin');
  var expectedPassword = trim(props.getProperty('ADMIN_PASSWORD'));
  if (!expectedPassword) throw new Error('На сервере не задан ADMIN_PASSWORD');
  if (trim(request.login).toLowerCase() !== expectedLogin.toLowerCase()) {
    throw new Error('Неверный логин организатора: на сервере задан другой ADMIN_LOGIN');
  }
  if (trim(request.password) !== expectedPassword) {
    throw new Error('Неверный пароль организатора');
  }
}

function trim(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function getSheet(name, columns) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(columns);
    sheet.setFrozenRows(1);
    return sheet;
  }
  ensureColumns(sheet, columns);
  return sheet;
}

/**
 * Дописывает недостающие заголовки в конец существующего листа.
 *
 * Без этого таблица, созданная прежней версией скрипта, теряла бы новые поля:
 * организатору пришлось бы удалять листы и терять данные прошлых запусков.
 */
function ensureColumns(sheet, columns) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(columns);
    sheet.setFrozenRows(1);
    return;
  }
  var header = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  var missing = columns.filter(function (name) {
    return header.indexOf(name) === -1;
  });
  if (missing.length === 0) return;
  sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing]);
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

function readState() {
  var sheet = getSheet(SHEET_STATE, STATE_COLUMNS);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return { number: 0, status: 'idle', title: '', startedAt: '', endsAt: '', finishedAt: '' };
  }
  var row = values[1];
  return {
    number: Number(row[0]) || 0,
    status: String(row[1] || 'idle'),
    title: String(row[2] || ''),
    startedAt: asIso(row[3]),
    endsAt: asIso(row[4]),
    finishedAt: asIso(row[5]),
  };
}

/** Даты Sheets умеет возвращать объектом Date — приводим всё к ISO-строке. */
function asIso(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function writeState(state) {
  var sheet = getSheet(SHEET_STATE, STATE_COLUMNS);
  var row = [
    state.number,
    state.status,
    state.title,
    state.startedAt,
    state.endsAt,
    state.finishedAt,
  ];
  if (sheet.getLastRow() < 2) sheet.appendRow(row);
  else sheet.getRange(2, 1, 1, STATE_COLUMNS.length).setValues([row]);
  return state;
}

function startRound(request) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var previous = readState();
    var now = new Date();
    var minutes = Number(request.durationMinutes) || 0;
    return writeState({
      number: previous.number + 1,
      status: 'running',
      title: String(request.title || ''),
      startedAt: now.toISOString(),
      endsAt: minutes > 0 ? new Date(now.getTime() + minutes * 60000).toISOString() : '',
      finishedAt: '',
    });
  } finally {
    lock.releaseLock();
  }
}

function finishRound() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var state = readState();
    state.status = 'finished';
    state.finishedAt = new Date().toISOString();
    return writeState(state);
  } finally {
    lock.releaseLock();
  }
}

/** Новый конкурс: данные прошлого стираются, счётчик запусков обнуляется. */
function resetCompetition() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    [
      [SHEET_REPORTS, REPORT_COLUMNS],
      [SHEET_PARTICIPANTS, PARTICIPANT_COLUMNS],
      [SHEET_RESULTS, RESULTS_COLUMNS],
    ].forEach(function (pair) {
      var sheet = getSheet(pair[0], pair[1]);
      if (sheet.getLastRow() > 1) {
        sheet.deleteRows(2, sheet.getLastRow() - 1);
      }
    });
    return writeState({
      number: 0,
      status: 'idle',
      title: '',
      startedAt: '',
      endsAt: '',
      finishedAt: '',
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Сохранение итогов игры. Публикация повторяется столько раз, сколько нужно
 * организатору, — старые куски того же запуска стираются перед записью новых.
 */
function writeResults(request) {
  var round = Number(request.round) || 0;
  if (!round) throw new Error('Не указан запуск игры для публикации итогов');
  var payload = String(request.payload || '');
  if (!payload) throw new Error('Пустые итоги игры');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet(SHEET_RESULTS, RESULTS_COLUMNS);
    dropResultRows(sheet, round);

    var publishedAt = new Date().toISOString();
    var rows = [];
    for (var offset = 0, part = 0; offset < payload.length; offset += RESULTS_CHUNK, part++) {
      rows.push([round, publishedAt, part, payload.substr(offset, RESULTS_CHUNK)]);
    }
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, RESULTS_COLUMNS.length).setValues(rows);
    return { ok: true, publishedAt: publishedAt, parts: rows.length };
  } finally {
    lock.releaseLock();
  }
}

function dropResultRows(sheet, round) {
  var values = sheet.getDataRange().getValues();
  // Снизу вверх: удаление строки сдвигает те, что ниже.
  for (var r = values.length - 1; r >= 1; r--) {
    if (Number(values[r][0]) === round) sheet.deleteRow(r + 1);
  }
}

/**
 * Итоги игры для участника. Запуск 0 или не указан — отдаём последние
 * опубликованные: участник спрашивает итоги, ещё не зная номера запуска.
 */
function readResults(requestedRound) {
  var sheet = getSheet(SHEET_RESULTS, RESULTS_COLUMNS);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return null;

  var round = Number(requestedRound) || 0;
  if (!round) {
    for (var i = 1; i < values.length; i++) {
      round = Math.max(round, Number(values[i][0]) || 0);
    }
  }

  var parts = [];
  for (var r = 1; r < values.length; r++) {
    if (Number(values[r][0]) !== round) continue;
    parts.push({ part: Number(values[r][2]) || 0, text: String(values[r][3] || '') });
  }
  if (parts.length === 0) return null;
  parts.sort(function (a, b) {
    return a.part - b.part;
  });

  var json = parts
    .map(function (p) {
      return p.text;
    })
    .join('');
  try {
    return JSON.parse(json);
  } catch (err) {
    // Битые итоги лучше показать как «ещё не опубликованы», чем уронить страницу участника.
    return null;
  }
}

/**
 * Можно ли принять этот репорт. Клиент блокирует ввод сам, но полагаться на это
 * нельзя: страница открыта у участника, и правила должен проверять сервер.
 */
function reportAllowed(report, state) {
  if (state.number === 0 || state.status === 'idle') return false;
  if (Number(report.round) !== state.number) return false;
  var createdMs = Date.parse(report.createdAt);
  if (isNaN(createdMs)) return false;
  if (state.endsAt && createdMs > Date.parse(state.endsAt) + CLOCK_GRACE_MS) return false;
  if (state.status === 'finished' && state.finishedAt) {
    if (createdMs > Date.parse(state.finishedAt) + CLOCK_GRACE_MS) return false;
  }
  return true;
}

/**
 * Приём прогресса участника. Блокировка нужна, потому что 100 участников
 * пишут в один документ параллельно, а Apps Script выполняет запросы конкурентно.
 */
function handleSubmit(request) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var state = readState();
    upsertParticipant(request.participant);

    var incoming = request.reports || [];
    var allowed = [];
    var rejected = [];
    incoming.forEach(function (report) {
      if (reportAllowed(report, state)) allowed.push(report);
      else rejected.push(report.id);
    });

    var accepted = upsertReports(allowed);
    removeReports(request.deletedIds || []);

    return {
      accepted: accepted,
      rejected: rejected,
      round: state,
      // Возвращаем вердикты, иначе у участника всё навсегда остаётся «на проверке».
      verdicts: verdictsFor(request.participant && request.participant.login),
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Все строки участника целиком — их клиент показывает в «Моих дефектах».
 *
 * Отдаём не только вердикт, но и текст находки: у участника, открывшего итоги в
 * другом браузере или после очистки данных, локального списка нет вовсе, а свой
 * разбор он должен увидеть в любом случае.
 */
function verdictsFor(login) {
  if (!login) return [];
  var sheet = getSheet(SHEET_REPORTS, REPORT_COLUMNS);
  var values = sheet.getDataRange().getValues();
  var out = [];
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][2]) !== String(login)) continue;
    var row = {};
    REPORT_COLUMNS.forEach(function (name, i) {
      row[name] = values[r][i];
    });
    row.id = String(row.id);
    row.round = Number(row.round) || 0;
    row.elapsedSec = Number(row.elapsedSec) || 0;
    row.status = String(row.status || 'pending');
    row.score = Number(row.score) || 0;
    row.reviewComment = String(row.reviewComment || '');
    row.createdAt = asIso(row.createdAt);
    row.updatedAt = asIso(row.updatedAt);
    out.push(row);
  }
  return out;
}

/**
 * Удаление репортов, которые участник убрал у себя. Разобранные не трогаем:
 * вердикт организатора важнее желания участника подчистить список.
 */
function removeReports(ids) {
  if (!ids || ids.length === 0) return;
  var sheet = getSheet(SHEET_REPORTS, REPORT_COLUMNS);
  var values = sheet.getDataRange().getValues();
  var wanted = {};
  ids.forEach(function (id) {
    wanted[String(id)] = true;
  });
  // Идём снизу вверх: удаление строки сдвигает те, что ниже.
  for (var r = values.length - 1; r >= 1; r--) {
    var status = String(values[r][11] || 'pending');
    if (wanted[String(values[r][0])] && status === 'pending') sheet.deleteRow(r + 1);
  }
}

function upsertParticipant(participant) {
  if (!participant || !participant.login) return;
  var sheet = getSheet(SHEET_PARTICIPANTS, PARTICIPANT_COLUMNS);
  var values = sheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === String(participant.login)) {
      // startedAt фиксируем один раз — иначе перезагрузка страницы обнулила бы время участника.
      var sameRound = Number(values[r][1]) === Number(participant.round);
      sheet
        .getRange(r + 1, 1, 1, PARTICIPANT_COLUMNS.length)
        .setValues([
          [
            participant.login,
            participant.round,
            // Новый запуск обнуляет отсчёт, в текущем — фиксируем первое значение.
            sameRound ? values[r][2] || participant.startedAt : participant.startedAt,
            participant.lastSeenAt || new Date().toISOString(),
            sameRound ? participant.finishedAt || values[r][4] || '' : participant.finishedAt || '',
            // Отметку о подглядывании не снимаем: снявший её клиент не должен её стирать.
            values[r][5] === true || values[r][5] === 'TRUE' || participant.peeked === true,
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
      // Разобранный репорт участник править уже не может: организатор вынес вердикт
      // по конкретному тексту, и подменять его задним числом нельзя.
      if (String(current[11] || 'pending') !== 'pending') {
        accepted.push(report.id);
        return;
      }
      // Вердикт админа приоритетнее данных клиента: участник его не перетирает.
      var merged = {
        id: report.id,
        round: report.round,
        login: report.login,
        title: report.title,
        steps: report.steps,
        expected: report.expected,
        actual: report.actual,
        severity: report.severity,
        area: report.area,
        createdAt: current[9] || report.createdAt,
        elapsedSec: report.elapsedSec,
        status: current[11] || 'pending',
        score: current[12] || 0,
        reviewComment: current[13] || '',
        updatedAt: new Date().toISOString(),
        // Код дефекта ставит организатор — данные участника его не перетирают.
        bugCode: current[15] || '',
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
    round: readState(),
    participants: readAll(getSheet(SHEET_PARTICIPANTS, PARTICIPANT_COLUMNS), PARTICIPANT_COLUMNS).map(
      function (p) {
        p.round = Number(p.round) || 0;
        p.startedAt = asIso(p.startedAt);
        p.lastSeenAt = asIso(p.lastSeenAt);
        p.finishedAt = asIso(p.finishedAt);
        p.peeked = p.peeked === true || p.peeked === 'TRUE';
        return p;
      },
    ),
    reports: readAll(getSheet(SHEET_REPORTS, REPORT_COLUMNS), REPORT_COLUMNS).map(function (r) {
      r.round = Number(r.round) || 0;
      r.elapsedSec = Number(r.elapsedSec) || 0;
      r.score = Number(r.score) || 0;
      r.status = r.status || 'pending';
      r.bugCode = String(r.bugCode || '');
      r.createdAt = asIso(r.createdAt);
      r.updatedAt = asIso(r.updatedAt);
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
        sheet.getRange(r + 1, 12).setValue(request.status);
        sheet.getRange(r + 1, 13).setValue(request.score);
        sheet.getRange(r + 1, 14).setValue(request.reviewComment || '');
        sheet.getRange(r + 1, 15).setValue(new Date().toISOString());
        sheet.getRange(r + 1, 16).setValue(request.bugCode || '');
        return { ok: true };
      }
    }
    throw new Error('Дефект не найден: ' + request.id);
  } finally {
    lock.releaseLock();
  }
}
