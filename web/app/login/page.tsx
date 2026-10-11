"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getDatabase, ref, get } from "firebase/database";
import { auth } from "../../lib/firebase";
import { useRouter } from "next/navigation";

type Role = "student" | "advisor";

type CourseState = "taken" | "in-progress" | "available" | "locked";

const COURSE_STYLES: Record<CourseState, { box: string; icon: string }> = {
  taken: {
    box: "border-[1.5px] border-border-default bg-surface-card shadow-note",
    icon: "/login/icon-taken.svg",
  },
  "in-progress": {
    box: "border-[2.5px] border-ink-primary bg-surface-card shadow-note",
    icon: "/login/icon-in-progress.svg",
  },
  available: {
    box: "border-[2.5px] border-brand-gold bg-brand-gold-soft shadow-note-lifted",
    icon: "/login/icon-available.svg",
  },
  locked: {
    box: "border-[1.5px] border-dashed border-ink-secondary bg-surface-sunken",
    icon: "/login/icon-locked.svg",
  },
};

function CourseNode({
  code,
  title,
  status,
  state,
  grade,
  credits = "3 cr",
}: {
  code: string;
  title: string;
  status: string;
  state: CourseState;
  grade?: string;
  credits?: string;
}) {
  const locked = state === "locked";
  const tone = locked ? "text-ink-secondary" : "text-ink-primary";

  return (
    <div className={`flex h-[108px] w-[208px] flex-col justify-between rounded-card px-4 py-[14px] ${COURSE_STYLES[state].box}`}>
      <div className="flex items-center justify-between whitespace-nowrap">
        <p className={`text-label-16 ${tone}`}>{code}</p>
        <p className={`text-caption-12-regular ${locked ? "text-ink-secondary" : "text-ink-muted"}`}>{credits}</p>
      </div>
      <p className="truncate text-body-13 text-ink-secondary">{title}</p>
      <div className="flex min-h-[30px] items-center justify-between pt-1.5">
        <div className="flex items-center gap-1.5">
          <Image src={COURSE_STYLES[state].icon} alt="" width={18} height={18} />
          <p className={`whitespace-nowrap text-caption-12 ${tone}`}>{status}</p>
        </div>
        {grade && (
          <span className="rounded-pill bg-ink-primary px-[9px] py-0.5 text-caption-12 text-surface-card">{grade}</span>
        )}
      </div>
    </div>
  );
}

function StickyNote({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <div className={`flex size-[124px] flex-col items-center justify-center whitespace-nowrap rounded-md border border-border-subtle px-3 text-center text-label-14 text-ink-primary shadow-note ${tone}`}>
      {children}
    </div>
  );
}

// Decorative layer. Each side gutter is a box that is 360 x 960 in the Figma frame; pieces and
// connector lines are placed inside it by percentage, so they keep their arrangement and stay
// linked as the box follows the viewport. At 1440 x 1024 the box is exactly 360 x 960.
//   --art-h      box height: the visible body, capped at the design height
//   --art-inset  extra clearance from the content column on viewports narrower than 1440px
//   --art-w      box width: the gutter minus the inset, capped at the design width
//   --art-p      piece scale: 1 at the design size, smaller when the box is shorter or narrower,
//                so the lowest piece stays above the bottom edge and cards stay off the column
const ART_VARS = {
  "--art-h": "min(960px, calc(100vh - 64px))",
  "--art-inset": "clamp(0px, calc((1440px - 100vw) * 0.2), 28px)",
  "--art-w": "min(360px, calc(50vw - 360px - var(--art-inset)))",
  "--art-p":
    "min(1, tan(atan2(calc(var(--art-h) * 0.097 - 8px), 65px)), tan(atan2(calc(var(--art-w) * 0.309 + 8px), 108px)))",
} as React.CSSProperties;

const ART_BOX =
  "absolute top-0 h-(--art-h) w-(--art-w) tall:top-1/2 tall:-translate-y-1/2 max-[1100px]:hidden [@media(max-height:479px)]:hidden";
