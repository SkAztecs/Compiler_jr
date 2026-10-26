import React, { useMemo } from 'react';
import { GUIDE_SECTIONS, NOT_SUPPORTED } from '../guide.js';
import { keywordSpellings } from '../interpreter/lexer.js';
import { translateKeywords } from '../compiler/translate.js';
import { highlightSegments } from '../compiler/highlight.js';

// Converts English example code to the chosen keywords (left as English if that fails)
function inLanguage(code, settings) {
    try {
        return translateKeywords(code, {}, settings).code;
    } catch {
        return code;
    }
}

// Text with `code` marks, and {keyword} placeholders spelled in the chosen language
function GuideText({ text, words }) {
    const filled = text.replace(/\{(\w+)\}/g, (match, word) => words[word] ?? match);
    return filled.split('`').map((piece, index) =>
        index % 2 === 1 ? <code key={index}>{piece}</code> : <React.Fragment key={index}>{piece}</React.Fragment>);
}

// Example code, coloured the same way as the editor
function CodeExample({ code, settings, onTry }) {
    const segments = highlightSegments(code, settings);
    return (
        <div className="guide-example">
            <pre><code>{segments.map((segment, index) => (
                <span key={index} className={`syntax-${segment.kind}`}>{segment.text}</span>
            ))}</code></pre>
            <button className="guide-try" onClick={() => onTry(code)}>Try it</button>
        </div>
    );
}

/**
 * The Help & Syntax guide. Every example and keyword is shown in the
 * keyword language currently chosen in Settings.
 */
const HelpModal = ({ isOpen, onClose, settings, onTryExample }) => {
    const keywords = useMemo(() => keywordSpellings(settings), [settings]);
    const words = useMemo(() => Object.fromEntries(keywords.map(k => [k.defaultWord, k.word])), [keywords]);
    const isEnglish = keywords.every(k => k.word === k.defaultWord);

    if (!isOpen) return null;

    return (
        <div
            className="modal-backdrop"
            onClick={onClose} // Close on backdrop click
        >
            <div
                className="modal-content help-modal"
                onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside
            >
                {/* Modal Header */}
                <div className="modal-header">
                    <h2 className="modal-title">Syntax Guide</h2>
                    <button
                        onClick={onClose}
                        className="btn-close"
                    >
                        &times;
                    </button>
                </div>

                {/* Modal Content */}
                <div className="modal-body">
                    <p>
                        How to write programs in this language. The examples use the keywords you chose in
                        <b> Settings</b>{isEnglish ? ' (English right now)' : ''}; press <b>Try it</b> to load one into the editor.
                    </p>

                    <h3>The keywords</h3>
                    <table className="guide-table">
                        <thead>
                            <tr><th>Meaning</th><th>In your language</th></tr>
                        </thead>
                        <tbody>
                            {keywords.map(({ defaultWord, word }) => (
                                <tr key={defaultWord}>
                                    <td>{defaultWord}</td>
                                    <td><code>{word}</code></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <p className="help-note">
                        Tip: in the editor, start typing the English word (like <code>pr</code>) and the suggestion list offers
                        the keyword in your language.
                    </p>
                    <p className="help-note">
                        Tip: after compiling, the <b>Complexity</b> tab shows how much work your program does as its input grows
                        (Big-O), and suggests faster versions that are checked before they are shown.
                    </p>

                    {GUIDE_SECTIONS.map((section, index) => (
                        <section key={section.id}>
                            <h3>{index + 1}. {section.title}</h3>
                            {section.text.map((text, textIndex) => (
                                <p key={textIndex}><GuideText text={text} words={words} /></p>
                            ))}
                            <CodeExample code={inLanguage(section.example, settings)} settings={settings} onTry={onTryExample} />
                        </section>
                    ))}

                    <h3>{GUIDE_SECTIONS.length + 1}. Things this language does not have (yet)</h3>
                    <table className="guide-table">
                        <thead>
                            <tr><th>Instead of</th><th>Write</th><th>Why</th></tr>
                        </thead>
                        <tbody>
                            {NOT_SUPPORTED.map(([instead, write, why]) => (
                                <tr key={instead}>
                                    <td><code>{inLanguage(instead, settings)}</code></td>
                                    <td>{write && <code>{inLanguage(write, settings)}</code>}</td>
                                    <td>{why}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default HelpModal;
