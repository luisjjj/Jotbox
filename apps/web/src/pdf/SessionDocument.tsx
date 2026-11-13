import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { format } from "date-fns";
import { formatClock } from "@/lib/format";
import type { Session, SessionKind } from "@/lib/types";

const KIND_LABEL: Record<SessionKind, string> = {
  meeting: "Meeting",
  seminar: "Seminar",
  lecture: "Lecture",
  voice: "Voice note",
};

const color = {
  accent: "#16483a",
  accentInk: "#f5f1e4",
  accentSoft: "#cfe0d5",
  brass: "#8b6b38",
  ink: "#1b1d1a",
  soft: "#343934",
  faint: "#91978f",
  line: "#e6e4dc",
  cream: "#faf8f2",
};

const styles = StyleSheet.create({
  page: { backgroundColor: "#ffffff", paddingBottom: 68, fontFamily: "Helvetica", color: color.ink },
  hero: { backgroundColor: color.accent, paddingHorizontal: 44, paddingTop: 32, paddingBottom: 26 },
  brandRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brandLeft: { flexDirection: "row", alignItems: "center" },
  mark: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: color.accentInk,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 8,
    marginRight: 9,
  },
  bar: { width: 4, borderRadius: 2, backgroundColor: color.accent, marginHorizontal: 1.1 },
  brand: { color: color.accentInk, fontSize: 14, fontFamily: "Helvetica-Bold", letterSpacing: 0.3 },
  kicker: { color: color.accentSoft, fontSize: 7.5, letterSpacing: 1.8, textTransform: "uppercase" },
  title: {
    color: color.accentInk,
    fontFamily: "Times-Roman",
    fontSize: 25,
    lineHeight: 1.16,
    marginTop: 24,
    maxWidth: 440,
  },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 13 },
  meta: { color: color.accentSoft, fontSize: 9 },
  metaDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: "#7fa08f", marginHorizontal: 8 },
  heroRule: { width: 44, height: 2, backgroundColor: "#c9a96c", marginTop: 20 },
  body: { paddingHorizontal: 44, paddingTop: 28 },
  label: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: color.brass,
    marginTop: 20,
    marginBottom: 7,
  },
  firstLabel: { marginTop: 0 },
  summary: { fontSize: 11.5, lineHeight: 1.62, color: color.soft },
  emptyNotes: { fontSize: 10.5, lineHeight: 1.55, color: color.faint },
  bulletRow: { flexDirection: "row", marginBottom: 6 },
  bullet: { width: 3.5, height: 3.5, borderRadius: 2, backgroundColor: color.brass, marginTop: 5, marginRight: 8 },
  bulletText: { flex: 1, fontSize: 10.5, lineHeight: 1.55, color: color.soft },
  action: {
    borderBottomWidth: 0.75,
    borderBottomColor: color.line,
    paddingVertical: 8,
    flexDirection: "row",
  },
  check: {
    width: 9,
    height: 9,
    borderWidth: 1,
    borderColor: "#b9b5a8",
    borderRadius: 2,
    marginTop: 2,
    marginRight: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  checkDone: { backgroundColor: color.accent, borderColor: color.accent },
  checkInner: { width: 3, height: 3, borderRadius: 1, backgroundColor: color.accentInk },
  actionText: { fontSize: 10.5, lineHeight: 1.45, color: color.soft },
  actionDone: { color: color.faint, textDecoration: "line-through" },
  lastAction: { borderBottomWidth: 0 },
  owner: {
    fontSize: 7,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: color.brass,
    marginTop: 3,
    fontFamily: "Helvetica-Bold",
  },
  sectionHeading: { fontFamily: "Helvetica-Bold", fontSize: 11.5, color: color.ink, marginTop: 16, marginBottom: 5 },
  note: {
    marginTop: 20,
    padding: 12,
    backgroundColor: color.cream,
    borderWidth: 0.75,
    borderColor: color.line,
    borderRadius: 3,
  },
  noteText: { fontFamily: "Times-Roman", fontSize: 10.5, lineHeight: 1.6, color: color.soft },
  transcriptLine: { flexDirection: "row", marginBottom: 7 },
  time: { width: 38, fontSize: 8, color: color.faint },
  speaker: { fontFamily: "Helvetica-Bold", color: color.ink, fontSize: 9.5 },
  lineText: { flex: 1, fontSize: 9.5, lineHeight: 1.5, color: color.soft },
  closing: {
    marginTop: 24,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: color.line,
    fontSize: 7.5,
    lineHeight: 1.5,
    color: color.faint,
    letterSpacing: 0.2,
  },
  footer: { position: "absolute", left: 44, right: 44, bottom: 24 },
  footerRule: { height: 0.75, backgroundColor: color.line, marginBottom: 7 },
  footerRow: { flexDirection: "row", justifyContent: "space-between" },
  footerText: { fontSize: 7.5, color: color.faint, letterSpacing: 0.4 },
});

function Mark() {
  return (
    <View style={styles.mark}>
      <View style={[styles.bar, { height: 10, opacity: 0.55 }]} />
      <View style={[styles.bar, { height: 17 }]} />
      <View style={[styles.bar, { height: 13, opacity: 0.9 }]} />
      <View style={[styles.bar, { height: 7, opacity: 0.55 }]} />
    </View>
  );
}

