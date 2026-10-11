"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getDatabase, ref, get } from "firebase/database";
import { auth } from "../../lib/firebase";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/Button";
import { CourseNode } from "@/components/CourseNode";

type Role = "student" | "advisor";

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
            <CourseNode credits="3 cr" code="COP 3502" title="Computer Science I" status="Taken" state="taken" grade="A-" />
          </div>
        </div>
        <div className={`${ART_PIECE} left-[69.139%] top-[64.881%]`}>
          <div className="rotate-5">
            <CourseNode credits="3 cr" code="COP 3503" title="Computer Science II" status="In progress" state="in-progress" />
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
            <CourseNode credits="3 cr" code="CIS 3360" title="Security in Computing" status="Available now" state="available" />
          </div>
        </div>
        <div className={`${ART_PIECE} left-[32.643%] top-[67.356%]`}>
          <div className="-rotate-4">
            <CourseNode credits="3 cr" code="COP 4331" title="OO Software Development" status="Needs COP 3503" state="locked" />
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

type Theme = "light" | "dark";
export default function LoginPage() {

  const [theme, setTheme] = useState<Theme>("dark");

useEffect(() => {
  const savedTheme = window.localStorage.getItem("tasseltrak-theme");

  if (savedTheme === "light" || savedTheme === "dark") {
    setTheme(savedTheme);
  }
}, []);

function toggleTheme() {
  const nextTheme = theme === "dark" ? "light" : "dark";

  setTheme(nextTheme);
  window.localStorage.setItem("tasseltrak-theme", nextTheme);
}

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
      <TopBar />

      <div className="relative flex flex-1 flex-col items-center pb-12 short:pb-6 short:pt-3">
        <BackgroundArt />

      {/* Top nav */}
      


<header className="tt-nav">
  <div className="tt-brand">
    <span className="tt-brand-icon">
      <CapIcon size={18} />
    </span>
    <span>TasselTrak</span>
  </div>

  <div className="tt-nav-actions">
    <a href="#how" className="tt-nav-link">
      How it works
    </a>

    <button
      type="button"
      className="tt-theme-toggle"
      onClick={toggleTheme}
    >
      <span aria-hidden="true">
        {theme === "dark" ? "☀️" : "🌙"}
      </span>
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  </div>
</header>
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

              <Button type="submit" disabled={loading}>
                {loading ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}

const css = `
.tt-page[data-theme="light"] {
  background: #f7f6f0;
  color: #202019;
}

.tt-theme-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 9px 14px;
  border: 1px solid #484842;
  border-radius: 999px;
  background: #292925;
  color: #fff;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
  .tt-page {
    position: relative;
    min-height: 100vh;
    overflow: hidden;
    background: #161614;
    color: #fff;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .tt-dots {
    position: absolute; inset: 0; pointer-events: none;
    background-image: radial-gradient(rgba(255,255,255,0.09) 1px, transparent 1.2px);
    background-size: 18px 18px;
  }
  .tt-glow {
    position: absolute; left: 50%; top: 52%;
    width: 760px; height: 560px;
    transform: translate(-50%, -50%);
    background: radial-gradient(ellipse at center, rgba(255,201,0,0.2) 0%, rgba(255,201,0,0.06) 45%, transparent 70%);
    filter: blur(30px);
    pointer-events: none;
  }

  /* Nav */
  .tt-nav {
    position: relative; z-index: 5;
    display: flex; align-items: center; justify-content: space-between;
    padding: 18px 20px;
  }
  .tt-brand { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 15px; }
  .tt-brand-icon {
    width: 32px; height: 32px; border-radius: 9px;
    background: #000; display: grid; place-items: center;
  }
  .tt-nav-link { color: rgba(255,255,255,0.8); font-size: 13px; text-decoration: none; }
  .tt-nav-link:hover { color: #ffc900; }

  /* Center */
  .tt-center {
    position: relative; z-index: 3;
    max-width: 530px; margin: 0 auto;
    padding: 40px 20px 60px;
    text-align: center;
    animation: tt-rise .7s cubic-bezier(.2,.8,.2,1) both;
  }
  .tt-h1 {
    margin: 0; font-size: clamp(30px, 4.4vw, 40px);
    line-height: 1.12; font-weight: 800; letter-spacing: -0.02em;
  }
  .tt-lead { margin: 18px auto 26px; color: rgba(255,255,255,0.55); font-size: 13.5px; line-height: 1.5; }

  /* Roles */
  .tt-roles { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .tt-role {
    text-align: left; cursor: pointer; color: inherit;
    background: #242422; border: 1.5px solid #3a3a37;
    border-radius: 16px; padding: 16px;
    transition: border-color .15s, background .15s, transform .15s;
  }
  .tt-role:hover { transform: translateY(-2px); border-color: #5a5a55; }
  .tt-role.is-on { border-color: #ffc900; background: #2b2a22; }
  .tt-role-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
  .tt-role-icon {
    width: 34px; height: 34px; border-radius: 10px; background: #000;
    display: grid; place-items: center;
  }
  .tt-role-title { font-weight: 700; font-size: 15px; margin-bottom: 4px; }
  .tt-role-sub { font-size: 12px; color: rgba(255,255,255,0.55); line-height: 1.4; }
  .tt-pill {
    background: #000; color: #fff; font-size: 11px; font-weight: 600;
    padding: 4px 10px; border-radius: 999px;
  }
  .tt-radio {
    width: 18px; height: 18px; border-radius: 50%;
    border: 1.5px solid #6a6a65; flex: none;
  }

  /* Panel */
  .tt-panel {
    margin-top: 22px; text-align: left;
    background: #242422; border: 1px solid #353532;
    border-radius: 18px; padding: 20px;
    box-shadow: 0 30px 70px rgba(0,0,0,0.45);
  }
  .tt-panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
  .tt-panel-head h2 { margin: 0; font-size: 15px; font-weight: 700; }
  .tt-panel-head span { font-size: 11px; color: rgba(255,255,255,0.5); }

  .tt-list { display: flex; flex-direction: column; gap: 8px; }
  .tt-adv {
    display: flex; align-items: center; gap: 12px;
    width: 100%; text-align: left; color: inherit; cursor: pointer;
    background: #1d1d1b; border: 1.5px solid #3a3a37;
    border-radius: 12px; padding: 9px 12px;
    transition: border-color .15s, background .15s;
  }
  .tt-adv:hover { border-color: #5a5a55; }
  .tt-adv.is-on { border-color: #ffc900; background: #2b2a22; }
  .tt-avatar {
    width: 32px; height: 32px; border-radius: 50%; flex: none;
    background: #2e2e2b; border: 1px solid #44443f;
    display: grid; place-items: center;
    font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.75);
  }
  .tt-adv-text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .tt-adv-text b { font-size: 13px; font-weight: 600; }
  .tt-adv-text small { font-size: 11px; color: rgba(255,255,255,0.5); }
  .tt-tick {
    width: 20px; height: 20px; border-radius: 50%; background: #ffc900;
    display: grid; place-items: center; flex: none;
  }
  .tt-adv.is-on .tt-tick { background: #fff; }

  .tt-cta {
    margin-top: 14px; width: 100%;
    padding: 12px; border: none; border-radius: 999px;
    background: #f4f2ec; color: #111;
    font-size: 13px; font-weight: 700; cursor: pointer;
    transition: transform .15s, background .15s, box-shadow .15s;
  }
  .tt-cta:hover:not(:disabled) { background: #ffc900; transform: translateY(-1px); box-shadow: 0 8px 22px rgba(255,201,0,0.3); }
  .tt-cta:disabled { opacity: .7; cursor: not-allowed; }

  /* Student form */
  .tt-form { display: flex; flex-direction: column; gap: 10px; }
  .tt-input {
    width: 100%; box-sizing: border-box;
    padding: 12px 14px; font-size: 14px;
    color: #111; background: #fff;
    border: 2px solid transparent; border-radius: 12px; outline: none;
    transition: border-color .15s, box-shadow .15s;
  }
  .tt-input:focus { border-color: #ffc900; box-shadow: 0 0 0 4px rgba(255,201,0,0.22); }
  .tt-error {
    padding: 9px 12px; border-radius: 10px; font-size: 13px;
    background: rgba(255,80,80,0.14); border: 1px solid rgba(255,100,100,0.45); color: #ffb3b3;
  }

  /* Floating cards */
  .tt-lines {
    position: absolute; inset: 0; width: 100%; height: 100%;
    z-index: 1; pointer-events: none;
  }
  .tt-lines path { fill: none; stroke: #4a4a46; stroke-width: 1.4; vector-effect: non-scaling-stroke; }

  .tt-float {
    position: absolute; z-index: 2; width: 156px;
    background: #2a2a28; border: 1.5px solid #3f3f3b;
    border-radius: 14px; padding: 12px 14px;
    text-align: left; font-size: 11px;
    box-shadow: 0 14px 34px rgba(0,0,0,0.4);
    animation: tt-bob 7s ease-in-out infinite;
  }
  .tt-fc-top { display: flex; justify-content: space-between; align-items: baseline; }
  .tt-fc-top b { font-size: 13px; font-weight: 700; }
  .tt-fc-top span { font-size: 10px; color: rgba(255,255,255,0.45); }
  .tt-fc-name { margin: 5px 0 10px; color: rgba(255,255,255,0.55); font-size: 11px; }
  .tt-fc-foot { display: flex; justify-content: space-between; align-items: center; }
  .tt-status { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 11px; }
  .tt-dim { color: #aaa; font-weight: 500; }
  .tt-grade { background: #f4f2ec; color: #111; font-weight: 700; font-size: 10px; padding: 2px 8px; border-radius: 999px; }

  .tt-progress { border-color: #fff; background: #1e1e1c; }
  .tt-available { border-color: #ffc900; background: #2d2a1a; }
  .tt-locked { border-style: dashed; border-color: #6a6a65; background: #232321; }

  .tt-note {
    width: 98px; height: 98px; padding: 0;
    display: grid; place-items: center; text-align: center;
    background: #3a3414; border-color: transparent; border-radius: 6px;
    font-size: 12px; font-weight: 600; line-height: 1.3;
  }
  .tt-note.tt-yellow { background: #ffc900; color: #111; width: 92px; height: 92px; }

  .tt-c1 { left: 6.5%; top: 17%; transform: rotate(-6deg); }
  .tt-n1 { left: 3.8%; top: 42%; transform: rotate(-4deg); animation-delay: -2s; }
  .tt-c2 { left: 10%; top: 61%; transform: rotate(4deg); animation-delay: -4s; }
  .tt-n2 { left: 8%; top: 83%; transform: rotate(3deg); animation-delay: -1s; }
  .tt-c3 { right: 5.5%; top: 24%; transform: rotate(-4deg); animation-delay: -3s; }
  .tt-n3 { right: 4.5%; top: 45%; transform: rotate(5deg); animation-delay: -5s; }
  .tt-c4 { right: 5.5%; top: 64%; transform: rotate(-3deg); animation-delay: -2.5s; }
  .tt-n4 { right: 7.5%; top: 86%; transform: rotate(3deg); animation-delay: -1.5s; }

  @keyframes tt-bob {
    0%, 100% { translate: 0 0; }
    50% { translate: 0 -8px; }
  }
  @keyframes tt-rise {
    from { opacity: 0; transform: translateY(16px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @media (max-width: 1100px) {
    .tt-float, .tt-lines { display: none; }
  }
  @media (max-width: 520px) {
    .tt-roles { grid-template-columns: 1fr; }
  }
  @media (prefers-reduced-motion: reduce) {
    .tt-float, .tt-center { animation: none; }
  }
`;
