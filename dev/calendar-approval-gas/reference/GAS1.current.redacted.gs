function doGet() {

  var htmlContent = getAppHtml();

  return HtmlService.createHtmlOutput(htmlContent)

         .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)

         .setTitle('カレンダー自動生成・一括保存ツール');

}



function saveImageToDrive(base64Data, fileName, folderId) {

  try {

    var contentType = 'image/png';

    var bytes = Utilities.base64Decode(base64Data.split(',')[1]);

    var blob = Utilities.newBlob(bytes, contentType, fileName);



    var folder = DriveApp.getFolderById(folderId);

    var file = folder.createFile(blob);

    return file.getUrl();

  } catch (e) {

    return 'Error: ' + e.toString();

  }

}



function getCalendarEventsData(targetYear, targetMonth) {

  var calendarIds = [

    '[CALENDAR_ID_REDACTED]',

    '[CALENDAR_ID_REDACTED]',

    '[CALENDAR_ID_REDACTED]',

    '[CALENDAR_ID_REDACTED]',

    '[CALENDAR_ID_REDACTED]'

  ];



  var startDate = new Date(targetYear, targetMonth - 1, 1);

  var endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59);

  var eventsMap = {};

  var cancellationCalendarId = '[CALENDAR_ID_REDACTED]';



  for (var c = 0; c < calendarIds.length; c++) {

    var calId = calendarIds[c];

    var isCancellation = calId === cancellationCalendarId;

    if (!calId || calId.indexOf('xxxx') !== -1) continue;



    var calendar = CalendarApp.getCalendarById(calId);

    if (!calendar) continue;



    var events = calendar.getEvents(startDate, endDate);

    for (var i = 0; i < events.length; i++) {

      var event = events[i];

      var rawTitle = event.getTitle();

      var startTime = event.getStartTime();

      var endTime = event.getEndTime();



      var isAllDay = event.isAllDayEvent();

      var startD = new Date(startTime.getTime());

      var endD = new Date(endTime.getTime());



      if (isAllDay) {

        endD.setTime(endD.getTime() - 1);

      }



      var startDayNum = startD.getDate();

      var endDayNum = endD.getDate();

      var isMultiDay = (startD.toDateString() !== endD.toDateString());



      var current = new Date(startD.getTime());



      while (current <= endD) {

        if (current.getMonth() === targetMonth - 1) {

          var dayNum = current.getDate();

          var formattedTitle = "";



          if (isMultiDay) {

            if (dayNum === startDayNum && current.getMonth() === startD.getMonth()) {

              formattedTitle = formatEventTitle(rawTitle, 'start');

            } else if (dayNum === endDayNum && current.getMonth() === endD.getMonth()) {

              formattedTitle = formatEventTitle(rawTitle, 'end');

            } else {

              formattedTitle = formatEventTitle(rawTitle, 'middle');

            }

          } else {

            formattedTitle = formatEventTitle(rawTitle, 'single');

          }



          if (formattedTitle !== '') {

            if (!eventsMap[dayNum]) {

              eventsMap[dayNum] = [];

            }

            var existingEvent = eventsMap[dayNum].find(function(item) {

              return item.title === formattedTitle;

            });



            if (existingEvent) {

              if (isCancellation) {

                existingEvent.isCancellation = true;

              }

            } else {

              eventsMap[dayNum].push({

                title: formattedTitle,

                isCancellation: isCancellation

              });

            }

          }

        }

        current.setDate(current.getDate() + 1);

      }

    }

  }

  return eventsMap;

}



