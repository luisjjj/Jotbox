import { describe, expect, it } from "vitest";
import { stripLiveProfanity } from "./profanity";

describe("live caption profanity", () => {
  it("drops a misheard word and keeps the sentence", () => {
    expect(stripLiveProfanity("Fuck, that is the plan.")).toBe("that is the plan.");
  });

  it("drops a line that is only profanity", () => {
    expect(stripLiveProfanity("Fuck.")).toBe("");
    expect(stripLiveProfanity("shit, bitch")).toBe("");
  });

  it("leaves longer words alone", () => {
    expect(stripLiveProfanity("The Scunthorpe report")).toBe("The Scunthorpe report");
  });

  it("keeps Pidgin speech that is not profane", () => {
    expect(stripLiveProfanity("di match wey go hold for LUTH")).toBe("di match wey go hold for LUTH");
  });
});