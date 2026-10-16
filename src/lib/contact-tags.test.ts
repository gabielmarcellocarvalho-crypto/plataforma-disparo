import { describe, expect, it } from "vitest";
import { reuseExistingTags } from "@/lib/contact-tags";

describe("reuseExistingTags", () => {
  it("reaproveita a grafia da tag que o workspace já usa", () => {
    expect(reuseExistingTags(["socio", "Feira"], ["Sócio"])).toEqual(["Sócio", "Feira"]);
  });
  it("junta variações da mesma tag numa só", () => {
    expect(reuseExistingTags(["SÓCIO", "socio"], ["Sócio"])).toEqual(["Sócio"]);
  });
  it("tag nova fica como veio", () => {
    expect(reuseExistingTags(["Feira  2026"], [])).toEqual(["Feira 2026"]);
  });
});