function formatEventTitle(rawTitle, position) {

  if (!rawTitle) return '';

  var t = rawTitle;



  var groupMatch = t.match(/([0-9０-９]群)/);

  var groupStr = groupMatch ? groupMatch[1] : '';



  t = t.replace(/（[^）]+）/g, '');

  t = t.replace(/\([^)]+\)/g, '');

  t = t.replace(/※.+/g, '');

  t = t.trim();



  if (t.indexOf('夏期スクーリング') !== -1 || t.indexOf('夏スク') !== -1) {

    return '夏スク' + groupStr;

  }



  if (position === 'middle') {

    return '';

  }



  if (t.indexOf('10月') !== -1 && t.indexOf('新規リポート') !== -1) {

    return '10月受験科目<br>新規リポート受付開始';

  }



  t = t.replace(/後期メディアスクーリング/g, '後期メディア');

  t = t.replace(/後期週末スクーリング/g, '後期週末スク');

  t = t.replace(/秋期スクーリング/g, '秋スク');

  t = t.replace(/札幌市スクーリング/g, '札幌スク');

  t = t.replace(/福岡市スクーリング/g, '福岡スク');

  t = t.replace(/名古屋市スクーリング/g, '名古屋スク');

  t = t.replace(/冬期スクーリング/g, '冬スク');

  t = t.replace(/単位修得試験/g, '単修');

  t = t.replace(/リポート提出受付期間/g, 'リポート受付');



  if (position === 'start') {

    t = t.replace(/履修申請期間/g, '<br>履修申請開始');

    t = t.replace(/受講料振込期間/g, '<br>受講料振込開始');

    t = t.replace(/リポート受付/g, 'リポート受付開始');

    t = t.replace(/申込期間/g, '申込開始');

  } else if (position === 'end') {

    t = t.replace(/履修申請期間/g, '<br>履修申請締切');

    t = t.replace(/受講料振込期間/g, '<br>受講料振込締切');

    t = t.replace(/リポート受付/g, 'リポート受付締切');

    t = t.replace(/申込期間/g, '申込締切');

  } else {

    t = t.replace(/履修申請期間/g, '<br>履修申請');

  }



  return t;

}



