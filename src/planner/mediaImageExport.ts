import type { MediaSharePresentationGroup } from './mediaSchooling';

export type PreparedMediaPng = {
    key: string;
    dataUrl: string;
    file: File;
};

export function mediaPngKey(
    presentation: MediaSharePresentationGroup[],
    comment: string,
    date: string
): string {
    return JSON.stringify([
        presentation,
        comment.trim(),
        date,
    ]);
}

export function currentMediaPng(
    png: PreparedMediaPng | null,
    currentKey: string
): PreparedMediaPng | null {
    return png?.key === currentKey ? png : null;
}

type PngRenderer = (
    node: HTMLElement,
    options: {
        backgroundColor: string;
        pixelRatio: number;
        cacheBust: boolean;
        skipFonts: boolean;
    }
) => Promise<string>;

export async function prepareMediaPngData(
    node: HTMLElement,
    render: PngRenderer,
    read: (url: string) => Promise<Pick<Response, 'ok' | 'blob'>> = fetch
): Promise<{ dataUrl: string; blob: Blob }> {
    const dataUrl = await render(node, {
        backgroundColor: '#fffaf3',
        pixelRatio: 2,
        cacheBust: true,
        skipFonts: true,
    });

    const response = await read(dataUrl);
    if (!response.ok) throw new Error('PNG fetch failed');

    const blob = await response.blob();

    if (blob.type !== 'image/png' || blob.size === 0) {
        throw new Error('Invalid PNG');
    }

    return { dataUrl, blob };
}

export type ShareResult =
    | 'completed'
    | 'unsupported'
    | 'cancelled'
    | 'failed';

type ShareApi = {
    share?: (data: ShareData) => Promise<void>;
    canShare?: (data: ShareData) => boolean;
};

export async function shareMediaPng(
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
        // 呼び出し前にawaitを挟まない。
        // iOSのユーザー操作要件を維持する。
        await api.share({ files: [file] });
        return 'completed';
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            return 'cancelled';
        }
        return 'failed';
    }
}

export function shareResultMessage(result: ShareResult): string {
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