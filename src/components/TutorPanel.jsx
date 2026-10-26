import React, { useEffect, useMemo, useRef, useState } from 'react';
import { askTutor } from '../tutor/client.js';
import { LANGUAGE_PACKS } from '../languagePacks.js';

// The answer text, with ``` fenced code shown as code blocks
function AnswerText({ text }) {
    const parts = text.split(/```[^\n]*\n?/);
    return parts.map((part, index) => (index % 2 === 1
        ? <pre key={index} className="tutor-code">{part.replace(/\n$/, '')}</pre>
        : <span key={index}>{part}</span>));
}

// The access code is remembered in this browser, so it is typed only once
const CODE_KEY = 'tutor-access-code';
function savedCode() {
    try {
        return localStorage.getItem(CODE_KEY) ?? '';
    } catch {
        return '';
    }
}
function saveCode(value) {
    try {
        localStorage.setItem(CODE_KEY, value);
    } catch {
        // storage blocked: the code is kept until the page closes
    }
}

/**
 * The "Explain" box: asks the AI tutor a question, in the student's language,
 * and shows the answer as it streams in.
 * makeRequest() builds the question; questionKey changes when the question does.
 * When verify is given, code in the finished answer is checked by the compiler,
 * and onUseCode can load it into the editor.
 */
const TutorPanel = ({ label, status, defaultLanguage, questionKey, makeRequest, verify, onUseCode }) => {
    const [language, setLanguage] = useState(defaultLanguage);
    const [answer, setAnswer] = useState('');
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [accessCode, setAccessCode] = useState(savedCode);
    const controller = useRef(null);

    // A different question (or language) starts with an empty answer
    useEffect(() => {
        controller.current?.abort();
        setAnswer('');
        setError(null);
        setLoading(false);
    }, [questionKey, language]);

    useEffect(() => setLanguage(defaultLanguage), [defaultLanguage]);
    useEffect(() => () => controller.current?.abort(), []);

    // Once the answer is complete, run any suggested code through the compiler
    const check = useMemo(() => (verify && answer && !loading ? verify(answer) : null), [verify, answer, loading]);

    const ask = async () => {
        controller.current?.abort();
        controller.current = new AbortController();
        setAnswer('');
        setError(null);
        setLoading(true);
        try {
            await askTutor({ ...makeRequest(), language }, text => setAnswer(previous => previous + text), controller.current.signal, accessCode.trim());
        } catch (failure) {
            if (failure.name !== 'AbortError') setError(failure.message);
        } finally {
            setLoading(false);
        }
    };

    if (!status?.available) return null; // no tutor server (for example a static build)

    return (
        <div className="tutor">
            <div className="tutor-bar">
                <button className="target-button is-active" onClick={ask} disabled={!status.configured || loading || (status.needsCode && accessCode.trim() === '')}>
                    {loading ? 'Explaining...' : label}
                </button>
                <label className="tutor-language">
                    in
                    <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={loading}>
                        {LANGUAGE_PACKS.map(pack => <option key={pack.id} value={pack.englishName}>{pack.englishName}</option>)}
                    </select>
                </label>
                {status.needsCode && (
                    <label className="tutor-language">
                        code
                        <input
                            type="password"
                            className="tutor-code-input"
                            value={accessCode}
                            onChange={(e) => {
                                setAccessCode(e.target.value);
                                saveCode(e.target.value);
                            }}
                            placeholder="access code"
                            aria-label="Tutor access code"
                            autoComplete="off"
                            disabled={loading}
                        />
                    </label>
                )}
            </div>
            {!status.configured && (
                <p className="tutor-note">
                    The AI tutor is not set up. Put your Anthropic API key in <code>.env.local</code> (see <code>.env.example</code>)
                    and restart <code>npm run dev</code>, or on Cloudflare add it to the project&apos;s secrets. Everything else works without it.
                </p>
            )}
            {error && <p className="tutor-error">{error}</p>}
            {answer && <div className="tutor-answer"><AnswerText text={answer} /></div>}
            {check?.status === 'checked' && (
                <div className="tutor-check is-good">
                    Checked by the compiler: the suggested code prints the same output.
                    VM instructions {check.before.steps.toLocaleString()} → {check.after.steps.toLocaleString()};
                    Big-O {check.before.bigO} → {check.after.bigO}.
                    {onUseCode && <button className="target-button" onClick={() => onUseCode(check.code)}>Load it into the editor</button>}
                </div>
            )}
            {check && check.status !== 'checked' && (
                <div className="tutor-check is-bad">Don&apos;t use the suggested code yet: {check.reason}.</div>
            )}
            {answer && !loading && <p className="tutor-note">Written by AI from the compiler&apos;s facts. Check it against the tabs above.</p>}
        </div>
    );
};

export default TutorPanel;