function getAppHtml() {

  return `<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<link rel="preconnect" href="https://fonts.googleapis.com">

<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>

<link href="https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@900&display=swap" rel="stylesheet">

<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>

<style>

  html, body { margin: 0; padding: 0; background-color: #f4f4f9; font-family: "コーポレート・ロゴ", "Corporate Logo", "Corporate Logo B", "Hiragino Kaku Gothic ProN", "メイリオ", sans-serif; font-weight: 900; }

  .toolbar { position: fixed; top: 0; left: 0; right: 0; height: 50px; background-color: #333; color: #fff; display: flex; align-items: center; padding: 0 20px; z-index: 9999; gap: 15px; font-size: 14px; font-family: sans-serif; }

  .toolbar input { padding: 6px 10px; width: 320px; border-radius: 4px; border: none; font-size: 13px; }

  .toolbar button { background-color: #ff7a00; color: #fff; border: none; padding: 8px 16px; border-radius: 4px; font-weight: bold; cursor: pointer; }

  .toolbar button:hover { background-color: #e06b00; }

  .status { font-weight: bold; color: #00ffcc; }

  .stage-wrapper { margin-top: 60px; display: flex; justify-content: center; padding: 20px; }

  .container { width: 1280px; height: 720px; background-color: #ff7a00; padding: 20px; box-sizing: border-box; position: relative; color: #000000; overflow: hidden; font-weight: 900; }

  .inner-content { width: 100%; height: 100%; background-color: #ffffff; border-radius: 20px; box-sizing: border-box; display: flex; padding: 15px 30px; overflow: hidden; }

  .left-side { width: 90px; display: flex; align-items: center; justify-content: center; }

  .left-text { transform: rotate(-90deg); transform-origin: center center; white-space: nowrap; font-size: 38px; font-weight: 900; letter-spacing: 4px; -webkit-text-stroke: 0.5px #000000; }

  .main-content { flex: 1; display: flex; flex-direction: column; justify-content: space-between; }

  .header-title { text-align: center; font-size: 40px; font-weight: 900; letter-spacing: 2px; margin-bottom: 4px; -webkit-text-stroke: 0.5px #000000; }

  .calendar-table { width: 100%; border-collapse: collapse; table-layout: fixed; }

  .calendar-table th, .calendar-table td { border: 1.5px solid #000000; text-align: center; vertical-align: top; }

  .calendar-table th { height: 30px; font-size: 16px; font-weight: 900; background-color: #ffffff; vertical-align: middle; -webkit-text-stroke: 0.3px #000000; }

  .calendar-table td { height: 82px; padding: 3px 2px; box-sizing: border-box; }

  .day-number { font-size: 17px; font-weight: 900; margin-bottom: 2px; text-align: center; -webkit-text-stroke: 0.3px #000000; }

  .event-item { font-size: 12px; font-weight: 900; line-height: 1.2; text-align: center; word-break: keep-all; overflow-wrap: break-word; margin-bottom: 2px; -webkit-text-stroke: 0.2px #000000; }

  .footer-title { text-align: right; font-size: 32px; font-weight: 900; letter-spacing: 1px; margin-top: 2px; line-height: 1; -webkit-text-stroke: 0.5px #000000; }

  .nikumaru-font { font-family: "にくまるフォント", "Nikumaru", "Zen Maru Gothic", sans-serif; font-weight: 900; -webkit-text-stroke: 0.5px #000000; }

  .event-item.cancellation {

  color: #d32f2f;

  -webkit-text-stroke: 0.2px #d32f2f;

}

</style>

</head>

<body>

  <div class="toolbar">

    <label>生成月:</label>

    <input type="month" id="targetMonth" value="2026-10" onchange="previewCalendar()">



    <label>フォルダID:</label>

    <input type="text" id="folderId" value="[FOLDER_ID_REDACTED]" placeholder="フォルダIDを入力">



    <button onclick="startGeneration()">仮生成して保存</button>

    <div class="status" id="statusText"></div>

  </div>

  <div class="stage-wrapper">

    <div class="container" id="calendarContainer">

    </div>

  </div>

  <script>

    var monthsEnglish = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

    var weekDays = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

    function renderCalendarDom(year, month, eventsMap) {

      var englishMonth = monthsEnglish[month - 1];

      var firstDayObj = new Date(year, month - 1, 1);

      var startColIndex = (firstDayObj.getDay() + 6) % 7;

      var endDateObj = new Date(year, month, 0);

      var totalDays = endDateObj.getDate();

      var tableRowsHtml = "<tr>";

      for (var w = 0; w < weekDays.length; w++) {

        tableRowsHtml += "<th>" + weekDays[w] + "</th>";

      }

      tableRowsHtml += "</tr>";

      var colIndex = startColIndex;

      var currentWeekHtml = "<tr>";

      for (var pad = 0; pad < startColIndex; pad++) {

        currentWeekHtml += "<td></td>";

      }

      for (var d = 1; d <= totalDays; d++) {

        var eventList = eventsMap[d] ? eventsMap[d] : [];

        var eventHtml = "";

        for (var e = 0; e < eventList.length; e++) {

          var item = eventList[e];



          var safeTitle = String(item.title)

            .replace(/&/g, '&amp;')

            .replace(/</g, '&lt;')

            .replace(/>/g, '&gt;')

            .replace(/"/g, '&quot;')

            .replace(/'/g, '&#39;')

            .replace(/&lt;br&gt;/gi, '<br>');



          var className = item.isCancellation

            ? 'event-item cancellation'

            : 'event-item';



          eventHtml +=

            '<div class="' + className + '">' +

            safeTitle +

            '</div>';

      }

        currentWeekHtml += '<td><div class="day-number">' + d + '</div>' + eventHtml + '</td>';

        colIndex++;

        if (colIndex === 7) {

          currentWeekHtml += "</tr>";

          tableRowsHtml += currentWeekHtml;

          currentWeekHtml = "<tr>";

          colIndex = 0;

        }

      }

      if (colIndex > 0) {

        while (colIndex < 7) {

          currentWeekHtml += "<td></td>";

          colIndex++;

        }

        currentWeekHtml += "</tr>";

        tableRowsHtml += currentWeekHtml;

      }

      var innerHtml = '<div class="inner-content">' +

        '<div class="left-side"><div class="left-text">' + year + ' ' + englishMonth + '</div></div>' +

        '<div class="main-content"><div class="header-title">' + month + '月通教生向けスケジュール</div>' +

        '<table class="calendar-table">' + tableRowsHtml + '</table>' +

        '<div class="footer-title"><span class="nikumaru-font">法政通信メディア</span></div></div>' +

        '</div>';

      document.getElementById("calendarContainer").innerHTML = innerHtml;

    }

    async function startGeneration() {

      var folderId = document.getElementById("folderId").value.trim();

      var targetMonthValue = document.getElementById("targetMonth").value;



      if (!targetMonthValue) {

        alert("生成する月を選択してください");

        return;

      }



      if (!folderId) {

        alert("フォルダIDを入力してください");

        return;

      }



      var parts = targetMonthValue.split("-");

      var year = Number(parts[0]);

      var month = Number(parts[1]);



      var statusText = document.getElementById("statusText");



      statusText.innerText =

      year + "年" + month + "月のデータ取得中...";



      var eventsMap = await new Promise(function(resolve, reject) {

        google.script.run

          .withSuccessHandler(resolve)

          .withFailureHandler(reject)

          .getCalendarEventsData(year, month);

      });



      renderCalendarDom(year, month, eventsMap);



      statusText.innerText =

        year + "年" + month + "月の画像キャプチャ中...";



      await new Promise(function(r) {

        setTimeout(r, 500);

      });



      var canvas = await html2canvas(

        document.getElementById("calendarContainer"),

        {

          scale: 1,

          useCORS: true

        }

      );



      var base64Data = canvas.toDataURL("image/png");



      statusText.innerText =

        year + "年" + month + "月の仮生成画像を保存中...";



      try {

        const result = await new Promise(function(resolve, reject) {

          google.script.run

            .withSuccessHandler(resolve)

            .withFailureHandler(reject)

            .saveDraftToDrive(base64Data, year, month, folderId);

        });



        statusText.innerText =

          year + "年" + month + "月の仮生成が完了しました！";



        console.log("保存した下書き:", result);



      } catch (error) {

        statusText.innerText =

          "保存エラー: " + (error.message || error);



        console.error(error);

      }



      }



function previewCalendar() {

  var targetMonthValue = document.getElementById("targetMonth").value;



  if (!targetMonthValue) return;



  var parts = targetMonthValue.split("-");

  var year = Number(parts[0]);

  var month = Number(parts[1]);



  var statusText = document.getElementById("statusText");

  statusText.innerText = year + "年" + month + "月を読み込み中...";



  google.script.run

    .withSuccessHandler(function(eventsMap) {

      renderCalendarDom(year, month, eventsMap);

      statusText.innerText = "";

    })

    .withFailureHandler(function(error) {

      statusText.innerText = "エラー: " + error.message;

    })

    .getCalendarEventsData(year, month);

}



// ページを開いたときに初期月を表示

window.onload = function() {

  previewCalendar();



  // 月を変更したら自動でプレビュー更新

  document

    .getElementById("targetMonth")

    .addEventListener("change", previewCalendar);

};

</script>

</body>

</html>`;

}



