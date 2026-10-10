import type {
    MediaSharePresentationGroup,
} from './mediaSchooling';

import type { PreparedPng } from './pngExport';

export type PreparedMediaPng = PreparedPng;

export type { ShareResult } from './pngExport';

export {
    currentPng as currentMediaPng,
    preparePngData as prepareMediaPngData,
    sharePngFile as shareMediaPng,
    shareResultMessage,
} from './pngExport';

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