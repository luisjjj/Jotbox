import { useEffect, useState } from "react";
import { format, isToday, isTomorrow } from "date-fns";
import { ArrowRight, CalendarDays, Users, Video } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, type CalendarEvent, type CalendarFeed } from "@/lib/api";

function whenLabel(start: number) {
  const date = new Date(start);
  if (isToday(date)) return { day: "Today", time: format(date, "h:mm a") };
  if (isTomorrow(date)) return { day: "Tomorrow", time: format(date, "h:mm a") };
  return { day: format(date, "EEE d MMM"), time: format(date, "h:mm a") };
}

function detailFor(event: CalendarEvent) {
  if (event.allDay) return "All day";
  const minutes = Math.max(1, Math.round((event.end - event.start) / 60_000));
  const bits = [`${minutes} min`];
  if (event.attendees.length > 0) bits.push(`${event.attendees.length} ${event.attendees.length === 1 ? "guest" : "guests"}`);
  return bits.join(" · ");
}

export function UpcomingMeetings() {
  const [feed, setFeed] = useState<CalendarFeed | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    api
      .calendarUpcoming(7)
      .then((data) => {
        if (alive) setFeed(data);
      })
      .catch(() => {
        if (alive) setFeed(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!feed || !feed.connected) return null;

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-[16px] font-semibold tracking-[-0.02em] text-ink">
            <CalendarDays className="h-4 w-4 text-accent" />
            Next up
          </h2>
          <p className="mt-0.5 text-[13.5px] leading-5 text-muted">
            From your connected calendar, the next seven days.
          </p>
        </div>
        <span className="chip flex-none text-muted">{feed.events.length}</span>
      </div>

      {feed.events.length === 0 ? (
        feed.warnings.length > 0 ? (
          <p className="mt-3 rounded-xl border border-rec-line bg-rec-soft px-3.5 py-3 text-[13px] leading-5 text-soft">
            {feed.warnings.map((warning) => warning.message).join(" ")}
          </p>
        ) : (
          <p className="mt-3 rounded-xl border border-line bg-raised-2 px-3.5 py-3 text-[13.5px] text-muted">
            Nothing scheduled in the next seven days.
          </p>
        )
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {feed.events.slice(0, 4).map((event) => {
            const when = whenLabel(event.start);
            return (
              <li key={`${event.provider}-${event.id}`} className="flex flex-wrap items-start gap-x-3 gap-y-2 py-3 sm:flex-nowrap">
                <div className="w-[62px] flex-none sm:w-[72px]">
                  <p className="text-[12.5px] font-medium text-ink">{when.day}</p>
                  <p className="mt-0.5 text-[12px] text-faint">{event.allDay ? "All day" : when.time}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-medium text-ink">{event.title || "Untitled meeting"}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-faint">
                    {event.attendees.length > 0 && <Users className="h-3 w-3 flex-none" />}
                    {detailFor(event)}
                  </p>
                </div>
                <div className="flex w-full flex-none items-center justify-end gap-1.5 sm:w-auto">
                  {event.joinUrl && (
                    <a
                      href={event.joinUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="btn btn-line btn-sm"
                    >
                      <Video className="h-3.5 w-3.5" />
                      Join
                    </a>
                  )}
                  <button
                    type="button"
                    className="icon-btn h-7 w-7"
                    aria-label={`Start notes for ${event.title || "this meeting"}`}
                    title="Start notes"
                    onClick={() => {
                      const query = new URLSearchParams({
                        title: event.title || "Meeting",
                        kind: "meeting",
                      });
                      for (const attendee of event.attendees) query.append("guest", attendee);
                      navigate(`/listen?${query.toString()}`);
                    }}
                  >
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {feed.events.length > 0 && feed.warnings.length > 0 && (
        <p className="mt-2 text-[12px] leading-4 text-rec">
          {feed.warnings.map((warning) => warning.message).join(" ")}
        </p>
      )}
    </section>
  );
}
