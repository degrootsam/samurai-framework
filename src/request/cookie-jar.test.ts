import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CookieJar,
  cookieHeaderOf,
  cookieMatches,
  parseSetCookie,
} from "./cookie-jar.js";

const NOW = Date.UTC(2030, 0, 1);
const url = (href: string) => new URL(href);

test("parseSetCookie reads name, value and the attributes", () => {
  const cookie = parseSetCookie(
    "sid=abc=1; Path=/app; Secure; HttpOnly; SameSite=strict; Max-Age=60",
    url("https://shop.test/app/login"),
    NOW,
  );
  assert.deepEqual(cookie, {
    name: "sid",
    value: "abc=1",
    domain: "shop.test",
    hostOnly: true,
    path: "/app",
    secure: true,
    httpOnly: true,
    sameSite: "Strict",
    expires: NOW / 1000 + 60,
  });
});

test("parseSetCookie: Max-Age wins over Expires, and a Domain makes it a domain cookie", () => {
  const cookie = parseSetCookie(
    "a=1; Domain=.Shop.Test; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Max-Age=0",
    url("https://www.shop.test/x/y"),
    NOW,
  );
  assert.equal(cookie?.domain, "shop.test");
  assert.equal(cookie?.hostOnly, false);
  assert.equal(cookie?.expires, 0);
  assert.equal(cookie?.path, "/x");
});

test("parseSetCookie refuses a header without a name and a Domain the host is not under", () => {
  assert.equal(parseSetCookie("novalue", url("http://a.test/")), undefined);
  assert.equal(parseSetCookie("=x", url("http://a.test/")), undefined);
  assert.equal(
    parseSetCookie("a=1; Domain=other.test", url("http://a.test/")),
    undefined,
  );
});

test("cookieMatches checks host, path, Secure and expiry", () => {
  const host = parseSetCookie("a=1; Path=/api", url("http://x.test/"), NOW)!;
  assert.ok(cookieMatches(host, url("http://x.test/api"), NOW));
  assert.ok(cookieMatches(host, url("http://x.test/api/users"), NOW));
  assert.ok(!cookieMatches(host, url("http://x.test/apix"), NOW));
  assert.ok(!cookieMatches(host, url("http://sub.x.test/api"), NOW));
  const domain = parseSetCookie(
    "a=1; Domain=x.test",
    url("http://x.test/"),
    NOW,
  )!;
  assert.ok(cookieMatches(domain, url("http://sub.x.test/"), NOW));
  assert.ok(!cookieMatches(domain, url("http://notx.test/"), NOW));
  const secure = parseSetCookie("a=1; Secure", url("https://x.test/"), NOW)!;
  assert.ok(cookieMatches(secure, url("https://x.test/"), NOW));
  assert.ok(!cookieMatches(secure, url("http://x.test/"), NOW));
  const local = parseSetCookie("a=1; Secure", url("https://localhost/"), NOW)!;
  assert.ok(cookieMatches(local, url("http://localhost:3000/"), NOW));
  const short = parseSetCookie("a=1; Max-Age=10", url("http://x.test/"), NOW)!;
  assert.ok(cookieMatches(short, url("http://x.test/"), NOW + 5000));
  assert.ok(!cookieMatches(short, url("http://x.test/"), NOW + 10_000));
});

test("cookieHeaderOf sends the longest path first", () => {
  const at = (path: string, name: string) =>
    parseSetCookie(`${name}=1; Path=${path}`, url("http://x.test/"))!;
  assert.equal(
    cookieHeaderOf([at("/", "root"), at("/a/b", "deep"), at("/a", "mid")]),
    "deep=1; mid=1; root=1",
  );
  assert.equal(cookieHeaderOf([]), undefined);
});

test("a jar stores the Set-Cookie list, replaces by name/domain/path and drops a deleted cookie", async () => {
  const jar = new CookieJar();
  const here = url("http://x.test/login");
  await jar.store(here, ["a=1", "b=2; Path=/other", "c=3; HttpOnly"]);
  assert.equal(await jar.cookieHeader(here), "a=1; c=3");
  await jar.store(here, ["a=changed", "c=3; Max-Age=0"]);
  assert.equal(await jar.cookieHeader(here), "a=changed");
  assert.equal(
    await jar.cookieHeader(url("http://x.test/other/x")),
    "b=2; a=changed",
  );
});

test("a jar seeded from a storage state lists the same cookies back", async () => {
  const jar = new CookieJar([
    {
      name: "s",
      value: "1",
      domain: ".x.test",
      path: "/",
      sameSite: "None",
      secure: true,
    },
    { name: "h", value: "2", domain: "x.test", expires: 4_000_000_000 },
  ]);
  assert.equal(await jar.cookieHeader(url("https://sub.x.test/")), "s=1");
  assert.equal(await jar.cookieHeader(url("https://x.test/")), "s=1; h=2");
  const listed = await jar.list();
  assert.deepEqual(
    listed.map(({ name, domain, expires, sameSite }) => ({
      name,
      domain,
      expires,
      sameSite,
    })),
    [
      { name: "s", domain: ".x.test", expires: -1, sameSite: "None" },
      { name: "h", domain: "x.test", expires: 4_000_000_000, sameSite: "Lax" },
    ],
  );
});