const ART_PIECE = "absolute -translate-x-1/2 -translate-y-1/2 scale-(--art-p)";

function BackgroundArt() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-clip" style={ART_VARS} aria-hidden="true">
      <div className="absolute left-1/2 top-0 h-[960px] w-[1440px] -translate-x-1/2 tall:top-1/2 tall:-translate-y-1/2">
        <div className="absolute left-[260.16px] top-[70px] flex h-[517.67px] w-[713.421px] items-center justify-center">
          <div className="flex-none rotate-8">
            <div className="relative h-[430px] w-[660px]">
              <div className="absolute inset-[-32.56%_-21.21%]">
                <Image src="/login/soft-gold-shape-1.svg" alt="" fill />
              </div>
            </div>
          </div>
        </div>
        <div className="absolute left-[820px] top-[444.36px] flex h-[467.335px] w-[528.954px] items-center justify-center">
          <div className="flex-none -rotate-12">
            <div className="relative h-[380px] w-[460px]">
              <div className="absolute inset-[-36.84%_-30.43%]">
                <Image src="/login/soft-gold-shape-2.svg" alt="" fill />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Left gutter */}
      <div className={`${ART_BOX} right-[calc(50%+360px+var(--art-inset))]`}>
        <div className="absolute left-[30.364%] top-[19.167%] h-[69.792%] w-[45.722%]">
          <div className="absolute inset-[-0.15%_-0.61%]">
            <Image src="/login/doodle-line-left.svg" alt="" fill />
          </div>
        </div>
        <div className={`${ART_PIECE} left-[32.877%] top-[44.705%]`}>
          <div className="rotate-5">
            <StickyNote tone="bg-brand-gold-soft">
              <p>grad by</p>
              <p>spring &rsquo;29?</p>
            </StickyNote>
          </div>
        </div>
        <div className={`${ART_PIECE} left-[49.493%] top-[88.492%]`}>
          <div className="-rotate-4">
            <StickyNote tone="bg-surface-card">
              <p>summer</p>
              <p>classes?</p>
            </StickyNote>
          </div>
        </div>
        <div className={`${ART_PIECE} left-[55.299%] top-[18.004%]`}>
          <div className="-rotate-6">
            <CourseNode code="COP 3502" title="Computer Science I" status="Taken" state="taken" grade="A-" />
          </div>
        </div>
        <div className={`${ART_PIECE} left-[69.139%] top-[64.881%]`}>
          <div className="rotate-5">
            <CourseNode code="COP 3503" title="Computer Science II" status="In progress" state="in-progress" />
          </div>
        </div>
      </div>

      {/* Right gutter */}
      <div className={`${ART_BOX} left-[calc(50%+360px+var(--art-inset))]`}>
        <div className="absolute left-[27.622%] top-[23.333%] h-[66.667%] w-[37.509%]">
          <div className="absolute inset-[-0.16%_-0.74%]">
            <Image src="/login/doodle-line-right.svg" alt="" fill />
          </div>
        </div>
        <div className={`${ART_PIECE} left-[60.88%] top-[47.746%]`}>
          <div className="-rotate-5">
            <StickyNote tone="bg-surface-card">
              <p>ask advisor</p>
              <p>about COT 4210</p>
            </StickyNote>
          </div>
        </div>
        <div className={`${ART_PIECE} left-[44.631%] top-[90.329%]`}>
          <div className="rotate-3">
            <StickyNote tone="bg-brand-gold">
              <p>Foundation</p>
              <p>Exam &#10003;</p>
            </StickyNote>
          </div>
        </div>
        <div className={`${ART_PIECE} left-[41.051%] top-[24.435%]`}>
          <div className="rotate-6">
            <CourseNode code="CIS 3360" title="Security in Computing" status="Available now" state="available" />
          </div>
        </div>
        <div className={`${ART_PIECE} left-[32.643%] top-[67.356%]`}>
          <div className="-rotate-4">
            <CourseNode code="COP 4331" title="OO Software Development" status="Needs COP 3503" state="locked" />
          </div>
        </div>
      </div>
    </div>
  );
}

