import { generateKeyPairSync, sign } from "crypto";
import { describe, expect, it, vi } from "vitest";
import { ClerkOAuthClient, type StoredOAuthSession } from "../clerk-oauth";

const issuer = "https://test.clerk.accounts.dev";
const clientId = "oauth_client_1";
const config = {
  issuer,
  clientId,
  redirectUri: "coordy://oauth/callback",
  scopes: ["openid", "profile", "email", "user:org:read"],
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function memoryStore(initial: StoredOAuthSession | null = null) {
  let value = initial;
  return {
    load: vi.fn(async () => value),
    save: vi.fn(async (next: StoredOAuthSession) => { value = next; }),
    clear: vi.fn(async () => { value = null; }),
  };
}

describe("Clerk browser OAuth", () => {
  it("creates an S256 PKCE request without a client secret", async () => {
    const request = vi.fn(async () => json({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      userinfo_endpoint: `${issuer}/oauth/userinfo`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
    })) as unknown as typeof fetch;
    const client = new ClerkOAuthClient(config, memoryStore(), request);
    const url = new URL(await client.beginAuthorization());
    expect(url.origin + url.pathname).toBe(`${issuer}/oauth/authorize`);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("user:org:read");
    expect(url.searchParams.has("client_secret")).toBe(false);
  });

  it("rejects forged state before exchanging a code", async () => {
    const request = vi.fn(async () => json({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      userinfo_endpoint: `${issuer}/oauth/userinfo`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
    })) as unknown as typeof fetch;
    const client = new ClerkOAuthClient(config, memoryStore(), request);
    await client.beginAuthorization();
    await expect(client.completeAuthorization("coordy://oauth/callback?code=x&state=forged"))
      .rejects.toThrow("Invalid OAuth callback");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("verifies the ID token and stores only after userinfo succeeds", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" });
    const store = memoryStore();
    let nonce = "";
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/.well-known/oauth-authorization-server")) {
        return json({
          issuer,
          authorization_endpoint: `${issuer}/oauth/authorize`,
          token_endpoint: `${issuer}/oauth/token`,
          userinfo_endpoint: `${issuer}/oauth/userinfo`,
          jwks_uri: `${issuer}/.well-known/jwks.json`,
        });
      }
      if (url.endsWith("/oauth/token")) {
        const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "key_1", typ: "JWT" })).toString("base64url");
        const payload = Buffer.from(JSON.stringify({
          iss: issuer,
          aud: clientId,
          nonce,
          exp: 2_000,
        })).toString("base64url");
        const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
        return json({
          access_token: "access-secret",
          refresh_token: "refresh-secret",
          id_token: `${header}.${payload}.${signature}`,
          expires_in: 3600,
          token_type: "Bearer",
        });
      }
      if (url.endsWith("/.well-known/jwks.json")) {
        return json({ keys: [{ ...jwk, kid: "key_1", alg: "RS256", use: "sig" }] });
      }
      if (url.endsWith("/oauth/userinfo")) {
        return json({
          sub: "user_1",
          name: "Alex",
          email: "alex@example.test",
          picture: "https://img.clerk.com/avatar",
          org_id: "org_1",
          org_name: "Coordy Team",
        });
      }
      return json({}, 404);
    }) as unknown as typeof fetch;
    const client = new ClerkOAuthClient(config, store, request, () => 1_000_000);
    const authorization = new URL(await client.beginAuthorization());
    nonce = authorization.searchParams.get("nonce")!;
    const state = authorization.searchParams.get("state")!;
    const result = await client.completeAuthorization(`coordy://oauth/callback?code=valid&state=${state}`);
    expect(result).toEqual({
      status: "signed-in",
      identity: {
        id: "user_1",
        name: "Alex",
        email: "alex@example.test",
        imageUrl: "https://img.clerk.com/avatar",
      },
      organization: { id: "org_1", name: "Coordy Team", imageUrl: null },
    });
    expect(store.save).toHaveBeenCalledOnce();
  });

  it("refreshes a stored session when the refresh response omits an ID token", async () => {
    const store = memoryStore({
      accessToken: "expired-access",
      refreshToken: "refresh-secret",
      expiresAt: 1,
      identity: { id: "user_1", name: "Old name", email: null, imageUrl: null },
      organization: { id: "org_1", name: "Old team", imageUrl: null },
    });
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/.well-known/oauth-authorization-server")) {
        return json({
          issuer,
          authorization_endpoint: `${issuer}/oauth/authorize`,
          token_endpoint: `${issuer}/oauth/token`,
          userinfo_endpoint: `${issuer}/oauth/userinfo`,
          jwks_uri: `${issuer}/.well-known/jwks.json`,
        });
      }
      if (url.endsWith("/oauth/token")) {
        return json({
          access_token: "refreshed-access",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }
      if (url.endsWith("/oauth/userinfo")) {
        return json({
          sub: "user_1",
          name: "Alex",
          org_id: "org_1",
          org_name: "Coordy Team",
        });
      }
      return json({}, 404);
    }) as unknown as typeof fetch;
    const client = new ClerkOAuthClient(config, store, request, () => 1_000_000);
    await expect(client.restore()).resolves.toEqual({
      status: "signed-in",
      identity: { id: "user_1", name: "Alex", email: null, imageUrl: null },
      organization: { id: "org_1", name: "Coordy Team", imageUrl: null },
    });
    expect(store.save).toHaveBeenCalledOnce();
  });
});
