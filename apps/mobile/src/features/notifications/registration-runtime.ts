type PushDeviceUnregisterHandler = () => Promise<void>;

let unregisterHandler: PushDeviceUnregisterHandler | null = null;

export function setPushDeviceUnregisterHandler(
  handler: PushDeviceUnregisterHandler,
): () => void {
  unregisterHandler = handler;

  return () => {
    if (unregisterHandler === handler) {
      unregisterHandler = null;
    }
  };
}

export async function unregisterCurrentPushDevice(): Promise<void> {
  await unregisterHandler?.();
}
