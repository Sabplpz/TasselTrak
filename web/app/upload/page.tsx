"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import styles from "./upload.module.css";

type Theme = "light" | "dark";

function Mark() {
  return (
    <span className={styles.mark} aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path d="M5 10.5 16 5l11 5.5-11 5.5L5 10.5Z" fill="currentColor" />
        <path d="M9 13v7c4.3 3.2 9.7 3.2 14 0v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M27 11v7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function SunMoonIcon({ dark }: { dark: boolean }) {
  return dark ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.6 8.6 0 1 0 20.5 15.2Z" />
    </svg>
  );
}


function UploadIcon() {
  return (
    <svg
      width={56}
      height={56}
      viewBox="0 0 72 72"
      fill="none"
      aria-hidden="true"
      style={{
        display: "block",
        width: 56,
        height: 56,
        minWidth: 56,
        minHeight: 56,
        maxWidth: 56,
        maxHeight: 56,
        flexShrink: 0,
      }}
    >
      <rect
        x="8"
        y="8"
        width="56"
        height="56"
        rx="18"
        fill="currentColor"
        opacity=".08"
      />
      <path
        d="M36 46V23m0 0-9 9m9-9 9 9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M21 45v7a4 4 0 0 0 4 4h22a4 4 0 0 0 4-4v-7"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CourseCard({
  code,
  title,
  state,
  grade,
}: {
  code: string;
  title: string;
  state: "taken" | "progress" | "available" | "locked";
  grade?: string;
}) {
  const labels = {
    taken: "✓  Taken",
    progress: "◐  In progress",
    available: "→  Available now",
    locked: "⌑  Needs COP 3503",
  };
  return (
    <div className={`${styles.courseCard} ${styles[state]}`}>
      <div className={styles.courseTop}>
        <strong>{code}</strong>
        <span>3 cr</span>
      </div>
      <p>{title}</p>
      <div className={styles.courseBottom}>
        <span>{labels[state]}</span>
        {grade ? <b className={styles.grade}>{grade}</b> : null}
      </div>
    </div>
  );
}

export default function UploadPage() {
  const [theme, setTheme] = useState<Theme>("light");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("tasseltrak-theme");
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    window.localStorage.setItem("tasseltrak-theme", next);
  }

  function acceptFile(candidate?: File) {
    setError("");
    setNotice("");
    if (!candidate) return;
    if (candidate.type !== "application/pdf" && !candidate.name.toLowerCase().endsWith(".pdf")) {
      setFile(null);
      setError("Please choose a PDF file exported from myKnight Audit.");
      return;
    }
    if (candidate.size > 10 * 1024 * 1024) {
      setFile(null);
      setError("That file is larger than 10 MB. Choose a smaller PDF.");
      return;
    }
    setFile(candidate);
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    acceptFile(event.target.files?.[0]);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    acceptFile(event.dataTransfer.files?.[0]);
  }

  function handleContinue() {
    if (!file) {
      setError("Choose your degree audit PDF first.");
      return;
    }
    setNotice("File selected. Connect this action to your team's document-intake API to process it.");
  }

  return (
    <main
  className={styles.page}
  data-theme={theme}
>
  
      <header className={styles.topbar}>
        <a className={styles.brand} href="/dashboard" aria-label="TasselTrak home">
          <Mark />
          <span>TasselTrak</span>
        </a>
        <nav className={styles.navLinks} aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#privacy">Is my audit private?</a>
          <button className={styles.themeToggle} onClick={toggleTheme} type="button" aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`} title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}>
            <SunMoonIcon dark={theme === "dark"} />
            <span>{theme === "light" ? "Dark mode" : "Light mode"}</span>
          </button>
          <button className={styles.avatar} type="button" aria-label="Account menu">N</button>
          <button className={styles.signOut} type="button" onClick={() => setNotice("Connect this button to your existing sign-out handler.")}>Sign out</button>
        </nav>
      </header>

      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.backgroundArt} aria-hidden="true">
          <span className={`${styles.doodle} ${styles.doodleLeft}`} />
          <span className={`${styles.doodle} ${styles.doodleRight}`} />
          <CourseCard code="COP 3502" title="Computer Science I" state="taken" grade="A-" />
          <div className={`${styles.stickyNote} ${styles.noteLeft}`}>grad by<br />spring ’29?</div>
          <CourseCard code="COP 3503" title="Computer Science II" state="progress" />
          <div className={`${styles.stickyNote} ${styles.noteBottomLeft}`}>summer<br />classes?</div>
          <CourseCard code="CIS 3360" title="Security in Computing" state="available" />
          <div className={`${styles.stickyNote} ${styles.noteRight}`}>ask advisor<br />about COT 4210</div>
          <CourseCard code="COP 4331" title="OO Software Development" state="locked" />
          <div className={`${styles.stickyNote} ${styles.noteBottomRight}`}>Foundation<br />Exam ✓</div>
        </div>

        <div className={styles.heroContent}>
          <div className={styles.audienceTag}>
            <span />
            For UCF CS, IT &amp; Computer Engineering
          </div>
          <div className={styles.headlineBlock}>
            <h1 id="hero-title">Your whole degree,<br />on one board.</h1>
            <p>Drop in your degree audit and we’ll map every course in your major: what’s done, what’s left, and how the prerequisites connect.</p>
          </div>

          <div
            className={`${styles.dropzone} ${dragging ? styles.dragging : ""} ${file ? styles.hasFile : ""}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            role="group"
            aria-label="Degree audit PDF upload"
          >
            <div
  className={styles.uploadIcon}
  style={{
    width: "56px",
    height: "56px",
    overflow: "hidden",
    flexShrink: 0,
  }}
>
  <UploadIcon />
</div>
            {file ? (
              <div className={styles.fileDetails}>
                <strong>{file.name}</strong>
                <span>{(file.size / (1024 * 1024)).toFixed(2)} MB · Ready to continue</span>
                <button type="button" className={styles.removeFile} onClick={() => { setFile(null); setNotice(""); if (inputRef.current) inputRef.current.value = ""; }}>Remove file</button>
              </div>
            ) : (
              <div className={styles.uploadCopy}>
                <h2>Drop your degree audit PDF here</h2>
                <p>Export it from myKnight Audit · PDF up to 10 MB</p>
              </div>
            )}
            <input ref={inputRef} className={styles.fileInput} type="file" accept="application/pdf,.pdf" onChange={onInputChange} aria-label="Choose degree audit PDF" />
            <button className={styles.chooseButton} type="button" onClick={() => inputRef.current?.click()}>
              {file ? "Choose a different PDF" : "Choose PDF"}
            </button>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
            <p className={styles.privacyNote} id="privacy">Your audit is private and used to build your course map.</p>
          </div>
          <button className={styles.continueButton} type="button" onClick={handleContinue} disabled={!file}>
            Continue with degree audit <span aria-hidden="true">→</span>
          </button>
          <p className={styles.howLink} id="how-it-works">Not sure where to find your audit? <a href="#privacy">See how it works</a></p>
        </div>
      </section>
    </main>
  );
}
