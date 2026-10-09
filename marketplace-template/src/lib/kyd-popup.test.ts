import assert from "node:assert/strict";
import test from "node:test";
import { ErrorResponse, InMemoryWebStorage } from "oidc-client-ts";
import { createKydUserManager } from "./kyd";

void test("popup callbacks return to the opener without sharing its session storage", async (context) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let resolveAuthorizationRequest: (value: string) => void = () => {};
  let rejectAuthorizationRequest: (reason: unknown) => void = () => {};
  const authorizationRequest = new Promise<string>((resolve, reject) => {
    resolveAuthorizationRequest = resolve;
    rejectAuthorizationRequest = reject;
  });
  const controller = new AbortController();
  const origin = "http://localhost:5173";
  const config = {
    authority: "https://auth.example.com",
    clientId: "example-client",
    fanApiUrl: "https://api.example.com",
    scope: "openid profile fan:tickets:read",
  };
  const popup = {
    closed: false,
    location: { replace: (url: string) => resolveAuthorizationRequest(url) },
    focus() {},
    close() {
      this.closed = true;
    },
  };
  const messages = new EventTarget();
  const opener = {
    addEventListener: messages.addEventListener.bind(messages),
    removeEventListener: messages.removeEventListener.bind(messages),
    location: { origin, href: `${origin}/` },
    sessionStorage: new InMemoryWebStorage(),
    outerWidth: 1200,
    outerHeight: 900,
    screenX: 0,
    screenY: 0,
    open: () => popup,
    postMessage(data: unknown, targetOrigin: string) {
      assert.equal(targetOrigin, origin);
      messages.dispatchEvent(new MessageEvent("message", { data, origin }));
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: opener,
  });
  context.mock.method(
    globalThis,
    "fetch",
    async (input: Parameters<typeof fetch>[0]) => {
      assert.equal(
        input,
        `${config.authority}/.well-known/openid-configuration`,
      );
      return Response.json({
        issuer: config.authority,
        authorization_endpoint: `${config.authority}/authorize`,
      });
    },
  );
  try {
    const manager = createKydUserManager(config, "sandbox");
    const signIn = manager.signinPopup({
      popupSignal: controller.signal,
      popupAbortOnClose: true,
    });
    void signIn.catch(rejectAuthorizationRequest);
    const rejectedSignIn = assert.rejects(signIn, (error: unknown) => {
      assert.ok(error instanceof ErrorResponse, String(error));
      assert.equal(error.error, "access_denied");
      return true;
    });
    const authorizeUrl = new URL(await authorizationRequest);
    assert.equal(authorizeUrl.searchParams.get("display"), "popup");
    assert.equal(
      authorizeUrl.searchParams.get("redirect_uri"),
      `${origin}/auth/callback`,
    );
    assert.equal(opener.location.href, `${origin}/`);
    assert.equal((await manager.settings.stateStore.getAllKeys()).length, 1);

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: { origin },
        sessionStorage: new InMemoryWebStorage(),
        opener,
      },
    });
    const callbackManager = createKydUserManager(config, "sandbox");
    assert.deepEqual(
      await callbackManager.settings.stateStore.getAllKeys(),
      [],
    );
    const callbackUrl = new URL("/auth/callback", origin);
    callbackUrl.searchParams.set(
      "state",
      authorizeUrl.searchParams.get("state") ?? "",
    );
    callbackUrl.searchParams.set("error", "access_denied");
    const callback = callbackManager.signinPopupCallback(
      callbackUrl.toString(),
    );
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: opener,
    });
    await callback;
    await rejectedSignIn;

    assert.equal(opener.location.href, `${origin}/`);
    assert.equal(popup.closed, true);
    assert.deepEqual(await manager.settings.stateStore.getAllKeys(), []);
  } finally {
    controller.abort();
    if (previousWindow)
      Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
