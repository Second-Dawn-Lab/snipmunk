import { describe, expect, it } from "vitest";
import { findMatches } from "./pii";
import { findCards, findIbans, isCardLoose, repairIban } from "./sensitive";

describe("recognition mistakes in card numbers", () => {
  it("finds a card read with letters for digits, and the checksum still decides", () => {
    for (const read of ["4111 1111 1111 1111", "4lll 1111 1111 1111", "4111 1111 1111 111l", "4I11 1111 llll 1111", "5500 0000 0000 0O04", "4111-1111-1111-1111"]) {
      expect(isCardLoose(read), read).toBe(true);
    }
    expect(findCards("Card: 4lll 1111 1111 1111 ok").map((m) => m.text)).toEqual(["4lll 1111 1111 1111"]);
  });
  it("a repaired number that fails Luhn, or words with few digits, are not cards", () => {
    for (const read of ["4lll 1111 1111 1112", "OOOO BBBB SSSS IIII", "Bill Boss Sloss Ill", "1234567890123", "4111 1111 1111 1111 1"]) {
      expect(isCardLoose(read), read).toBe(false);
    }
    expect(findCards("Bill Sloss Boss Ill Sol Oslo B")).toEqual([]);
  });
});

describe("recognition mistakes in IBANs", () => {
  it("finds an IBAN with O for 0 and l for 1 in its digit groups", () => {
    for (const read of ["DE89 3704 OO44 0532 0130 OO", "DE89 37O4 0044 0532 013O 00", "DE89370400440532O13OOO", "DE89 3704 0044 0532 0130 00", "DE89 37Ø4 ØØ44 0532 013Ø ØØ"]) {
      expect(findIbans(`IBAN ${read} end`).map((m) => m.text), read).toEqual([read]);
    }
    expect(repairIban("DE89 3704 OO44 0532 0130 OO")).toBe("DE89 3704 0044 0532 0130 00");
  });
  it("keeps real letters in the account part (GB82 WEST ...)", () => {
    expect(findIbans("GB82 WEST 1234 5698 7654 32").map((m) => m.text)).toEqual(["GB82 WEST 1234 5698 7654 32"]);
    expect(findIbans("GB82 WEST 1234 5698 7654 3Z")).toEqual([]);
  });
  it("a repair that does not give a valid checksum is no IBAN", () => {
    expect(findIbans("DE89 3704 OO44 0532 0130 O1")).toEqual([]);
    expect(findIbans("DE89 3704 0044 0532 0130 01")).toEqual([]);
  });
  it("both kinds are found by findMatches with the other lines left alone", () => {
    const text = "Card: 4lll 1111 1111 1111 IBAN DE89 3704 OO44 0532 0130 OO Order 1234567890123";
    const kinds = findMatches(text, { email: true, phone: true, card: true, iban: true }).map((m) => m.kind);
    expect(kinds).toEqual(["card", "iban"]);
  });
});
