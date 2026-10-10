"use client";

import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../../lib/firebase";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.push("/dashboard");
    } catch (err) {
      console.error(err);
      setError("Email o contraseña incorrectos.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="tt-page">
      <style>{css}</style>

      {/* Decorative background */}
      <div className="tt-glow tt-glow-1" />
      <div className="tt-glow tt-glow-2" />
      <div className="tt-grid" />

      <div className="tt-shell">
        {/* Brand / hero side */}
        <section className="tt-hero">
          <div className="tt-logo-wrap">
            {/* Save the logo as /public/tasseltrak-logo.png */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/tasseltrak-logo.png"
              alt="TasselTrak"
              className="tt-logo"
            />
          </div>

          <h2 className="tt-tagline">
            Your path to the <span>stage</span>, tracked every step.
          </h2>
          <p className="tt-sub">
            Follow your degree progress, stay on top of requirements, and know
            exactly how close you are to graduation day.
          </p>

          <ul className="tt-features">
            <li>
              <span className="tt-dot" /> Real-time degree progress
            </li>
            <li>
              <span className="tt-dot" /> Requirements at a glance
            </li>
            <li>
              <span className="tt-dot" /> Built for UCF students
            </li>
          </ul>
        </section>

        {/* Form side */}
        <section className="tt-card">
          <div className="tt-card-head">
            <p className="tt-eyebrow">Welcome back</p>
            <h1 className="tt-title">Student Login</h1>
            <p className="tt-card-sub">
              Sign in with your UCF email to continue.
            </p>
          </div>

          <form onSubmit={handleLogin} className="tt-form">
            <label className="tt-label" htmlFor="email">
              UCF Email
            </label>
            <input
              id="email"
              className="tt-input"
              type="email"
              placeholder="knight@ucf.edu"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <label className="tt-label" htmlFor="password">
              Password
            </label>
            <div className="tt-pass">
              <input
                id="password"
                className="tt-input"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="tt-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>

            {error && (
              <div className="tt-error" role="alert">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="tt-submit">
              {loading ? (
                <>
                  <span className="tt-spinner" /> Signing in...
                </>
              ) : (
                "Sign in"
              )}
            </button>
          </form>

          <p className="tt-foot">Go Knights. Charge on. ⚔️</p>
        </section>
      </div>
    </main>
  );
}

const css = `
  .tt-page {
    position: relative;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px 20px;
    overflow: hidden;
    background: #0a0a0a;
    color: #fff;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }

  .tt-glow {
    position: absolute;
    border-radius: 50%;
    filter: blur(110px);
    pointer-events: none;
    opacity: 0.55;
  }
  .tt-glow-1 {
    width: 520px; height: 520px;
    top: -160px; left: -120px;
    background: radial-gradient(circle, #ffc900 0%, transparent 70%);
    animation: tt-float 14s ease-in-out infinite;
  }
  .tt-glow-2 {
    width: 460px; height: 460px;
    bottom: -160px; right: -100px;
    background: radial-gradient(circle, #b8860b 0%, transparent 70%);
    animation: tt-float 18s ease-in-out infinite reverse;
  }
  .tt-grid {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(rgba(255,201,0,0.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,201,0,0.05) 1px, transparent 1px);
    background-size: 48px 48px;
    mask-image: radial-gradient(ellipse at center, #000 30%, transparent 75%);
    -webkit-mask-image: radial-gradient(ellipse at center, #000 30%, transparent 75%);
    pointer-events: none;
  }

  .tt-shell {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 1020px;
    display: grid;
    grid-template-columns: 1.1fr 1fr;
    gap: 40px;
    align-items: center;
    animation: tt-rise 0.7s cubic-bezier(.2,.8,.2,1) both;
  }

  /* Hero */
  .tt-hero { display: flex; flex-direction: column; gap: 22px; }
  .tt-logo-wrap {
    align-self: flex-start;
    background: #fff;
    border-radius: 28px;
    padding: 18px 26px;
    box-shadow:
      0 0 0 1px rgba(255,201,0,0.35),
      0 20px 60px rgba(255,201,0,0.18),
      0 8px 24px rgba(0,0,0,0.5);
  }
  .tt-logo { display: block; width: 280px; max-width: 100%; height: auto; }

  .tt-tagline {
    margin: 6px 0 0;
    font-size: clamp(28px, 4vw, 42px);
    line-height: 1.12;
    font-weight: 800;
    letter-spacing: -0.02em;
  }
  .tt-tagline span {
    background: linear-gradient(90deg, #ffc900, #ffe27a, #e0a800);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .tt-sub {
    margin: 0;
    max-width: 460px;
    color: rgba(255,255,255,0.68);
    font-size: 16px;
    line-height: 1.6;
  }
  .tt-features {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    color: rgba(255,255,255,0.85);
    font-size: 15px;
  }
  .tt-features li { display: flex; align-items: center; gap: 12px; }
  .tt-dot {
    width: 9px; height: 9px; border-radius: 50%;
    background: #ffc900;
    box-shadow: 0 0 12px rgba(255,201,0,0.8);
  }

  /* Card */
  .tt-card {
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 24px;
    padding: 36px 32px;
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    box-shadow: 0 30px 80px rgba(0,0,0,0.55);
  }
  .tt-eyebrow {
    margin: 0 0 6px;
    color: #ffc900;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .tt-title { margin: 0; font-size: 30px; font-weight: 800; letter-spacing: -0.02em; }
  .tt-card-sub { margin: 8px 0 24px; color: rgba(255,255,255,0.6); font-size: 14px; }

  .tt-form { display: flex; flex-direction: column; gap: 8px; }
  .tt-label {
    margin-top: 8px;
    font-size: 13px;
    font-weight: 600;
    color: rgba(255,255,255,0.8);
  }
  .tt-input {
    width: 100%;
    box-sizing: border-box;
    padding: 14px 16px;
    font-size: 15px;
    color: #111;
    background: #fff;
    border: 2px solid transparent;
    border-radius: 12px;
    outline: none;
    transition: border-color .15s, box-shadow .15s;
  }
  .tt-input::placeholder { color: #9a9a9a; }
  .tt-input:focus {
    border-color: #ffc900;
    box-shadow: 0 0 0 4px rgba(255,201,0,0.25);
  }
  .tt-pass { position: relative; }
  .tt-pass .tt-input { padding-right: 70px; }
  .tt-toggle {
    position: absolute;
    right: 8px; top: 50%;
    transform: translateY(-50%);
    background: transparent;
    border: none;
    color: #8a6a00;
    font-weight: 700;
    font-size: 13px;
    padding: 8px 10px;
    cursor: pointer;
    border-radius: 8px;
  }
  .tt-toggle:hover { background: rgba(255,201,0,0.2); }

  .tt-error {
    margin-top: 6px;
    padding: 10px 14px;
    border-radius: 10px;
    background: rgba(255,80,80,0.14);
    border: 1px solid rgba(255,100,100,0.45);
    color: #ffb3b3;
    font-size: 14px;
  }

  .tt-submit {
    margin-top: 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 15px;
    font-size: 16px;
    font-weight: 800;
    color: #111;
    background: linear-gradient(135deg, #ffd84d 0%, #ffc900 50%, #e6a800 100%);
    border: none;
    border-radius: 12px;
    cursor: pointer;
    box-shadow: 0 10px 28px rgba(255,201,0,0.35);
    transition: transform .15s, box-shadow .15s, filter .15s;
  }
  .tt-submit:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 14px 34px rgba(255,201,0,0.5);
    filter: brightness(1.05);
  }
  .tt-submit:active:not(:disabled) { transform: translateY(0); }
  .tt-submit:disabled { opacity: 0.7; cursor: not-allowed; }

  .tt-spinner {
    width: 16px; height: 16px;
    border: 2px solid rgba(0,0,0,0.25);
    border-top-color: #111;
    border-radius: 50%;
    animation: tt-spin .7s linear infinite;
  }
  .tt-foot {
    margin: 22px 0 0;
    text-align: center;
    font-size: 13px;
    color: rgba(255,255,255,0.45);
  }

  @keyframes tt-spin { to { transform: rotate(360deg); } }
  @keyframes tt-rise {
    from { opacity: 0; transform: translateY(18px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes tt-float {
    0%, 100% { transform: translate(0, 0); }
    50% { transform: translate(30px, 24px); }
  }

  @media (max-width: 860px) {
    .tt-shell { grid-template-columns: 1fr; gap: 28px; max-width: 460px; }
    .tt-hero { align-items: center; text-align: center; }
    .tt-logo-wrap { align-self: center; }
    .tt-logo { width: 220px; }
    .tt-features { display: none; }
    .tt-sub { display: none; }
    .tt-tagline { font-size: 24px; }
    .tt-card { padding: 28px 22px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .tt-shell, .tt-glow { animation: none; }
  }
`;