function RoleCard({
  selected,
  onClick,
  disabled,
  icon,
  title,
  sub,
}: {
  selected: boolean;
  onClick: () => void;
  disabled: boolean;
  icon: string;
  title: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      disabled={disabled}
      className={`flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-[14px] rounded-role-card px-[22px] pb-[22px] pt-5 text-left short:gap-2 short:pb-[14px] short:pt-[14px] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:hover:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-primary ${
        selected
          ? "border-3 border-brand-gold bg-brand-gold-soft shadow-note-lifted"
          : "border-[1.5px] border-border-default bg-surface-card shadow-note hover:border-ink-muted"
      }`}
    >
      <span className="flex w-full items-center justify-between">
        <Image src={icon} alt="" width={44} height={44} />
        {selected ? (
          <span className="flex items-center gap-[5px] rounded-pill bg-ink-primary py-1 pl-2 pr-3">
            <Image src="/login/check.svg" alt="" width={16} height={16} />
            <span className="text-caption-12 text-surface-card">Selected</span>
          </span>
        ) : (
          <Image src="/login/radio-empty.svg" alt="" width={24} height={24} />
        )}
      </span>
      <span className="flex w-full flex-col gap-1">
        <span className="text-title-18 text-ink-primary">{title}</span>
        <span className="text-body-14 text-ink-secondary">{sub}</span>
      </span>
    </button>
  );
}

const PRIMARY_BUTTON =
  "w-full cursor-pointer rounded-pill bg-ink-primary px-[22px] py-3 text-label-14 text-surface-card transition-colors hover:bg-brand-gold hover:text-ink-on-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-primary disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-ink-primary disabled:hover:text-surface-card";

const INPUT =
  "w-full disabled:cursor-not-allowed disabled:opacity-70 rounded-field border-[1.5px] border-ink-muted bg-surface-card px-[14px] py-3 text-body-14 text-ink-primary outline-none transition-shadow placeholder:text-ink-muted focus:border-brand-gold focus:ring-4 focus:ring-brand-gold/25";

