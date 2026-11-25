import { describe, expect, it } from "vitest";
import { findEmails, findMatches } from "./pii";
import { findIbans, isIban } from "./sensitive";

// Made-up values: their check digits are wrong, as in test data and as after one wrongly recognized digit.
describe("what stands after a label", () => {
  const all = { email: true, phone: false, card: true, iban: true, secret: true };

  it("covers an IBAN after its label also when the check digits are wrong", () => {
    for (const value of ["DE89-1111-2222-3333-4444-55", "DE89111122223333444455", "DE89 1111 2222 3333 4444 55", "GB29 WEST 6016 1331 9268 11", "DE89 1111 2222 3333 4444 5"]) {
      expect(isIban(value), value).toBe(false);
      for (const line of [`IBAN: ${value}`, `Iban: ${value}`, `IBAN ${value}`, `1BAN: ${value}`]) expect(findIbans(line).map((m) => m.text), line).toEqual([value]);
    }
  });

  it("stops at the end of the number", () => {
    expect(findIbans("IBAN: DE89 1111 2222 3333 4444 55 Bank: Example").map((m) => m.text)).toEqual(["DE89 1111 2222 3333 4444 55"]);
    expect(findIbans("IBAN: DE89111122223333444455 BIC EXAMPLEXXX").map((m) => m.text)).toEqual(["DE89111122223333444455"]);
  });

  it("takes no words after the label", () => {
    for (const line of ["IBAN: see the next page", "IBAN: DE00 1111", "IBAN: please enter your number 12", "IBANs are long"]) expect(findIbans(line), line).toEqual([]);
    expect(findIbans("DE89 1111 2222 3333 4444 55")).toEqual([]);
  });

  it("covers what looks like an address after its label, however the signs were read", () => {
    for (const [line, value] of [
      ["email : k@example.com", "k@example.com"],
      ["E-Mail: k©example.com", "k©example.com"],
      ["email: kQexample.com", "kQexample.com"],
      ["email : k@examplecom", "k@examplecom"],
      ["Email = k @ example . com", "k @ example . com"],
      ["mail: <k@example.com>", "k@example.com"],
    ] as const) {
      expect(findEmails(line).map((m) => m.text), line).toEqual([value]);
    }
  });

  it("takes no ordinary words after the label", () => {
    for (const line of ["Email: please see below.", "Mail: setup.exe", "Email: ••••••", "e-mail: none"]) expect(findEmails(line), line).toEqual([]);
  });

  it("still finds one thing once", () => {
    expect(findMatches("IBAN: DE89 3704 0044 0532 0130 00 email: k@example.com password: abc", all).map((m) => m.kind)).toEqual(["iban", "email", "secret"]);
  });
});
