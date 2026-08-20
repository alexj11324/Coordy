import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { EncryptedOAuthTokenStore } from "../oauth-token-store";

const paths: string[] = [];

afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("encrypted OAuth token store", () => {
  it("never writes plaintext tokens and restores through the encryption boundary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "coordy-oauth-"));
    paths.push(directory);
    const file = join(directory, "session");
    const encryption = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(Buffer.from(value).map((byte) => byte ^ 0xaa)),
      decryptString: (value: Buffer) => Buffer.from(value).map((byte) => byte ^ 0xaa).toString(),
    };
    const store = new EncryptedOAuthTokenStore(file, encryption);
    const session = {
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      expiresAt: 123,
      identity: { id: "user_1", name: "Alex", email: null, imageUrl: null },
      organization: null,
    };
    await store.save(session);
    expect((await readFile(file)).toString()).not.toContain("access-secret");
    expect(await store.load()).toEqual(session);
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it("fails closed when OS encryption is unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "coordy-oauth-"));
    paths.push(directory);
    const store = new EncryptedOAuthTokenStore(join(directory, "session"), {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => "",
    });
    await expect(store.save({} as never)).rejects.toThrow("Secure operating-system credential storage");
    expect(await store.load()).toBeNull();
  });

  it("rejects a decrypted blob that is not a complete session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "coordy-oauth-"));
    paths.push(directory);
    const file = join(directory, "session");
    const encryption = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString(),
    };
    const store = new EncryptedOAuthTokenStore(file, encryption);
    await store.save({
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      expiresAt: 123,
      identity: { id: "user_1", name: "Alex", email: null, imageUrl: null },
      organization: null,
    });
    await writeFile(file, JSON.stringify({ accessToken: "only" }));
    expect(await store.load()).toBeNull();
  });
});