function saveDraftToDrive(base64Data, year, month, folderId) {

  year = Number(year);

  month = Number(month);



  if (!Number.isInteger(year) ||

      !Number.isInteger(month) ||

      month < 1 || month > 12) {

    throw new Error('年月が不正です');

  }



  const match = /^data:image\/png;base64,(.+)$/.exec(base64Data);

  if (!match) {

    throw new Error('PNGデータが不正です');

  }



  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;



  const timestamp = Utilities.formatDate(

    new Date(),

    'Asia/Tokyo',

    'yyyyMMdd_HHmmss'

  );



  const fileName = `draft_${yearMonth}_${timestamp}.png`;



  const blob = Utilities.newBlob(

    Utilities.base64Decode(match[1]),

    'image/png',

    fileName

  );



  const file = DriveApp

    .getFolderById(folderId)

    .createFile(blob);



  PropertiesService.getScriptProperties().setProperties({

    draft_year_month: yearMonth,

    draft_file_id: file.getId(),

    draft_status: 'draft_ready',

    draft_generated_at: new Date().toISOString(),

    draft_approved_at: '',

    draft_published_at: ''

  });



  return {

    ok: true,

    status: 'draft_ready',

    yearMonth: yearMonth,

    fileId: file.getId(),

    url: file.getUrl()

  };

}



function testMergedCalendar() {

  const eventsMap = getCalendarEventsData(2026, 10);



  Logger.log(

    '10月12日の予定: ' +

    JSON.stringify(eventsMap[12] || [])

  );

}



