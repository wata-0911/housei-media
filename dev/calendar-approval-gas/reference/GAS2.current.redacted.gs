function calendarDraftBridgeResponse_(data) {

  return ContentService

    .createTextOutput(JSON.stringify(data))

    .setMimeType(ContentService.MimeType.JSON);

}



function doPost(e) {

  let request;



  try {

    request = JSON.parse(e.postData.contents);

  } catch {

    return calendarDraftBridgeResponse_({

      ok: false,

      error: 'invalid_request',

    });

  }



  const props =

    PropertiesService.getScriptProperties().getProperties();



  const secret = props.CALENDAR_DRAFT_BRIDGE_SECRET;



  // 呼び出し元の認証

  if (

    !secret ||

    request?.secret !== secret ||

    request?.action !== 'get_current_draft'

  ) {

    return calendarDraftBridgeResponse_({

      ok: false,

      error: 'unauthorized',

    });

  }



  const yearMonth = props.draft_year_month;

  const fileId = props.draft_file_id;

  const status = props.draft_status;

  const generatedAt = props.draft_generated_at || '';



  // 下書きが存在しない場合

  if (

    status !== 'draft_ready' ||

    !fileId ||

    !/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth || '')

  ) {

    return calendarDraftBridgeResponse_({

      ok: false,

      error: 'draft_not_ready',

    });

  }



  try {

    const file = DriveApp.getFileById(fileId);



    if (file.getMimeType() !== 'image/png') {

      return calendarDraftBridgeResponse_({

        ok: false,

        error: 'invalid_file_type',

      });

    }



    // Vercelへの転送サイズを制限

    const MAX_BYTES = 2.5 * 1024 * 1024;



    if (file.getSize() > MAX_BYTES) {

      return calendarDraftBridgeResponse_({

        ok: false,

        error: 'file_too_large',

      });

    }



    const bytes = file.getBlob().getBytes();



    if (bytes.length > MAX_BYTES) {

      return calendarDraftBridgeResponse_({

        ok: false,

        error: 'file_too_large',

      });

    }



    return calendarDraftBridgeResponse_({

      ok: true,

      yearMonth,

      generatedAt,

      mimeType: 'image/png',

      imageBase64: Utilities.base64Encode(bytes),

    });



  } catch {

    return calendarDraftBridgeResponse_({

      ok: false,

      error: 'storage_error',

    });

  }

}
