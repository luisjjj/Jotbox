import type { Session } from "./types";

export const SAMPLE_MEETING_ID = "sample-meeting";
export const SAMPLE_LECTURE_ID = "sample-lecture";

export function sampleSessions(now = Date.now()): Session[] {
  const meeting: Session = {
    id: SAMPLE_MEETING_ID,
    title: "Payout review",
    kind: "meeting",
    createdAt: now - 1000 * 60 * 60 * 26,
    durationSec: 18 * 60 + 40,
    status: "ready",
    scratch: "14% of Friday still pending\nPause same-day promise\nAda: merchant note today",
    hasAudio: false,
    transcript: [
      {
        id: "m1",
        at: 42,
        speaker: "Ada",
        text: "About fourteen percent of Friday's card volume still has not settled. Merchants can see it as pending, so they think we failed.",
      },
      {
        id: "m2",
        at: 95,
        speaker: "Chinedu",
        text: "The file left on time. The bank acknowledged it late, and the window is closing nearer four than two.",
      },
      {
        id: "m3",
        at: 160,
        speaker: "You",
        text: "Then we should stop promising same-day until that cutoff holds. Support is carrying thirty-six chats that are really this.",
      },
      {
        id: "m4",
        at: 230,
        speaker: "Ada",
        text: "I will send the merchant note before four. Plain language, no internal words.",
      },
      {
        id: "m5",
        at: 280,
        speaker: "Chinedu",
        text: "I will re-pull the two failed batches and confirm they are not duplicates.",
      },
    ],
    notes: {
      source: "studio",
      summary:
        "Friday's card volume is still partly unsettled, and the bank window is missing the same-day promise. The group will pause that promise until the cutoff is reliable, and tell merchants what is actually happening today.",
      highlights: [
        "About 14% of Friday's card volume has not settled and shows as pending.",
        "The file went out on time. The bank acknowledged it late.",
        "Support is holding 36 chats that are a settlement problem.",
        "Same-day payout copy comes out until the cutoff holds.",
      ],
      actions: [
        { id: "a1", owner: "Ada", text: "Send the merchant note before 4pm, in plain language", done: false },
        { id: "a2", owner: "Chinedu", text: "Re-pull the two failed batches and confirm they are not duplicates", done: false },
        { id: "a3", owner: "Team", text: "Pause same-day payout promises until the cutoff holds", done: false },
      ],
      sections: [
        {
          heading: "What is broken",
          bullets: [
            "Merchants see pending and read it as a failure.",
            "The bank window is landing nearer 4pm than the promised 2pm.",
          ],
        },
        {
          heading: "What was decided",
          bullets: [
            "Same-day language comes out of the app until the window is trustworthy.",
            "Support gets a reply they can paste without explaining the batch system.",
          ],
        },
      ],
    },
  };

  const lecture: Session = {
    id: SAMPLE_LECTURE_ID,
    title: "Separation of powers",
    kind: "lecture",
    createdAt: now - 1000 * 60 * 60 * 5,
    durationSec: 46 * 60,
    status: "ready",
    scratch: "Not isolation. Restraint.\nWho makes the rule, who punishes the breach?",
    hasAudio: false,
    transcript: [
      {
        id: "l1",
        at: 80,
        speaker: "Lecturer",
        text: "Separation of powers is not a claim that the branches never touch. It is a claim about restraint.",
      },
      {
        id: "l2",
        at: 210,
        speaker: "Lecturer",
        text: "The useful test is simple. Who makes the rule, and who is allowed to judge a breach of it? If one body does both, the separation has already failed.",
      },
      {
        id: "l3",
        at: 540,
        speaker: "Lecturer",
        text: "A check that nobody can actually use is not a check. It is furniture. Look for the remedy, not the heading in the constitution.",
      },
      {
        id: "l4",
        at: 1500,
        speaker: "Lecturer",
        text: "Before Thursday, bring one case where a court declined a political question, and four lines on a check that failed in practice.",
      },
    ],
    notes: {
      source: "studio",
      summary:
        "The lecture treated separation of powers as restraint, not isolation. The working test is whether one body both makes a rule and judges a breach of it. A check that cannot be used is only furniture.",
      highlights: [
        "Separation is about restraint, not a wall between branches.",
        "Ask who makes the rule and who punishes the breach.",
        "A remedy that cannot be used is not a check.",
        "Next class needs one case on political questions, plus four lines on a failed check.",
      ],
      actions: [
        { id: "b1", owner: "You", text: "Bring one case where a court declined a political question", done: false },
        { id: "b2", owner: "You", text: "Write four lines on a check that failed in practice", done: false },
      ],
      sections: [
        {
          heading: "The test",
          bullets: [
            "Look past the diagram of three branches.",
            "If one body writes the rule and also punishes the breach, separation has failed.",
          ],
        },
        {
          heading: "What to look for in a case",
          bullets: [
            "Find the remedy, not the constitutional heading.",
            "A check that exists only on paper does not count.",
          ],
        },
      ],
    },
  };

  return [lecture, meeting];
}