function getDraftInfo() {

  const props = PropertiesService.getScriptProperties();

  const data = props.getProperties();

  return {

    yearMonth: data.draft_year_month || '',

    fileId: data.draft_file_id || '',

    status: data.draft_status || 'not_generated',

    generatedAt: data.draft_generated_at || '',

    approvedAt: data.draft_approved_at || '',

    publishedAt: data.draft_published_at || '',

    url: data.draft_file_id

      ? `https://drive.google.com/file/d/${data.draft_file_id}/view`

      : '',

  };

}



function publishApprovedDraft() {

  const props = PropertiesService.getScriptProperties();

  const data = props.getProperties();



  if (data.draft_status !== 'approved') {

    throw new Error('承認済みdraftのみ公開できます。');

  }

  if (!data.draft_file_id || !data.draft_year_month) {

    throw new Error('公開対象のdraft情報が不完全です。');

  }



  const draftFile = DriveApp.getFileById(data.draft_file_id);

  const publishedFolder = DriveApp.getFolderById(CONFIG.PUBLISHED_FOLDER_ID);

  const oldPublished = findFileByNameInFolder_(

    publishedFolder,

    CONFIG.PUBLISHED_FILE_NAME

  );

  if (oldPublished) {

    oldPublished.setTrashed(true);

  }



  const publishedFile = publishedFolder.createFile(

    draftFile.getBlob()

  ).setName(CONFIG.PUBLISHED_FILE_NAME);



  props.setProperties({

    draft_status: 'published',

    draft_published_at: new Date().toISOString(),

    published_file_id: publishedFile.getId(),

  }, false);



  Logger.log(`Draft published: ${data.draft_year_month} / ${publishedFile.getUrl()}`);



  return {

    ok: true,

    status: 'published',

    yearMonth: data.draft_year_month,

    publishedFileId: publishedFile.getId(),

    publishedUrl: publishedFile.getUrl(),

  };

}



function publishApprovedDraftForCurrentMonth() {

  const now = new Date();

  const year = Number(Utilities.formatDate(now, CONFIG.TIMEZONE, 'yyyy'));

  const month = Number(Utilities.formatDate(now, CONFIG.TIMEZONE, 'M'));

  const currentYearMonth = formatYearMonth_(year, month);



  const info = getDraftInfo();



  if (info.status !== 'approved') {

    throw new Error(`当月公開中止: draftがapprovedではありません。status=${info.status}`);

  }

}



  function testGetDraftInfo() {

  const info = getDraftInfo();

  Logger.log(JSON.stringify(info, null, 2));

}



function notifyCurrentDraftToLine() {

  const draft = getDraftInfo();



  if (draft.status !== 'draft_ready' || !draft.fileId) {

    throw new Error('通知できる仮生成画像がありません');

  }



  // ファイルが実在し、PNGであることを確認

  const file = DriveApp.getFileById(draft.fileId);



  if (file.getMimeType() !== 'image/png') {

    throw new Error('仮生成ファイルがPNGではありません');

  }



  const message =

    '【カレンダー確認依頼】\n\n' +

    '対象月：' + draft.yearMonth + '\n\n' +

    '以下の画像をご確認ください。\n' +

    draft.url + '\n\n' +

    '問題がなければ「OK」、修正があれば内容をご返信ください。\n\n' +

    '※まだWebサイトには公開されていません。';



  sendLinePushMessageAsMultipleBubbles([message]);



  Logger.log('LINEへの確認依頼を送信しました');

}



function testCalendarLineDelivery() {

  const props = PropertiesService.getScriptProperties();



  const groupId = props.getProperty('CALENDAR_LINE_GROUP_ID');

  const token = props.getProperty('LINE_CHANNEL_ACCESS_TOKEN');



  if (!groupId || !token) {

    throw new Error('LINEの設定が不足しています');

  }



  const response = UrlFetchApp.fetch(

    'https://api.line.me/v2/bot/message/push',

    {

      method: 'post',

      contentType: 'application/json',

      headers: {

        Authorization: 'Bearer ' + token

      },

      payload: JSON.stringify({

        to: groupId,

        messages: [

          {

            type: 'text',

            text: '【カレンダーBot】通知テスト成功！'

          }

        ]

      }),

      muteHttpExceptions: true

    }

  );



  Logger.log('HTTPステータス: ' + response.getResponseCode());



  if (response.getResponseCode() !== 200) {

    throw new Error(response.getContentText());

  }

}
