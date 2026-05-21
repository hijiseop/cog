function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

function recordTransaction(data, skipEmail) {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const tx      = ss.getSheetByName(SHEET_TX);
  const qty     = Number(data.qty);
  const handler = data.handler || '';

  if (!data.item || !qty || qty <= 0) {
    throw new Error('물품명과 수량(1 이상)을 올바르게 입력하세요.');
  }

  // appendRow 이후엔 롤백 수단이 없으므로 사전 차단
  if (data.type === '출고' || data.type === '대여') {
    const cur = getStock(data.item);
    if (qty > cur) {
      throw new Error(
        '"' + data.item + '" 현재고(' + cur + '개)보다 많은 수량은 처리할 수 없습니다.'
      );
    }
  }

  tx.appendRow([
    new Date(),
    data.type,
    data.item,
    qty,
    handler,
    data.borrower || '',
    data.dueDate  || '',
    data.type === '대여' ? STATUS_UNRETURNED : '-',
    '',
    data.memo || '',
    data.localId  || ''
  ]);

  // 클라이언트가 반납 처리 시 행을 특정하는 데 필요
  const serverRow = tx.getLastRow();

  const stockMap = updateInventory();
  const entry    = stockMap[data.item] || { in: 0, out: 0, loan: 0 };
  const stock    = entry.in - entry.out - entry.loan;
  if (!skipEmail) sendNotice(data.type, data.item, qty, handler, stock);

  return { item: data.item, stock: stock, serverRow: serverRow };
}

function getStock(item) {
  const inv  = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_INV);
  const rows = inv.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === item) return Number(rows[i][4]) || 0;
  }
  return 0;
}

// 증분 갱신 대신 전체 재스캔: 거래내역이 원본이므로 중간 수정·삭제가 생겨도 항상 정합성 보장
function updateInventory() {
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  const tx   = ss.getSheetByName(SHEET_TX);
  const inv  = ss.getSheetByName(SHEET_INV);
  const rows = tx.getDataRange().getValues();

  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const type = rows[i][1];
    const item = rows[i][2];
    const qty  = Number(rows[i][3]) || 0;
    const ret  = rows[i][7];
    if (!item) continue;
    if (!map[item]) map[item] = { in: 0, out: 0, loan: 0 };

    if (type === '입고' || type === '반납')               map[item].in   += qty;
    else if (type === '출고')                              map[item].out  += qty;
    else if (type === '대여' && ret === STATUS_UNRETURNED) map[item].loan += qty;
  }

  const out = [['물품명', '총입고', '총출고', '대여중', '현재고']];
  Object.keys(map).sort().forEach(function (item) {
    const m = map[item];
    out.push([item, m.in, m.out, m.loan, m.in - m.out - m.loan]);
  });

  inv.clearContents();
  inv.getRange(1, 1, out.length, 5).setValues(out);
  inv.getRange(1, 1, 1, 5).setFontWeight('bold');

  return map;
}

function getOpenLoans() {
  const tx   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_TX);
  const rows = tx.getDataRange().getValues();
  const list = [];

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] !== '대여' || rows[i][7] !== STATUS_UNRETURNED) continue;
    let due = rows[i][6];
    if (due instanceof Date) {
      due = Utilities.formatDate(due, TZ, 'yyyy-MM-dd');
    }
    list.push({
      row:      i + 1,
      item:     rows[i][2],
      qty:      rows[i][3],
      borrower: rows[i][5],
      dueDate:  due || ''
    });
  }
  return list;
}

function returnLoan(rowNum) {
  const tx = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_TX);
  // 시트 갱신 전에 물품명·수량 읽기 — 쓰기 후 읽으면 캐시 타이밍 이슈 발생 가능
  const [item, qty] = tx.getRange(rowNum, 3, 1, 2).getValues()[0];

  tx.getRange(rowNum, 8, 1, 2).setValues([['반납완료', new Date()]]);

  const stockMap = updateInventory();
  const entry    = stockMap[item] || { in: 0, out: 0, loan: 0 };
  const stock    = entry.in - entry.out - entry.loan;
  sendNotice('반납', item, qty, '', stock);

  return { item: item, stock: stock };
}

function getSyncedIds() {
  const tx   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_TX);
  const rows = tx.getDataRange().getValues();
  const ids  = {};
  for (let i = 1; i < rows.length; i++) {
    const id = rows[i][10];
    if (id) ids[id] = true;
  }
  return ids;
}

// offline.html 동기화 엔드포인트 — 거래 배열을 받아 순서대로 처리
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var isReset = !Array.isArray(payload) && payload.reset;
    var list    = Array.isArray(payload) ? payload : (payload.transactions || []);
    var results = [];

    if (isReset) {
      var ss      = SpreadsheetApp.getActiveSpreadsheet();
      var txSheet = ss.getSheetByName(SHEET_TX);
      txSheet.clearContents();
      txSheet.appendRow(['날짜시각','구분','물품명','수량','담당자','대여자','반납예정일','상태','반납일','메모','ID']);
      txSheet.getRange(1, 1, 1, 11).setFontWeight('bold');
      ss.getSheetByName(SHEET_INV).clearContents();
    }

    var synced = isReset ? {} : getSyncedIds();

    for (var i = 0; i < list.length; i++) {
      var tx = list[i];
      if (tx.localId && synced[tx.localId]) {
        results.push({ localId: tx.localId, ok: true });
        continue;
      }
      try {
        var res = recordTransaction(tx, isReset);
        // 오프라인 중 반납까지 처리된 대여는 즉시 반납 처리
        if (tx.type === '대여' && tx.returnedAt) {
          returnLoan(res.serverRow);
        }
        results.push({ localId: tx.localId, ok: true });
      } catch (err) {
        results.push({ localId: tx.localId, ok: false, error: err.message });
      }
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, results: results }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// 클라이언트 로컬 DB 초기화용 — 재고현황 + 미반납 대여 목록 반환
function getSnapshot() {
  const inv     = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_INV);
  const invRows = inv.getDataRange().getValues();
  const inventory = [];
  for (let i = 1; i < invRows.length; i++) {
    if (invRows[i][0]) {
      inventory.push({ item: String(invRows[i][0]), stock: Number(invRows[i][4]) || 0 });
    }
  }
  return { inventory: inventory, loans: getOpenLoans() };
}

// 메일 실패가 거래 기록을 막으면 안 되므로 예외를 삼키고 로그만 남김
function sendNotice(type, item, qty, handler, stock) {
  try {
    const subject = '[창고 알림] ' + type + ' - ' + item + ' ' + qty + '개';
    const body =
      '창고 물품 관리 대장 알림\n' +
      '------------------------------\n' +
      '· 구분    : ' + type + '\n' +
      '· 물품명  : ' + item + '\n' +
      '· 수량    : ' + qty + '개\n' +
      (handler ? '· 담당자  : ' + handler + '\n' : '') +
      '· 처리시각: ' +
        Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm') + '\n' +
      '· 현재고  : ' + stock + '개\n' +
      '------------------------------';
    MailApp.sendEmail(ADMIN_EMAIL, subject, body);
  } catch (e) {
    console.error('메일 발송 실패: ' + e);
  }
}
