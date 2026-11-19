import { describe, expect, it } from "vitest";
import { findMatches } from "./pii";
import { findCards, findCustom, findIbans, findSecrets, ibanChecksum, isCard, isIban, luhn } from "./sensitive";

describe("credit cards", () => {
  it("accepts numbers that pass the Luhn check, with spaces or dashes", () => {
    for (const n of ["4111 1111 1111 1111", "4111-1111-1111-1111", "4111111111111111", "5500 0000 0000 0004", "3782 822463 10005", "6011 1111 1111 1117"]) {
      expect(isCard(n), n).toBe(true);
    }
  });
  it("rejects numbers that fail Luhn, have the wrong length or are not card-shaped", () => {
    for (const n of ["4111 1111 1111 1112", "1234567890123", "2024-03-12", "12345678901", "0000 0000 0000 0000", "4111  1111 1111 1111", "4111 1111 1111 1111 1111 1"]) {
      expect(isCard(n), n).toBe(false);
    }
    expect(luhn("79927398713")).toBe(true);
  });
  it("finds a card inside a line and not an order number next to it", () => {
    const text = "Card 4111 1111 1111 1111 order 1234567890123 exp 12/27";
    expect(findCards(text).map((m) => m.text)).toEqual(["4111 1111 1111 1111"]);
  });
  it("does not cut a longer number or a word-attached number", () => {
    expect(findCards("A4111111111111111")).toEqual([]);
    expect(findCards("41111111111111111111")).toEqual([]);
  });
});

describe("IBAN", () => {
  const good = ["DE89 3704 0044 0532 0130 00", "DE89370400440532013000", "GB82 WEST 1234 5698 7654 32", "FR14 2004 1010 0505 0001 3M02 606", "NL91 ABNA 0417 1643 00", "AT61 1904 3002 3457 3201"];
  it("accepts correct IBANs with and without spaces", () => {
    for (const n of good) expect(isIban(n), n).toBe(true);
    expect(ibanChecksum("DE89370400440532013000")).toBe(true);
  });
  it("rejects wrong check digits, wrong length and unknown countries", () => {
    for (const n of ["DE89 3704 0044 0532 0130 01", "DE89 3704 0044 0532 0130", "XX89 3704 0044 0532 0130 00", "DE00 3704 0044 0532 0130 00"]) {
      expect(isIban(n), n).toBe(false);
    }
  });
  it("finds the IBAN in a line and stops at its end", () => {
    const text = "IBAN: DE89 3704 0044 0532 0130 00 Bank: Example";
    const [m] = findIbans(text);
    expect(m.text).toBe("DE89 3704 0044 0532 0130 00");
    expect(text.slice(m.start, m.end)).toBe(m.text);
    expect(findIbans("IBAN DE89370400440532013000")[0].text).toBe("DE89370400440532013000");
  });
  it("ignores look-alikes: ids, product codes, a wrong checksum", () => {
    expect(findIbans("Ref DE12 ABC")).toEqual([]);
    expect(findIbans("DE89 3704 0044 0532 0130 01")).toEqual([]);
    expect(findIbans("ADE89370400440532013000")).toEqual([]);
  });
});

describe("passwords and secrets", () => {
  const cases: [string, string][] = [
    ["Password: hunter2", "hunter2"],
    ["password=Tr0ub4dor&3", "Tr0ub4dor&3"],
    ["Passwort: Geheim123!", "Geheim123!"],
    ["Kennwort : abc", "abc"],
    ["PIN: 4821", "4821"],
    ["PW: x9", "x9"],
    ["API key: sk-live-123abc", "sk-live-123abc"],
    ["api_key = AKIA123", "AKIA123"],
    ["Token: eyJhbGci", "eyJhbGci"],
    ["Access key: AKIAIOSFODNN7", "AKIAIOSFODNN7"],
    ["Secret: s3cr3t", "s3cr3t"],
    ["Contraseña: miClave1", "miClave1"],
    ["Mot de passe : Azerty12", "Azerty12"],
    ["Şifre: 12ab34", "12ab34"],
    ["Parola: pass99", "pass99"],
    ["Wachtwoord: Welkom01", "Welkom01"],
    ["Hasło: tajne1", "tajne1"],
    ["密码：abc123", "abc123"],
    ["密碼: abc123", "abc123"],
    ["كلمة المرور: 12345", "12345"],
    ["پاسورڈ: abcd12", "abcd12"],
    ['Password: "quoted1"', "quoted1"],
  ];
  it.each(cases)("finds only the value in %s", (text, value) => {
    const [m] = findSecrets(text);
    expect(m?.text).toBe(value);
    expect(text.slice(m.start, m.end)).toBe(value);
  });
  it("leaves the label alone and needs a separator", () => {
    expect(findSecrets("Password")).toEqual([]);
    expect(findSecrets("Passwords are stored hashed")).toEqual([]);
    expect(findSecrets("Token expires in 5 min")).toEqual([]);
    expect(findSecrets("Reset your password: ")).toEqual([]);
    expect(findSecrets("mypassword: abc")).toEqual([]);
  });
});

