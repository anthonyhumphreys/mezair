/** Native backends call partials from EventEmitters: reject the send, never the emitter. */
export function guardLocalChatStream(assertScope: () => void, publish: (delta: string) => void) {
  let failure: Error | undefined;
  return {
    onPartial(delta: string): void {
      if (failure) return;
      try {
        assertScope();
        publish(delta);
      } catch (cause) {
        failure =
          cause instanceof Error ? cause : new Error('Local response delivery failed.', { cause });
      }
    },
    finish(): void {
      if (failure) throw failure;
      assertScope();
    },
  };
}
