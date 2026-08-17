import { useObserve } from 'expo-observe';
import { createContext, useContext, useEffect, type ReactNode } from 'react';

const SplashDoneContext = createContext(false);

export function SplashDoneProvider({
  done,
  children,
}: {
  done: boolean;
  children: ReactNode;
}) {
  return <SplashDoneContext.Provider value={done}>{children}</SplashDoneContext.Provider>;
}

/**
 * Reports the screen as ready for input to EAS Observe. Waits for the animated
 * splash overlay to finish, so startup metrics cover the full time until the
 * user can actually interact.
 */
export function useMarkInteractive(isScreenReady: boolean) {
  const isSplashDone = useContext(SplashDoneContext);
  const { markInteractive } = useObserve();

  useEffect(() => {
    if (isScreenReady && isSplashDone) {
      markInteractive();
    }
  }, [isScreenReady, isSplashDone, markInteractive]);
}
