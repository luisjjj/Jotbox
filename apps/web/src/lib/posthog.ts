import posthog from "posthog-js";

const key = import.meta.env.VITE_POSTHOG_KEY?.trim();
const host = import.meta.env.VITE_POSTHOG_HOST?.trim();

export const posthogEnabled = Boolean(key && host);

if (!key) {
  if (import.meta.env.DEV) {
    console.error(
      new Error(
        "VITE_POSTHOG_KEY variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_POSTHOG_KEY is configured",
      ),
    );
  }
} else if (!host) {
  if (import.meta.env.DEV) {
    console.error(
      new Error(
        "VITE_POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_POSTHOG_HOST is configured",
      ),
    );
  }
} else {
  posthog.init(key, {
    api_host: host,
    tracing_headers: [window.location.hostname],
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
    logs: {
      serviceName: "jotbox-web",
      environment: import.meta.env.MODE,
    },
  });
}

export default posthog;