// Error message inside the panel. No error colour exists in the tokens, so the state is
// carried by the badge, border and wording.
function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex w-full items-center gap-2.5 rounded-row border-[1.5px] border-ink-primary bg-surface-sunken py-[10px] pl-3 pr-[14px] text-body-13 text-ink-primary"
    >
      <span className="flex size-[18px] flex-none items-center justify-center rounded-pill bg-ink-primary text-caption-12 text-surface-card">!</span>
      <span>{children}</span>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();

  const [role, setRole] = useState<Role>("student");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function selectRole(nextRole: Role) {
    if (loading) return;

    setRole(nextRole);
    setError("");
    setPassword("");
  }

  async function handleLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (loading) return;

    setError("");
    setLoading(true);

    const selectedRole = role;
    let authenticated = false;

    try {
      const credential = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );

      authenticated = true;

      const db = getDatabase(
        auth.app,
        "https://tasseltrak-69d99-default-rtdb.firebaseio.com"
      );

      const snapshot = await get(
        ref(db, `users/${credential.user.uid}/role`)
      );

      const savedRole = snapshot.val();

      if (savedRole !== "student" && savedRole !== "advisor") {
        await signOut(auth);
        setPassword("");
        setError(
          "Your account does not have a valid role assigned. Please contact the administrator."
        );
        return;
      }

      if (savedRole !== selectedRole) {
        await signOut(auth);
        setPassword("");

        setError(
          savedRole === "student"
            ? 'Your account is a student account. Select "I’m a student".'
            : 'Your account is an advisor account. Select "I’m an advisor".'
        );

        return;
      }

      router.replace(
        savedRole === "advisor" ? "/advisor" : "/dashboard"
      );
    } catch (err: unknown) {
      // No console.error here: Next.js dev mode opens its error overlay on it.
      if (authenticated) {
        await signOut(auth).catch(console.error);
        setPassword("");
        setError(
          "We could not verify your account role. Please try again or contact the administrator."
        );
      } else {
        const code =
          typeof err === "object" &&
            err !== null &&
            "code" in err
            ? String(err.code)
            : "";

        switch (code) {
          case "auth/invalid-email":
            setError("Please enter a valid email address.");
            break;

          case "auth/invalid-credential":
          case "auth/user-not-found":
          case "auth/wrong-password":
            setError(
              "Incorrect email or password. Please try again."
            );
            break;

          case "auth/user-disabled":
            setError(
              "Your account has been disabled. Please contact the administrator."
            );
            break;

          case "auth/too-many-requests":
            setError(
              "Too many login attempts. Please try again later."
            );
            break;

          case "auth/network-request-failed":
            setError(
              "Connection error. Please check your internet connection and try again."
            );
            break;

          default:
            setError("Unable to sign in. Please try again.");
        }
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-1 flex-col bg-surface-canvas text-ink-primary">
      {/* Top bar */}
      <header className="relative z-10 flex h-16 flex-none items-center px-6">
        <div className="flex items-center gap-[10px]">
          <Image src="/logo.png" alt="TasselTrak logo" width={40} height={40} priority className="object-contain" />
          <span className="text-title-18 text-ink-primary">TasselTrak</span>
        </div>
      </header>

      <div className="relative flex flex-1 flex-col items-center pb-12 short:pb-6 short:pt-3">
        <BackgroundArt />

        <section className="relative my-auto flex w-full max-w-[760px] flex-col items-center gap-7 px-5 short:gap-4">
          <div className="flex w-full flex-col items-center gap-3 text-center short:gap-2">
            <h1 className="text-display-44 text-ink-primary max-sm:text-[32px] max-sm:leading-10 short:text-[32px] short:leading-[38px]">
              Your whole degree,<br />on one board.
            </h1>
            <p className="text-body-16 text-ink-secondary short:text-body-14">
              TasselTrak maps every course in your major: what&rsquo;s done, what&rsquo;s left, and how it all connects.
            </p>
          </div>

          {/* Role picker */}
          <div className="flex w-full items-start gap-4 max-sm:flex-col max-sm:items-stretch">
            <RoleCard
              selected={role === "student"}
              onClick={() => selectRole("student")}
              disabled={loading}
              icon="/login/role-student.svg"
              title="I&rsquo;m a student"
              sub="Plan your courses and see what&rsquo;s left."
            />
            <RoleCard
              selected={role === "advisor"}
              onClick={() => selectRole("advisor")}
              disabled={loading}
              icon="/login/role-advisor.svg"
              title="I&rsquo;m an advisor"
              sub="See your students and who needs attention."
            />
          </div>

          {/* Panel */}
          <div className="flex w-full flex-col gap-[18px] rounded-panel border border-border-subtle bg-surface-card px-7 py-6 shadow-note short:gap-3 short:py-[18px]">
            <div className="flex w-full items-center justify-between">
              <h2 className="text-title-18 text-ink-primary">
                {role === "advisor" ? "Sign in as an advisor" : "Sign in as a student"}
              </h2>
              <span className="text-caption-12-regular text-ink-secondary">Use your UCF account</span>
            </div>

            <form onSubmit={handleLogin} className="flex w-full flex-col gap-[18px] short:gap-3" noValidate>
              <div className="flex w-full items-start gap-4 max-sm:flex-col">
                <div className="flex w-full min-w-0 flex-1 flex-col gap-1.5">
                  <label htmlFor="login-email" className="text-caption-12 text-ink-secondary">UCF email</label>
                  <input
                    id="login-email"
                    className={INPUT}
                    type="email"
                    placeholder="you@ucf.edu"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={loading}
                  />
                </div>
                <div className="flex w-full min-w-0 flex-1 flex-col gap-1.5">
                  <label htmlFor="login-password" className="text-caption-12 text-ink-secondary">Password</label>
                  <input
                    id="login-password"
                    className={INPUT}
                    type="password"
                    placeholder="Password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              {error && <ErrorNote>{error}</ErrorNote>}

              <button type="submit" disabled={loading} className={PRIMARY_BUTTON}>
                {loading ? "Signing in..." : "Sign in"}
              </button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
