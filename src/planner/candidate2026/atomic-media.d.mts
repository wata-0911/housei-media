export const AUTHORITY: string;
export const FORMAT: string;

export type Capture = Readonly<{
  authorityRaw: string | null;
  legacyP: string | null;
  legacyR: string | null;
}>;

export type Lesson = { lesson: number; videoCompleted: boolean; testCompleted: boolean };
export type Assessment = { id: string; label: string; scheduledDate: string | null; completed: boolean };
export type Track = { id: string; totalLessons: number; lessons: Lesson[]; assessments: Assessment[] };
export type Ready = { status: 'ready'; capture: Capture; primaryRaw: string; generation: string | null; tracks: Track[] };
export type Reading = Ready | { status: 'hold'; reason: string };
export type Receipt = Readonly<{ protectionText: string }>;

export function openAtomicMedia(options: {
  store: Pick<Storage, 'getItem' | 'setItem'>;
  primaryKey: string;
  recoveryKey: string;
  preflight: { check(): Promise<void>; checkLocal(): void };
  withLock: <Result>(action: () => Result) => Promise<Result>;
  legacyFence: (primary: string | null, recovery: string | null) => Promise<void>;
  backup: {
    emptyPrimary: string;
    validPrimary(raw: string): boolean;
    exportLegacy(raw: string): Promise<unknown>;
    importLegacy(raw: string): Promise<string>;
    stateIdentity(value: unknown): string;
  };
}): {
  read(): Promise<Reading>;
  prepareRestore(source: string | Uint8Array, before: Capture): Promise<Receipt>;
  exportRestoreProtection(receipt: Receipt, source: Uint8Array, isCurrent: () => boolean, deliver: (text: string) => void): Promise<void>;
  verifyProtection(receipt: Receipt, bytes: Uint8Array): Promise<void>;
  restore(receipt: Receipt, isCurrent: () => boolean): Promise<string>;
  cancelRestore(): void;
  upsertTrack(before: Capture, track: Track, mode: 'create' | 'edit', isCurrent: () => boolean): Promise<string>;
  exportPortable(before: Capture): Promise<string>;
  exportQuarantine(): Promise<string>;
};