function Label({ children, first = false }: { children: string; first?: boolean }) {
  return <Text style={first ? [styles.label, styles.firstLabel] : styles.label}>{children}</Text>;
}

export function SessionDocument({ session }: { session: Session }) {
  const notes = session.notes;
  const date = format(session.createdAt, "EEEE, d MMMM yyyy · HH:mm");
  const kind = KIND_LABEL[session.kind] ?? "Meeting";
  const hasNotes = Boolean(notes && (notes.summary.trim() || notes.highlights.length || notes.actions.length || notes.sections.length));
  let firstBlock = true;
  const takeFirst = () => {
    const value = firstBlock;
    firstBlock = false;
    return value;
  };

  const jottings = session.scratch.trim() ? (
    <View style={styles.note} wrap={false}>
      <Label first>What you jotted</Label>
      <Text style={styles.noteText}>{session.scratch.trim()}</Text>
    </View>
  ) : null;

  const source =
    session.transcript.length > 0 ? (
      <View break>
        <Label first>The source</Label>
        {jottings}
        <Label>Spoken words</Label>
        {session.transcript.map((line) => (
          <View key={line.id} style={styles.transcriptLine} wrap={false}>
            <Text style={styles.time}>{formatClock(line.at)}</Text>
            <Text style={styles.lineText}>
              {line.speaker ? <Text style={styles.speaker}>{line.speaker}  </Text> : null}
              {line.text}
            </Text>
          </View>
        ))}
      </View>
    ) : (
      jottings
    );

  return (
    <Document
      title={`${session.title} · JotBox`}
      author="JotBox"
      subject={`${kind} notes`}
      creator="JotBox"
      producer="JotBox"
      keywords="JotBox, notes, meeting, summary"
    >
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.hero}>
          <View style={styles.brandRow}>
            <View style={styles.brandLeft}>
              <Mark />
              <Text style={styles.brand}>JotBox</Text>
            </View>
            <Text style={styles.kicker}>{kind} notes</Text>
          </View>
          <Text style={styles.title}>{session.title}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>{date}</Text>
            {session.durationSec > 0 && (
              <>
                <View style={styles.metaDot} />
                <Text style={styles.meta}>{formatClock(session.durationSec)}</Text>
              </>
            )}
            {notes && (
              <>
                <View style={styles.metaDot} />
                <Text style={styles.meta}>{notes.source === "studio" ? "Written from the room" : "Quick notes"}</Text>
              </>
            )}
          </View>
          <View style={styles.heroRule} />
        </View>

        <View style={styles.body}>
          {hasNotes && notes ? (
            <>
              <Label first={takeFirst()}>Summary</Label>
              <Text style={styles.summary}>{notes.summary}</Text>

              {notes.highlights.length > 0 && (
                <>
                  <Label first={takeFirst()}>Key points</Label>
                  {notes.highlights.map((highlight) => (
                    <View key={highlight} style={styles.bulletRow} wrap={false}>
                      <View style={styles.bullet} />
                      <Text style={styles.bulletText}>{highlight}</Text>
                    </View>
                  ))}
                </>
              )}

              {notes.actions.length > 0 && (
                <>
                  <Label first={takeFirst()}>Action items</Label>
                  {notes.actions.map((action, index) => (
                    <View
                      key={action.id || `${action.owner}-${index}`}
                      style={index === notes.actions.length - 1 ? [styles.action, styles.lastAction] : styles.action}
                      wrap={false}
                    >
                      <View style={action.done ? [styles.check, styles.checkDone] : styles.check}>
                        {action.done ? <View style={styles.checkInner} /> : null}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={action.done ? [styles.actionText, styles.actionDone] : styles.actionText}>{action.text}</Text>
                        <Text style={styles.owner}>{action.owner || "Unassigned"}</Text>
                      </View>
                    </View>
                  ))}
                </>
              )}

              {notes.sections.map((section) => (
                <View key={section.heading} wrap={false}>
                  <Text style={styles.sectionHeading}>{section.heading}</Text>
                  {section.bullets.map((bullet) => (
                    <View key={bullet} style={styles.bulletRow}>
                      <View style={styles.bullet} />
                      <Text style={styles.bulletText}>{bullet}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </>
          ) : (
            <>
              <Label first={takeFirst()}>Notes</Label>
              <Text style={styles.emptyNotes}>
                No written summary for this session yet. What was said and what you jotted are below.
              </Text>
            </>
          )}

          {source}

          <Text style={styles.closing}>
            MADE WITH JOTBOX · Notes are a summary of what was said, not a word-for-word record. Check names, numbers
            and owners before sharing.
          </Text>
        </View>

        <View style={styles.footer} fixed>
          <View style={styles.footerRule} />
          <View style={styles.footerRow}>
            <Text style={styles.footerText}>JotBox · the notes are written while you listen</Text>
            <Text
              style={styles.footerText}
              render={({ pageNumber, totalPages }) => `${pageNumber} of ${totalPages}`}
            />
          </View>
        </View>
      </Page>
    </Document>
  );
}