describe("custom words", () => {
  it("matches case-insensitively, also inside words unless whole-word is on", () => {
    expect(findCustom("Project Falcon and falconry", { words: ["falcon"], wholeWord: false }).map((m) => m.text)).toEqual(["Falcon", "falcon"]);
    expect(findCustom("Project Falcon and falconry", { words: ["falcon"], wholeWord: true }).map((m) => m.text)).toEqual(["Falcon"]);
  });
  it("escapes special characters and ignores empty entries", () => {
    expect(findCustom("a+b (x) a+b", { words: ["a+b", "  ", ""], wholeWord: false })).toHaveLength(2);
    expect(findCustom("Zoë", { words: ["zoë"], wholeWord: true })).toHaveLength(1);
  });
});

describe("findMatches with every type", () => {
  const all = { email: true, phone: true, card: true, iban: true, secret: true, custom: { words: ["Falcon"], wholeWord: true } };
  it("finds each kind once and in text order", () => {
    const text = "a@b.de 4111 1111 1111 1111 DE89 3704 0044 0532 0130 00 Password: hunter2 Falcon";
    expect(findMatches(text, all).map((m) => m.kind)).toEqual(["email", "card", "iban", "secret", "custom"]);
  });
  it("a card is not also a phone number, a secret value is not an email twice", () => {
    expect(findMatches("4111 1111 1111 1111", all).map((m) => m.kind)).toEqual(["card"]);
    expect(findMatches("Password: me@x.de", all).map((m) => m.kind)).toEqual(["secret"]);
  });
  it("finds nothing in dates, times, prices, versions and numbers that fail Luhn", () => {
    for (const text of ["12.03.2024 14:30:15", "Total $1,299.00", "Version 2.4.1", "Order 1234567890123", "ID 20240312143000", "Order no. 4111 1111 1111 1112", "IP 192.168.1.100", "2024-03-12", "1.2.3.4", "3.14159"]) {
      expect(findMatches(text, all), text).toEqual([]);
    }
  });
  it("kinds that are switched off are not found", () => {
    expect(findMatches("4111 1111 1111 1111 Password: x", { email: true, phone: true })).toEqual([]);
  });
});

describe("quick redact options from the settings", () => {
  it("takes the kinds and the custom words, and knows when nothing is chosen", async () => {
    const { optionsFromSettings, anythingChosen } = await import("./quickRedact");
    const { defaultSettings } = await import("../settings/defaults");
    const all = optionsFromSettings(defaultSettings);
    expect(all).toMatchObject({ email: true, phone: true, card: true, iban: true, secret: true });
    // The custom switch is on by default, but an empty list covers nothing.
    expect(all.custom).toEqual({ words: [], wholeWord: true });
    expect(anythingChosen(all)).toBe(true);
    const none = optionsFromSettings({ ...defaultSettings, quickRedactEmail: false, quickRedactPhone: false, quickRedactCard: false, quickRedactIban: false, quickRedactSecret: false });
    expect(anythingChosen(none)).toBe(false);
    expect(anythingChosen(optionsFromSettings({ ...defaultSettings, quickRedactEmail: false, quickRedactPhone: false, quickRedactCard: false, quickRedactIban: false, quickRedactSecret: false, quickRedactWords: ["x"] }))).toBe(true);
  });
});
