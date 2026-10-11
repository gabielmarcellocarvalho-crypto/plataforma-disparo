import { describe, expect, it } from "vitest";
import { assertPublicHttpUrl, isBlockedIp, UnsafeUrlError } from "@/lib/safe-fetch";

describe("isBlockedIp", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.10",
    "169.254.169.254", // metadados de nuvem
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.5",
  ])("bloqueia %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "191.252.10.5", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "libera público %s",
    (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    }
  );

  it("não deixa passar algo que não é IP", () => {
    expect(isBlockedIp("não-é-ip")).toBe(true);
  });
});

describe("assertPublicHttpUrl", () => {
  it.each([
    "http://localhost/x",
    "http://127.0.0.1/x",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/x",
    "http://10.0.0.1:8080/",
    "ftp://exemplo.com/x",
    "file:///etc/passwd",
    "https://user:senha@exemplo.com/",
    "http://servico.internal/x",
    "isso não é url",
  ])("recusa %s", async (u) => {
    await expect(assertPublicHttpUrl(u)).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("aceita IP público literal", async () => {
    await expect(assertPublicHttpUrl("https://8.8.8.8/x")).resolves.toBeInstanceOf(URL);
  });
});
