"use client";

import { useState, type FormEvent } from "react";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getDatabase, ref, get } from "firebase/database";
import { auth } from "../../lib/firebase";
import { useRouter } from "next/navigation";

type Role = "student" | "advisor";

function CapIcon({
  size = 20,
  color = "#ffc900",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 10 12 5 2 10l10 5 10-5z" fill={color} />
      <path d="M6 12v5c3 2.5 9 2.5 12 0v-5" />
      <path d="M22 10v6" />
    </svg>
  );
}

function PeopleIcon({
  size = 20,
  color = "#ffc900",
}: {
    size?: number;
    color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M17 14c2.5 0 4.5 2 4.5 4.5" />
    </svg>
  );
}

function CheckCircle({ filled = false }: { filled?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16">
      <circle
        cx="8"
        cy="8"
        r="8"
        fill={filled ? "#fff" : "none"}
        stroke="#fff"
        strokeWidth="1.2"
      />
      <path
        d="m4.6 8.2 2.3 2.3 4.5-4.8"
        fill="none"
        stroke="#111"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
    setRole(nextRole);
    setError("");
  }

  async function handleLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

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
        setError(
          "Tu cuenta no tiene un rol válido asignado. Contacta al administrador."
        );
        return;
      }

      if (savedRole !== role) {
        await signOut(auth);
        setError(
          savedRole === "student"
            ? 'Tu cuenta es de estudiante. Selecciona "I’m a student".'
            : 'Tu cuenta es de advisor. Selecciona "I’m an advisor".'
        );
        return;
      }

      router.replace(
        savedRole === "advisor" ? "/advisor" : "/dashboard"
      );
    } catch (err: unknown) {
      console.error(err);

      if (authenticated) {
        await signOut(auth).catch(console.error);
        setError(
          "No se pudo leer tu rol. Revisa el UID y las Rules de Firebase."
        );
      } else {
        setError(
          "No se pudo iniciar sesión. Revisa tu correo y contraseña."
        );
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="tt-page">
      <style>{css}</style>

      <div className="tt-dots" />
      <div className="tt-glow" />

      <header className="tt-nav">
        <div className="tt-brand">
          <span className="tt-brand-icon">
            <CapIcon size={18} />
          </span>
          <span>TasselTrak</span>
        </div>

        <a href="#how" className="tt-nav-link">
          How it works
        </a>
      </header>

      <svg
        className="tt-lines"
        viewBox="0 0 1053 750"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M158 218 C 170 270, 120 280, 100 322" />
        <path d="M110 430 C 150 450, 190 430, 175 468" />
        <path d="M205 548 C 215 590, 170 600, 160 630" />
        <path d="M950 262 C 965 300, 960 320, 958 342" />
        <path d="M912 430 C 880 450, 870 470, 868 490" />
        <path d="M900 560 C 930 580, 925 610, 925 640" />
      </svg>

      <div className="tt-float tt-c1">
        <div className="tt-fc-top">
          <b>COP 3502</b>
          <span>3 cr</span>
        </div>
        <div className="tt-fc-name">Computer Science I</div>
        <div className="tt-fc-foot">
          <span className="tt-status">
            <CheckCircle filled /> Taken
          </span>
          <span className="tt-grade">A-</span>
        </div>
      </div>

      <div className="tt-float tt-note tt-n1">
        grad by
        <br />
        spring &rsquo;29?
      </div>

      <div className="tt-float tt-c2 tt-progress">
        <div className="tt-fc-top">
          <b>COP 3503</b>
          <span>3 cr</span>
        </div>
        <div className="tt-fc-name">Computer Science II</div>
        <div className="tt-fc-foot">
          <span className="tt-status">
            <svg width="14" height="14" viewBox="0 0 16 16">
              <circle
                cx="8"
                cy="8"
                r="7"
                fill="none"
                stroke="#fff"
                strokeWidth="1.4"
              />
              <path d="M8 1a7 7 0 0 1 0 14z" fill="#fff" />
            </svg>
            In progress
          </span>
        </div>
      </div>

      <div className="tt-float tt-note tt-n2">
        summer
        <br />
        classes?
      </div>

      <div className="tt-float tt-c3 tt-available">
        <div className="tt-fc-top">
          <b>CIS 3360</b>
          <span>3 cr</span>
        </div>
        <div className="tt-fc-name">Security in Computing</div>
        <div className="tt-fc-foot">
          <span className="tt-status">
            <svg width="16" height="16" viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="8" fill="#ffc900" />
              <path
                d="M5 8h6m-2.5-2.5L11 8l-2.5 2.5"
                fill="none"
                stroke="#111"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Available now
          </span>
        </div>
      </div>

      <div className="tt-float tt-note tt-n3">
        ask advisor
        <br />
        about COT 4210
      </div>

      <div className="tt-float tt-c4 tt-locked">
        <div className="tt-fc-top">
          <b>COP 4331</b>
          <span>3 cr</span>
        </div>
        <div className="tt-fc-name">OO Software Development</div>
        <div className="tt-fc-foot">
          <span className="tt-status tt-dim">
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="#aaa"
              strokeWidth="1.6"
            >
              <rect
                x="3"
                y="7"
                width="10"
                height="7"
                rx="1.5"
                fill="#aaa"
              />
              <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
            </svg>
            Needs COP 3503
          </span>
        </div>
      </div>

      <div className="tt-float tt-note tt-yellow tt-n4">
        Foundation
        <br />
        Exam &#10003;
      </div>

      <section className="tt-center" id="how">
        <h1 className="tt-h1">
          Your whole degree,
          <br />
          on one board.
        </h1>

        <p className="tt-lead">
          TasselTrak maps every course in your major: what&rsquo;s
          done, what&rsquo;s left, and how it all connects.
        </p>

        <div className="tt-roles">
          <button
            type="button"
            className={`tt-role ${role === "student" ? "is-on" : ""}`}
            onClick={() => selectRole("student")}
            disabled={loading}
            aria-pressed={role === "student"}
          >
            <div className="tt-role-top">
              <span className="tt-role-icon">
                <CapIcon />
              </span>
              {role === "student" ? (
                <span className="tt-pill">&#10003; Selected</span>
              ) : (
                <span className="tt-radio" />
              )}
            </div>
            <div className="tt-role-title">I&rsquo;m a student</div>
            <div className="tt-role-sub">
              Plan your courses and see what&rsquo;s left.
            </div>
          </button>

          <button
            type="button"
            className={`tt-role ${role === "advisor" ? "is-on" : ""}`}
            onClick={() => selectRole("advisor")}
            disabled={loading}
            aria-pressed={role === "advisor"}
          >
            <div className="tt-role-top">
              <span className="tt-role-icon">
                <PeopleIcon />
              </span>
              {role === "advisor" ? (
                <span className="tt-pill">&#10003; Selected</span>
              ) : (
                <span className="tt-radio" />
              )}
            </div>
            <div className="tt-role-title">I&rsquo;m an advisor</div>
            <div className="tt-role-sub">
              See your students and who needs attention.
            </div>
          </button>
        </div>

        <div className="tt-panel">
          <div className="tt-panel-head">
            <h2>
              {role === "advisor" ? "Advisor Login" : "Student Login"}
            </h2>
            <span>UCF email</span>
          </div>

          <form onSubmit={handleLogin} className="tt-form">
            <input
              className="tt-input"
              type="email"
              placeholder="UCF Email"
              aria-label="Email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
            />

            <input
              className="tt-input"
              type="password"
              placeholder="Password"
              aria-label="Password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
            />

            {error && (
              <div className="tt-error" role="alert">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="tt-cta"
            >
              {loading
                ? "Signing in..."
                : role === "advisor"
                  ? "Sign in as advisor"
                  : "Sign in as student"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

const css = `
  .tt-page {
    position: relative;
    min-height: 100vh;
    overflow: hidden;
    background: #161614;
    color: #fff;
    font-family: ui-sans-serif, system-ui, -apple-system,
      "Segoe UI", Roboto, sans-serif;
  }

  .tt-dots {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image:
      radial-gradient(rgba(255,255,255,0.09) 1px, transparent 1.2px);
    background-size: 18px 18px;
  }

  .tt-glow {
    position: absolute;
    left: 50%;
    top: 52%;
    width: 760px;
    height: 560px;
    transform: translate(-50%, -50%);
    background: radial-gradient(
      ellipse at center,
      rgba(255,201,0,0.2) 0%,
      rgba(255,201,0,0.06) 45%,
      transparent 70%
    );
    filter: blur(30px);
    pointer-events: none;
  }

  .tt-nav {
    position: relative;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 20px;
  }

  .tt-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
    font-size: 15px;
  }

  .tt-brand-icon {
    width: 32px;
    height: 32px;
    border-radius: 9px;
    background: #000;
    display: grid;
    place-items: center;
  }

  .tt-nav-link {
    color: rgba(255,255,255,0.8);
    font-size: 13px;
    text-decoration: none;
  }

  .tt-nav-link:hover {
    color: #ffc900;
  }

  .tt-center {
    position: relative;
    z-index: 3;
    max-width: 530px;
    margin: 0 auto;
    padding: 40px 20px 60px;
    text-align: center;
    animation: tt-rise .7s cubic-bezier(.2,.8,.2,1) both;
  }

  .tt-h1 {
    margin: 0;
    font-size: clamp(30px, 4.4vw, 40px);
    line-height: 1.12;
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  .tt-lead {
    margin: 18px auto 26px;
    color: rgba(255,255,255,0.55);
    font-size: 13.5px;
    line-height: 1.5;
  }

  .tt-roles {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }

  .tt-role {
    text-align: left;
    cursor: pointer;
    color: inherit;
    background: #242422;
    border: 1.5px solid #3a3a37;
    border-radius: 16px;
    padding: 16px;
    transition: border-color .15s, background .15s, transform .15s;
  }

  .tt-role:hover:not(:disabled) {
    transform: translateY(-2px);
    border-color: #5a5a55;
  }

  .tt-role:disabled {
    cursor: not-allowed;
    opacity: .7;
  }

  .tt-role.is-on {
    border-color: #ffc900;
    background: #2b2a22;
  }

  .tt-role-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 18px;
  }

  .tt-role-icon {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    background: #000;
    display: grid;
    place-items: center;
  }

  .tt-role-title {
    font-weight: 700;
    font-size: 15px;
    margin-bottom: 4px;
  }

  .tt-role-sub {
    font-size: 12px;
    color: rgba(255,255,255,0.55);
    line-height: 1.4;
  }

  .tt-pill {
    background: #000;
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 999px;
  }

  .tt-radio {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1.5px solid #6a6a65;
    flex: none;
  }

  .tt-panel {
    margin-top: 22px;
    text-align: left;
    background: #242422;
    border: 1px solid #353532;
    border-radius: 18px;
    padding: 20px;
    box-shadow: 0 30px 70px rgba(0,0,0,0.45);
  }

  .tt-panel-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 14px;
  }

  .tt-panel-head h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
  }

  .tt-panel-head span {
    font-size: 11px;
    color: rgba(255,255,255,0.5);
  }

  .tt-cta {
    margin-top: 14px;
    width: 100%;
    padding: 12px;
    border: none;
    border-radius: 999px;
    background: #f4f2ec;
    color: #111;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: transform .15s, background .15s, box-shadow .15s;
  }

  .tt-cta:hover:not(:disabled) {
    background: #ffc900;
    transform: translateY(-1px);
    box-shadow: 0 8px 22px rgba(255,201,0,0.3);
  }

  .tt-cta:disabled {
    opacity: .7;
    cursor: not-allowed;
  }

  .tt-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .tt-input {
    width: 100%;
    box-sizing: border-box;
    padding: 12px 14px;
    font-size: 14px;
    color: #111;
    background: #fff;
    border: 2px solid transparent;
    border-radius: 12px;
    outline: none;
    transition: border-color .15s, box-shadow .15s;
  }

  .tt-input:focus {
    border-color: #ffc900;
    box-shadow: 0 0 0 4px rgba(255,201,0,0.22);
  }

  .tt-error {
    padding: 9px 12px;
    border-radius: 10px;
    font-size: 13px;
    background: rgba(255,80,80,0.14);
    border: 1px solid rgba(255,100,100,0.45);
    color: #ffb3b3;
  }

  .tt-lines {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 1;
    pointer-events: none;
  }

  .tt-lines path {
    fill: none;
    stroke: #4a4a46;
    stroke-width: 1.4;
    vector-effect: non-scaling-stroke;
  }

  .tt-float {
    position: absolute;
    z-index: 2;
    width: 156px;
    background: #2a2a28;
    border: 1.5px solid #3f3f3b;
    border-radius: 14px;
    padding: 12px 14px;
    text-align: left;
    font-size: 11px;
    box-shadow: 0 14px 34px rgba(0,0,0,0.4);
    animation: tt-bob 7s ease-in-out infinite;
  }

  .tt-fc-top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .tt-fc-top b {
    font-size: 13px;
    font-weight: 700;
  }

  .tt-fc-top span {
    font-size: 10px;
    color: rgba(255,255,255,0.45);
  }

  .tt-fc-name {
    margin: 5px 0 10px;
    color: rgba(255,255,255,0.55);
    font-size: 11px;
  }

  .tt-fc-foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .tt-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    font-size: 11px;
  }

  .tt-dim {
    color: #aaa;
    font-weight: 500;
  }

  .tt-grade {
    background: #f4f2ec;
    color: #111;
    font-weight: 700;
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 999px;
  }

  .tt-progress {
    border-color: #fff;
    background: #1e1e1c;
  }

  .tt-available {
    border-color: #ffc900;
    background: #2d2a1a;
  }

  .tt-locked {
    border-style: dashed;
    border-color: #6a6a65;
    background: #232321;
  }

  .tt-note {
    width: 98px;
    height: 98px;
    padding: 0;
    display: grid;
    place-items: center;
    text-align: center;
    background: #3a3414;
    border-color: transparent;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.3;
  }

  .tt-note.tt-yellow {
    background: #ffc900;
    color: #111;
    width: 92px;
    height: 92px;
  }

  .tt-c1 {
    left: 6.5%;
    top: 17%;
    transform: rotate(-6deg);
  }

  .tt-n1 {
    left: 3.8%;
    top: 42%;
    transform: rotate(-4deg);
    animation-delay: -2s;
  }

  .tt-c2 {
    left: 10%;
    top: 61%;
    transform: rotate(4deg);
    animation-delay: -4s;
  }

  .tt-n2 {
    left: 8%;
    top: 83%;
    transform: rotate(3deg);
    animation-delay: -1s;
  }

  .tt-c3 {
    right: 5.5%;
    top: 24%;
    transform: rotate(-4deg);
    animation-delay: -3s;
  }

  .tt-n3 {
    right: 4.5%;
    top: 45%;
    transform: rotate(5deg);
    animation-delay: -5s;
  }

  .tt-c4 {
    right: 5.5%;
    top: 64%;
    transform: rotate(-3deg);
    animation-delay: -2.5s;
  }

  .tt-n4 {
    right: 7.5%;
    top: 86%;
    transform: rotate(3deg);
    animation-delay: -1.5s;
  }

  @keyframes tt-bob {
    0%, 100% { translate: 0 0; }
    50% { translate: 0 -8px; }
  }

  @keyframes tt-rise {
    from { opacity: 0; transform: translateY(16px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @media (max-width: 1100px) {
    .tt-float, .tt-lines {
      display: none;
    }
  }

  @media (max-width: 520px) {
    .tt-roles {
      grid-template-columns: 1fr;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .tt-float, .tt-center {
      animation: none;
    }
  }
`;