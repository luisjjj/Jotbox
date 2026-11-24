import { useEffect, type ReactNode } from "react";
import { ArrowLeft, ArrowUp } from "lucide-react";
import { Link } from "react-router-dom";
import { Brand } from "@/components/Brand";

const UPDATED = "16 November 2026";
const CONTACT = "hello@jotbox.online";

type Section = { id: string; title: string; body: ReactNode };

function DocLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="font-medium text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
    >
      {children}
    </Link>
  );
}

function MailLink() {
  return (
    <a
      href={`mailto:${CONTACT}`}
      className="font-medium text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
    >
      {CONTACT}
    </a>
  );
}

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2.5 text-[15px] leading-7 text-soft">
          <span className="mt-[11px] h-1.5 w-1.5 flex-none rounded-full bg-accent/70" aria-hidden="true" />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function LegalLayout({
  title,
  subtitle,
  sections,
  current,
}: {
  title: string;
  subtitle: string;
  sections: Section[];
  current: "privacy" | "terms" | "refunds";
}) {
  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = `${title} · JotBox`;
  }, [title]);

  const legalLinks = [
    { to: "/privacy", label: "Privacy Policy", key: "privacy" },
    { to: "/terms", label: "Terms and Conditions", key: "terms" },
    { to: "/refunds", label: "Cancellation and Refund Policy", key: "refunds" },
  ];

  return (
    <div id="top" className="min-h-dvh bg-paper">
      <header className="border-b border-line bg-raised">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <Brand />
          <Link to="/" className="btn btn-ghost btn-sm">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back home
          </Link>
        </div>
      </header>

      <main className="page-enter mx-auto max-w-[1120px] px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <div className="max-w-[760px]">
          <p className="kicker">Legal</p>
          <h1 className="mt-2 text-[32px] font-semibold leading-[1.1] tracking-[-0.045em] text-ink sm:text-[40px]">
            {title}
          </h1>
          <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-muted">{subtitle}</p>
          <p className="mt-2 text-[13px] leading-5 text-faint">
            Last updated {UPDATED}. This document covers jotbox.online, the JotBox Windows desktop app, and the JotBox API.
          </p>
        </div>

        <div className="mt-9 grid gap-9 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-14">
          <nav aria-label="On this page" className="hidden lg:block">
            <div className="sticky top-8">
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-faint">On this page</p>
              <ul className="mt-3 space-y-2 border-l border-line">
                {sections.map((section, index) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="block border-l-2 border-transparent py-0.5 pl-3 text-[13px] leading-5 text-muted transition-colors hover:border-accent hover:text-ink"
                    >
                      {index + 1}. {section.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>

          <article className="min-w-0 max-w-[760px]">
            {sections.map((section, index) => (
              <section
                key={section.id}
                id={section.id}
                className="scroll-mt-24 border-t border-line py-7 first:border-t-0 first:pt-0"
              >
                <h2 className="text-[20px] font-semibold leading-7 tracking-[-0.02em] text-ink">
                  {index + 1}. {section.title}
                </h2>
                <div className="mt-3 space-y-3.5 [&_h3]:pt-1 [&_h3]:text-[14px] [&_h3]:font-semibold [&_h3]:text-ink">
                  {section.body}
                </div>
              </section>
            ))}

            <footer className="mt-4 border-t border-line pt-7">
              <p className="text-[14px] leading-6 text-soft">
                Questions about this document? Email <MailLink />. We aim to reply within five business days.
              </p>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[13px] font-medium text-muted">
                {legalLinks
                  .filter((link) => link.key !== current)
                  .map((link) => (
                    <Link key={link.key} to={link.to} className="transition-colors hover:text-ink">
                      {link.label}
                    </Link>
                  ))}
                <a href="#top" className="inline-flex items-center gap-1 transition-colors hover:text-ink">
                  <ArrowUp className="h-3 w-3" />
                  Back to top
                </a>
              </div>
              <p className="mt-6 text-[12px] leading-5 text-faint">
                © {new Date().getFullYear()} JotBox. Recordings stay on your device. Notes follow you when you sign in.
              </p>
            </footer>
          </article>
        </div>
      </main>
    </div>
  );
}

const privacySections: Section[] = [
  {
    id: "who-we-are",
    title: "Who we are",
    body: (
      <>
        <p className="text-[15px] leading-7 text-soft">
          JotBox is a listening and note-taking tool for meetings, lectures, seminars, and voice notes. In this policy,
          "JotBox", "we", "us", and "our" mean the JotBox service and the people who operate it. You can reach us at{" "}
          <MailLink />.
        </p>
        <p className="text-[15px] leading-7 text-soft">
          JotBox is operated from Nigeria. If you use JotBox through an organisation workspace, that organisation may
          also control some of the content in the workspace.
        </p>
      </>
    ),
  },
  {
    id: "the-short-version",
    title: "The short version",
    body: (
      <Bullets
        items={[
          "Your recording stays on the device that made it. We do not store the audio file on JotBox servers.",
          "To turn speech into text, the audio is sent to the speech provider configured for your JotBox service. The provider processes it and returns text. JotBox does not keep the audio after processing.",
          "Your transcript, notes, jottings, participant names, and session details sync to your JotBox account when you are signed in.",
          "We do not sell your content. We do not use your recordings or notes to train AI models.",
          "You can delete sessions in the app. To delete your account and the data we hold on the server, email us.",
        ]}
      />
    ),
  },
  {
    id: "what-we-collect",
    title: "What we collect",
    body: (
      <>
        <h3>Account details</h3>
        <p className="text-[15px] leading-7 text-soft">
          Your name, email address, a password hash made with scrypt, and the date your account was created. We never
          store your password in plain text.
        </p>
        <h3>Capture content</h3>
        <p className="text-[15px] leading-7 text-soft">
          The title, type, duration, timestamps, transcript, notes, jottings, live insights, and participant names you
          add to a session. When you are signed in, this content is stored in our Postgres database so it can follow you
          to another device.
        </p>
        <h3>Recordings</h3>
        <p className="text-[15px] leading-7 text-soft">
          Audio is stored in your browser's IndexedDB on your device. It is not written to the JotBox database. When you
          transcribe, retranscribe, or create notes, the audio or its text is sent to the AI provider configured for the
          service. File names, blobs, and temporary processing copies are not kept by JotBox after the request finishes.
        </p>
        <h3>Payments</h3>
        <p className="text-[15px] leading-7 text-soft">
          Paystack handles card data. We receive a customer code, subscription code, plan, amount, currency, status,
          paid period dates, and transaction references. We never see your full card number or CVV.
        </p>
        <h3>Usage and limits</h3>
        <p className="text-[15px] leading-7 text-soft">
          The seconds you record each month, the number of captures, share links created, and your plan status. We use
          this to apply the free plan limit and to stop abuse.
        </p>
        <h3>Organisation data</h3>
        <p className="text-[15px] leading-7 text-soft">
          If you join an organisation workspace, we record your membership, role, the visibility of each capture, any
          grants you create, and audit events such as membership changes and access changes.
        </p>
        <h3>Technical and analytics data</h3>
        <p className="text-[15px] leading-7 text-soft">
          Basic request logs such as IP address, browser type, timestamps, and error details, which we need to run and
          secure the service. We also use Vercel Analytics for aggregate page views. We do not use advertising cookies
          or sell analytics data.
        </p>
      </>
    ),
  },
  {
    id: "cookies-and-local-storage",
    title: "Cookies and local storage",
    body: (
      <>
        <p className="text-[15px] leading-7 text-soft">
          JotBox uses one essential session cookie to keep you signed in. It is HttpOnly, so page scripts cannot read it,
          and it is not used for advertising.
        </p>
        <p className="text-[15px] leading-7 text-soft">
          Your browser also keeps settings in local storage and audio in IndexedDB. The Windows app keeps equivalent
          local files. Clearing site data, removing the app's local data, or signing out removes the copy on that
          device. It does not remove notes already synced to your account.
        </p>
      </>
    ),
  },
  {
    id: "why-we-use-it",
    title: "Why we use it",
    body: (
      <Bullets
        items={[
          "To provide the service: sign you in, transcribe audio, write notes, sync your content, and open share links.",
          "To process payments, manage subscriptions, and prevent duplicate or fraudulent charges.",
          "To keep the service secure, rate-limit abuse, and diagnose errors.",
          "To send service messages about your account, payments, or material changes to these documents.",
          "To meet legal, tax, accounting, and regulatory obligations.",
          "With your consent, where the law requires consent for a particular use, such as recording a conversation.",
        ]}
      />
    ),
  },
  {
    id: "ai-and-providers",
    title: "AI processing and service providers",
    body: (
      <>
        <p className="text-[15px] leading-7 text-soft">
          We use other companies to run JotBox. They receive only what they need for their part of the service:
        </p>
        <Bullets
          items={[
            "Speech and language providers such as Groq, xAI, or OpenRouter, or a self-hosted Speaches worker, for transcription, notes, answers, and meeting briefs.",
            "Paystack for checkout, subscription billing, and payment verification.",
            "Neon for the Postgres database that stores accounts and synced notes.",
            "Vercel for hosting the web app and API, and for aggregate analytics.",
          ]}
        />
        <p className="text-[15px] leading-7 text-soft">
          These providers may process data outside Nigeria. Where required, we rely on appropriate safeguards for those
          transfers. Their own privacy terms also apply to the data they process for us.
        </p>
        <p className="text-[15px] leading-7 text-soft">
          AI providers receive audio or text only to return a transcript, notes, an answer, or a brief. We do not send
          your content to advertisers or data brokers. If you use a self-hosted JotBox deployment, the operator of that
          deployment chooses which providers to connect.
        </p>
      </>
    ),
  },
  {
    id: "sharing-and-visibility",
    title: "Sharing and visibility",
    body: (
      <>
        <p className="text-[15px] leading-7 text-soft">
          Nothing is public by default. A capture is visible to you and, inside an organisation workspace, to the people
          whose role and the capture's visibility allow it. Confidential captures are meant to stay with their owner and
          explicit grants.
        </p>
        <p className="text-[15px] leading-7 text-soft">
          A share link is public to anyone who has it until the link expires or is revoked. It shows the notes and
          transcript, not the audio or your private jottings. Treat a share link like a key.
        </p>
        <p className="text-[15px] leading-7 text-soft">
          We may disclose data if the law requires it, if we need to protect the rights, safety, or property of JotBox or
          others, or as part of a merger or transfer of the service. We will tell you about a transfer unless the law
          prevents it.
        </p>
      </>
    ),
  },
  {
    id: "retention",
    title: "How long we keep it",
    body: (
      <>
        <Bullets
          items={[
            "Audio stays on your device until you delete the session, clear local data, or your chosen retention window removes it. The default is to keep it until you delete it.",
            "Transcripts, notes, jottings, and session details stay in your account until you delete the session or ask us to delete your account.",
            "Share links stop working when they expire, when you revoke them, or when the capture is deleted.",
            "Billing records are kept for as long as tax, accounting, and legal rules require.",
            "Organisation audit events are kept so workspace owners can review access and membership changes.",
            "Deleted data may remain in encrypted backups for a limited period before those backups rotate.",
          ]}
        />
        <p className="text-[15px] leading-7 text-soft">
          Retention windows set by an organisation control what appears in organisation memory. They do not delete the
          underlying capture unless its owner deletes it.
        </p>
      </>
    ),
  },
  {
    id: "security",
    title: "Security",
    body: (
      <p className="text-[15px] leading-7 text-soft">
        Data moves over TLS. Passwords are hashed with scrypt. Session cookies are HttpOnly. The database uses a
        least-privilege application role. Paystack webhooks are checked with an HMAC signature, and rate limits are
        stored in the database. No system is perfectly secure. If you find a vulnerability, email <MailLink /> before
        sharing it publicly.
      </p>
    ),
  },
  {
    id: "your-rights",
    title: "Your rights",
    body: (
      <>
        <p className="text-[15px] leading-7 text-soft">
          Under the Nigeria Data Protection Act 2023, and other laws that may apply to you, you can ask to access,
          correct, delete, or receive a copy of your personal data. You can also object to or restrict some processing,
          and withdraw consent where consent is the basis for processing.
        </p>
        <p className="text-[15px] leading-7 text-soft">
          Email <MailLink /> to make a request. We may need to verify your identity first. We aim to respond within 30
          days. If your content sits in an organisation workspace, contact the workspace owner as well, because they may
          control that copy.
        </p>
        <p className="text-[15px] leading-7 text-soft">
          You can complain to the Nigeria Data Protection Commission. You can also complain to your local data protection
          authority if you are outside Nigeria.
        </p>
      </>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: (
      <p className="text-[15px] leading-7 text-soft">
        JotBox is for people aged 18 and over. We do not knowingly collect personal data from children. If you believe a
        child has created an account, email <MailLink /> and we will remove it.
      </p>
    ),
  },
  {
    id: "recording-responsibly",
    title: "Recording responsibly",
    body: (
      <>
        <p className="text-[15px] leading-7 text-soft">
          Recording laws differ by country and by situation. You are responsible for getting any consent or notice that
          the law requires before you record a conversation, lecture, or call, and for respecting confidentiality
          obligations that apply to you.
        </p>
        <p className="text-[15px] leading-7 text-soft">
          JotBox includes an in-room listening notice and private jottings to help you be clear about what is being
          captured. Do not use JotBox for hidden surveillance or where recording is prohibited.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p className="text-[15px] leading-7 text-soft">
        We will update this page when our practices change. The date at the top shows the latest version. If a change
        materially affects how we use your content, we will notify you by email or in the app before it takes effect.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p className="text-[15px] leading-7 text-soft">
        Privacy questions, data requests, and security reports: <MailLink />. We aim to reply within five business days.
      </p>
    ),
  },
];

const termsSections: Section[] = [
  {
    id: "agreement",
    title: "Agreement to these terms",
    body: (
      <p className="text-[15px] leading-7 text-soft">
        These Terms and Conditions are an agreement between you and JotBox. By creating an account, downloading the
        desktop app, or using the service, you agree to them. If you do not agree, do not use JotBox.
      </p>
    ),
  },
  {
    id: "eligibility",
    title: "Who can use JotBox",
    body: (
      <p className="text-[15px] leading-7 text-soft">
        You must be at least 18 years old and able to enter a binding contract. If you use JotBox for a company,
        school, or other organisation, you confirm that you have authority to accept these terms for that organisation.
      </p>
    ),
  },
  {
    id: "accounts",
    title: "Your account",
    body: (
      <Bullets
        items={[
          "Give accurate account details and keep them up to date.",
          "Keep your password private. You are responsible for activity under your account.",
          "Tell us promptly if you think someone else has access to your account.",
          "Do not share one account between several people. Each person needs their own account.",
          "We may suspend an account that is compromised, abusive, or used to break these terms.",
        ]}
      />
    ),
  },
  {
    id: "your-content",
    title: "Your content",
    body: (
      <>
        <p className="text-[15px] leading-7 text-soft">
          You keep ownership of the recordings, transcripts, notes, jottings, and other content you create. You give
          JotBox a limited licence to host, process, transmit, display, and copy that content only as needed to run the
          service for you.
        </p>
        <p className="text-[15px] leading-7 text-soft">
          That licence includes sending audio or text to the AI providers configured for the service, syncing content to
          your account, showing content to organisation members according to the visibility you or a workspace admin
          choose, and opening share links you create. It ends when the content is deleted, except for copies in backups
          that have not yet rotated and records we must keep by law.
        </p>
        <p className="text-[15px] leading-7 text-soft">
          We do not use your content to train AI models. You confirm that you have the rights and consents needed to
          record and upload the content you give us.
        </p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    body: (
      <>
        <p className="text-[15px] leading-7 text-soft">You agree not to use JotBox to:</p>
        <Bullets
          items={[
            "Record people where recording is illegal, or without a notice or consent the law requires.",
            "Break confidentiality, privacy, or intellectual property rights.",
            "Harass, threaten, defame, or discriminate against anyone.",
            "Upload malware, attempt to gain unauthorised access, or probe the service for vulnerabilities.",
            "Scrape, copy, resell, or provide JotBox to third parties as your own product.",
            "Bypass usage limits, share quotas, paywalls, or security controls.",
            "Create accounts in bulk, impersonate someone, or misrepresent your affiliation.",
            "Use output as the only basis for a medical, legal, financial, or safety decision about a person.",
          ]}
        />
        <p className="text-[15px] leading-7 text-soft">
          We may remove content or suspend access if we reasonably believe you have broken these rules or the law.
        </p>
      </>
    ),
  },
  {
    id: "ai-output",
    title: "AI output is a draft",
    body: (
      <>
        <p className="text-[15px] leading-7 text-soft">
          Transcription, notes, summaries, answers, and meeting briefs are produced by automated systems. They can miss
          words, mishear names, mix up speakers, invent details, or get numbers and owners wrong.
        </p>
        <p className="text-[15px] leading-7 text-soft">
          Check important facts before you act on them. JotBox output is not legal, medical, financial, or other
          professional advice, and it is not a substitute for a human review of the record.
        </p>
      </>
    ),
  },
  {
    id: "plans-and-payment",
    title: "Plans, payment, and renewal",
    body: (
      <>
        <p className="text-[15px] leading-7 text-soft">
          The free plan has a listening limit. Starter Pro and Power User are monthly subscriptions that renew
          automatically until you cancel. Prices are shown in US dollars, and paid plans are charged in Naira at
          checkout through Paystack because the Paystack plan is set in Naira.
        </p>
        <p className="text-[15px] leading-7 text-soft">
          By starting a subscription, you authorise recurring monthly charges to your chosen payment method until you
          cancel. You are responsible for any taxes that apply. If a renewal fails, Paystack may retry and your paid plan
          may stay on briefly while the payment is resolved.
        </p>
        <p className="text-[15px] leading-7 text-soft">
          Cancellation and refunds are covered by the <DocLink to="/refunds">Cancellation and Refund Policy</DocLink>.
          If we change a paid plan price, we will give reasonable notice. A subscription that is already running keeps
          the price it was charged until it ends or you start a new subscription.
        </p>
      </>
    ),
  },
  {
    id: "free-plan",
    title: "Free plan and fair use",
    body: (
      <p className="text-[15px] leading-7 text-soft">
        The free plan includes 100 minutes of listening for the life of the account by default, one live share link
        per session for seven days, and the features shown on the pricing page. Limits are enforced on the server. Do
        not create extra accounts or manipulate recordings to get around a limit. We may adjust free plan limits with
        notice.
      </p>
    ),
  },
  {
    id: "organisations",
    title: "Organisation workspaces",
    body: (
      <p className="text-[15px] leading-7 text-soft">
        If you join an organisation workspace, its owners and admins can manage membership, roles, visibility, retention
        settings, and access grants. Content you mark as visible to the department or organisation can be read by other
        members, and access changes are recorded in an audit trail. When you leave or are removed, content that belongs
        to the workspace may stay with the workspace.
      </p>
    ),
  },
  {
    id: "share-links",
    title: "Share links",
    body: (
      <p className="text-[15px] leading-7 text-soft">
        You control the share links you create. Anyone with a live link can read the notes and transcript until the link
        expires or you revoke it. Do not share links to content you are not allowed to disclose. We are not responsible
        for what a recipient does with a link you chose to create.
      </p>
    ),
  },
  {
    id: "availability",
    title: "Availability and changes",
    body: (
      <p className="text-[15px] leading-7 text-soft">
        We work to keep JotBox available, but we do not promise uninterrupted service. We may perform maintenance,
        change features, or retire parts of the service. If we make a material change that reduces what you paid for, we
        will give reasonable notice and, where appropriate, a remedy.
      </p>
    ),
  },
  {
    id: "suspension",
    title: "Suspension and termination",
    body: (
      <>
        <p className="text-[15px] leading-7 text-soft">
          You can stop using JotBox at any time and cancel a subscription from the account page. We may suspend or end
          access if you break these terms, fail to pay, create risk for other people, or if the law requires it.
        </p>
        <p className="text-[15px] leading-7 text-soft">
          To delete your account and the data we hold on the server, email <MailLink />. Some records may be kept for
          legal, tax, or security reasons, and local files remain on your device until you remove them.
        </p>
      </>
    ),
  },
  {
    id: "third-parties",
    title: "Third-party services",
    body: (
      <p className="text-[15px] leading-7 text-soft">
        JotBox depends on services such as Paystack, Neon, Vercel, and AI providers. Their terms and privacy policies
        also apply to their part of the service. We are not responsible for a third party's separate acts, but we choose
        our providers carefully and will tell you about a material change.
      </p>
    ),
  },
  {
    id: "disclaimers",
    title: "Disclaimers",
    body: (
      <p className="text-[15px] leading-7 text-soft">
        To the extent the law allows, JotBox is provided "as is" and "as available". We do not promise that transcripts
        or notes are accurate, complete, or fit for a particular purpose. Nothing in these terms excludes a warranty or
        right that Nigerian law does not allow us to exclude.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Limitation of liability",
    body: (
      <>
        <p className="text-[15px] leading-7 text-soft">
          To the extent the law allows, JotBox is not liable for indirect, incidental, special, or consequential loss,
          or for lost profits, lost opportunities, or lost data that you did not back up.
        </p>
        <p className="text-[15px] leading-7 text-soft">
          Our total liability for a claim connected to the service will not exceed the amount you paid JotBox in the 12
          months before the event, or NGN 50,000 if you are on the free plan. Nothing here limits liability for fraud,
          wilful misconduct, death, or personal injury caused by negligence, or any other liability that cannot be
          limited by law.
        </p>
      </>
    ),
  },
  {
    id: "indemnity",
    title: "Indemnity",
    body: (
      <p className="text-[15px] leading-7 text-soft">
        If your content, your recording, or your use of JotBox breaks the law or a third party's rights, you agree to
        cover the reasonable costs of a claim that results, to the extent the law allows.
      </p>
    ),
  },
  {
    id: "law",
    title: "Governing law and disputes",
    body: (
      <>
        <p className="text-[15px] leading-7 text-soft">
          These terms are governed by the laws of the Federal Republic of Nigeria. Before starting a formal claim, email{" "}
          <MailLink /> with the details and give us 30 days to try to resolve it.
        </p>
        <p className="text-[15px] leading-7 text-soft">
          If we cannot resolve it, the courts of Nigeria have jurisdiction, unless a law that protects you as a consumer
          gives you the right to go elsewhere.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes to these terms",
    body: (
      <p className="text-[15px] leading-7 text-soft">
        We may update these terms as the service changes. The date at the top shows the latest version. If a change is
        material, we will notify you by email or in the app. Continuing to use JotBox after the change means you accept
        the updated terms.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p className="text-[15px] leading-7 text-soft">
        Questions about these terms: <MailLink />. We aim to reply within five business days.
      </p>
    ),
  },
];

const refundSections: Section[] = [
  {
    id: "the-short-version",
    title: "The short version",
    body: (
      <Bullets
        items={[
          "Starter Pro and Power User are monthly subscriptions. You can cancel at any time from the account page.",
          "When you cancel, you keep your paid plan until the end of the period you already paid for. It does not renew.",
          "Monthly fees are not refunded for unused time, a change of mind, or forgetting to cancel.",
          "We will refund a duplicate charge, a charge made after a confirmed cancellation, or an unauthorised charge, and we honour refunds required by Nigerian law.",
        ]}
      />
    ),
  },
  {
    id: "how-billing-works",
    title: "How billing works",
    body: (
      <>
        <p className="text-[15px] leading-7 text-soft">
          Paid plans are charged in Naira through Paystack. The site shows the US dollar equivalent, but the amount
          that leaves your account is the Naira price at checkout. Each successful charge pays for the next month of
          your plan.
        </p>
        <p className="text-[15px] leading-7 text-soft">
          Your subscription renews automatically each month until you cancel. Paystack processes the payment and may
          retry a failed renewal. JotBox does not store your card number.
        </p>
      </>
    ),
  },
  {
    id: "how-to-cancel",
    title: "How to cancel",
    body: (
      <>
        <p className="text-[15px] leading-7 text-soft">
          Open <DocLink to="/account">Account</DocLink>, find your plan card, and choose <strong>Cancel renewal</strong>.
          Confirm the prompt. We call Paystack to disable the subscription and show you the date your paid access ends.
        </p>
        <p className="text-[15px] leading-7 text-soft">
          If you cannot sign in, email <MailLink /> from the address on the account and ask us to cancel it. Include the
          Paystack reference or the date of your last payment if you have it. Keep the confirmation we send.
        </p>
        <p className="text-[15px] leading-7 text-soft">
          Cancelling stops future charges. It does not erase your notes. Your account returns to the free plan when the
          paid period ends.
        </p>
      </>
    ),
  },
  {
    id: "after-cancelling",
    title: "What happens after you cancel",
    body: (
      <Bullets
        items={[
          "You keep paid plan features until the end of the current paid period, with no further charges after that.",
          "At the end of the period, the free plan limits apply again, including the listening allowance and share link limits.",
          "Your notes, transcripts, and jottings stay in your account. Free plan limits do not delete existing content.",
          "Share links you already created stay live until their expiry date unless you revoke them. New links follow the free plan limits.",
          "Audio files remain on your device and follow your audio retention setting.",
        ]}
      />
    ),
  },
  {
    id: "refunds",
    title: "When we refund",
    body: (
      <>
        <p className="text-[15px] leading-7 text-soft">
          Monthly fees are generally non-refundable once charged. That includes unused days, months where you did not use
          JotBox, and renewals you forgot to cancel. Paid access is available for the whole period you paid for, so a
          partial month is not refunded when you cancel.
        </p>
        <p className="text-[15px] leading-7 text-soft">We will refund a charge when:</p>
        <Bullets
          items={[
            "The same period was charged twice, including a duplicate checkout or a retried payment.",
            "You cancelled and received confirmation, but a later charge was still made.",
            "The charge was not authorised by you, and we can verify that with Paystack.",
            "A refund is required by the Federal Competition and Consumer Protection Act, the Nigeria Data Protection Act, or another law that applies to you.",
          ]}
        />
        <p className="text-[15px] leading-7 text-soft">
          We review every request in good faith. If a refund is not due under this policy, we will explain why.
        </p>
      </>
    ),
  },
  {
    id: "how-to-request",
    title: "How to request a refund",
    body: (
      <>
        <p className="text-[15px] leading-7 text-soft">
          Email <MailLink /> within 30 days of the charge. Include:
        </p>
        <Bullets
          items={[
            "The email address on your JotBox account.",
            "The Paystack reference or transaction date.",
            "The amount and the reason for the request.",
          ]}
        />
        <p className="text-[15px] leading-7 text-soft">
          We aim to reply within five business days. We may ask for information needed to confirm the payment. Never send
          your full card number or CVV by email.
        </p>
      </>
    ),
  },
  {
    id: "refund-timing",
    title: "How refunds are paid",
    body: (
      <p className="text-[15px] leading-7 text-soft">
        Approved refunds go back through Paystack to the original payment method, in Naira. We do not charge a refund
        fee. Paystack and your bank usually take 5 to 10 business days to complete a refund, and some banks take longer.
        We will confirm when we have sent the refund, but we cannot control your bank's timing.
      </p>
    ),
  },
  {
    id: "failed-payments",
    title: "Failed renewals",
    body: (
      <p className="text-[15px] leading-7 text-soft">
        If a renewal fails, Paystack may retry the charge. Your paid plan may stay on for a short grace period while
        that happens. If the payment cannot be completed, paid access ends and the account returns to the free plan. We
        do not charge a fee for a failed renewal, and we do not refund a period that was not paid for.
      </p>
    ),
  },
  {
    id: "chargebacks",
    title: "Chargebacks and disputes",
    body: (
      <p className="text-[15px] leading-7 text-soft">
        Please email us before asking your bank or card issuer to reverse a charge. Most problems are quicker to fix
        directly. If a chargeback is opened, your paid plan may be suspended while the bank reviews it. If the bank
        finds the charge was valid, we may ask you to settle the amount and any chargeback fee before paid access is
        restored.
      </p>
    ),
  },
  {
    id: "price-changes",
    title: "Price changes",
    body: (
      <p className="text-[15px] leading-7 text-soft">
        If we change a paid plan price, we will give reasonable notice. A subscription that is already running keeps
        the price it was charged until it ends. The new price applies if you start a new subscription after the change.
      </p>
    ),
  },
  {
    id: "statutory-rights",
    title: "Your statutory rights",
    body: (
      <p className="text-[15px] leading-7 text-soft">
        Nothing in this policy limits a refund or remedy that Nigerian consumer law gives you and that we cannot
        exclude. If you are outside Nigeria, a mandatory consumer law in your country may also apply.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p className="text-[15px] leading-7 text-soft">
        Billing questions, cancellations, and refund requests: <MailLink />. We aim to reply within five business days.
      </p>
    ),
  },
];

export function PrivacyPolicy() {
  return (
    <LegalLayout
      title="Privacy Policy"
      subtitle="What JotBox collects, where your recordings live, who processes your content, and how to get it deleted."
      sections={privacySections}
      current="privacy"
    />
  );
}

export function TermsAndConditions() {
  return (
    <LegalLayout
      title="Terms and Conditions"
      subtitle="The rules for using JotBox, what you own, what you can expect, and how subscriptions work."
      sections={termsSections}
      current="terms"
    />
  );
}

export function RefundPolicy() {
  return (
    <LegalLayout
      title="Cancellation and Refund Policy"
      subtitle="How to stop a plan renewal, when you keep access, and when a charge can be refunded."
      sections={refundSections}
      current="refunds"
    />
  );
}
