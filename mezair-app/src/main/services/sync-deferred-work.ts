// Kept independent of auth/keyring imports so every runtime transition can fence timers.
let epoch = 0;
export function retireDeferredSyncWork(): void {
  epoch++;
}
export function captureDeferredSyncWork(): () => boolean {
  const captured = epoch;
  return () => captured === epoch;
}
