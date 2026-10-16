/** Only the local Vite serve process can enable this entry. URL/storage are not authorities. */
export function attemptWorkbenchEnabled(command: string, mode: string, flag: string | undefined, nodeEnv?: string) {
  return command === 'serve' && mode !== 'production' && nodeEnv !== 'production' && flag === '1';
}
