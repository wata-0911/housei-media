export type PngOptions = {
  backgroundColor: string;
  pixelRatio: number;
  cacheBust: boolean;
  skipFonts: boolean;
};

export type PngRenderer = (
  node: HTMLElement,
  options: PngOptions
) => Promise<string>;

export type PngReader = (
  url: string
) => Promise<Pick<Response, 'ok' | 'blob'>>;

export type PreparedPng = {
  key: string;
  dataUrl: string;
  file: File;
};

export function currentPng(
  png: PreparedPng | null,
  currentKey: string
): PreparedPng | null {
  return png?.key === currentKey ? png : null;
}

export async function preparePngData(
  node: HTMLElement,
  render: PngRenderer,
  read: PngReader = fetch,
  options: Partial<PngOptions> = {}
): Promise<{ dataUrl: string; blob: Blob }> {
  const dataUrl = await render(node, {
    backgroundColor: '#fffaf3',
    pixelRatio: 2,
    cacheBust: true,
    skipFonts: true,
    ...options,
  });

  const response = await read(dataUrl);

  if (!response.ok) {
    throw new Error('PNG fetch failed');
  }

  const blob = await response.blob();

  if (blob.type !== 'image/png' || blob.size === 0) {
    throw new Error('Invalid PNG');
  }

  return { dataUrl, blob };
}

export function createPngFile(
  blob: Blob,
  fileName: string
): File {
  return new File([blob], fileName, {
    type: 'image/png',
  });
}

export type ShareResult =
  | 'completed'
  | 'unsupported'
  | 'cancelled'
  | 'failed';

export type ShareApi = {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
};

export async function sharePngFile(
  file: File,
  api: ShareApi
): Promise<ShareResult> {
  try {
    if (!api.share || !api.canShare?.({ files: [file] })) {
      return 'unsupported';
    }
  } catch {
    return 'unsupported';
  }

  try {
    // 共有操作の直前に余分なawaitを入れない。
    await api.share({ files: [file] });
    return 'completed';
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return 'cancelled';
    }

    return 'failed';
  }
}

export function shareResultMessage(
  result: ShareResult
): string {
  switch (result) {
    case 'completed':
      return '共有操作が終了しました。保存先をご確認ください。';
    case 'unsupported':
      return 'このブラウザでは画像共有を利用できません。画像の長押し保存をお試しください。';
    case 'cancelled':
      return '共有をキャンセルしました。';
    case 'failed':
      return '画像を共有できませんでした。';
  }
}