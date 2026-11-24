import { describe, expect, it } from "vitest";
import type { StudyItem } from "./api";
import { studyItemToSession } from "./study";

function item(overrides: Partial<StudyItem>): StudyItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    groupId: "22222222-2222-4222-8222-222222222222",
    groupName: "Property law",
    kind: "note",
    title: "Land law, Thursday",
    sourceKind: "lecture",
    authorName: "Ada",
    createdAt: Date.now(),
    canDelete: false,
    payload: {
      kind: "note",
      notes: {
        summary: "Dem talk about demurrage.",
        highlights: [],
        actions: [],
        sections: [],
        source: "browser",
      },
    },
    ...overrides,
  } as StudyItem;
}

describe("study item copies", () => {
  it("keeps a shared note as it was, with its original session shape", () => {
    const session = studyItemToSession(item({}));
    expect(session.kind).toBe("lecture");
    expect(session.title).toBe("Land law, Thursday");
    expect(session.notes?.summary).toBe("Dem talk about demurrage.");
    expect(session.durationSec).toBe(0);
    expect(session.hasAudio).toBe(false);
  });

  it("turns a quiz into readable questions with the answer marked", () => {
    const session = studyItemToSession(
      item({
        kind: "quiz",
        payload: {
          kind: "quiz",
          questions: [
            {
              question: "When does demurrage start?",
              options: ["After free days", "At the port gate", "On arrival", "At payment"],
              answer: 0,
              explanation: "The note says free days come first.",
            },
          ],
        },
      }),
    );
    const section = session.notes?.sections[0];
    expect(section?.heading).toContain("When does demurrage start?");
    expect(section?.bullets).toContain("A. After free days");
    expect(section?.bullets.at(-1)).toContain("Answer: A");
    expect(session.notes?.sections).toHaveLength(1);
  });

  it("turns a deck into prompt and answer pairs", () => {
    const session = studyItemToSession(
      item({
        kind: "cards",
        payload: {
          kind: "cards",
          cards: [{ front: "Wetin be demurrage?", back: "Money for staying too long." }],
        },
      }),
    );
    expect(session.notes?.sections[0].heading).toContain("Wetin be demurrage?");
    expect(session.notes?.sections[0].bullets[0]).toBe("Money for staying too long.");
  });
});
