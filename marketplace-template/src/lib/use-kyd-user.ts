import type { User, UserManager } from "oidc-client-ts";
import { useEffect, useState } from "react";

let callbackPromise: Promise<void> | undefined;

export function useKydUser(manager: UserManager | null) {
  const [user, setUser] = useState<User | null>(null);
  const [pending, setPending] = useState(Boolean(manager));
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    if (!manager) return;
    let active = true;
    const onLoaded = (loaded: User) => {
      if (active) setUser(loaded.expired ? null : loaded);
    };
    const onRemoved = () => {
      if (active) setUser(null);
    };
    manager.events.addUserLoaded(onLoaded);
    manager.events.addUserUnloaded(onRemoved);
    manager.events.addAccessTokenExpired(onRemoved);
    const callback = window.location.pathname === "/auth/callback";
    if (callback) callbackPromise ??= manager.signinPopupCallback();
    const loadUser = callback ? callbackPromise : manager.getUser();
    void loadUser
      ?.then((loaded) => {
        if (active) {
          setUser(loaded && !loaded.expired ? loaded : null);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error
              ? reason
              : new Error("Sign-in could not be completed."),
          );
        }
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
      manager.events.removeUserLoaded(onLoaded);
      manager.events.removeUserUnloaded(onRemoved);
      manager.events.removeAccessTokenExpired(onRemoved);
    };
  }, [manager]);
  async function signIn() {
    if (!manager || pending) return;
    setError(null);
    setPending(true);
    try {
      const loaded = await manager.signinPopup({ popupAbortOnClose: true });
      setUser(loaded.expired ? null : loaded);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason
          : new Error("Sign-in could not be started."),
      );
    } finally {
      setPending(false);
    }
  }
  async function signOut() {
    await manager?.removeUser();
  }
  return { user, pending, error, signIn, signOut };
}
