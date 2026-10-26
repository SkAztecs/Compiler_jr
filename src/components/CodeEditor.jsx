import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { highlightSegments } from '../compiler/highlight.js';
import { completionCandidates, insideTextOrComment, wordBeforeCaret } from '../editor/completion.js';

// Size of one editor line, matching .code-input in index.css
const LINE_HEIGHT = 'calc(0.875rem * 1.7)';
const SUGGESTION_ROW_PX = 30;

function lineAt(text, offset) {
    return text.slice(0, offset).split('\n').length;
}

/**
 * The code editor: line numbers, syntax highlighting from the compiler's own lexer,
 * keyword suggestions, and the highlight for the line being traced.
 *
 * Highlighting works by drawing coloured text in a layer behind a textarea whose
 * own text is transparent: the textarea still handles typing, selection and the caret.
 */
const CodeEditor = ({ code, setCode, settings, selectedLine, onSelectLine }) => {
    const gutterRef = useRef(null);
    const textareaRef = useRef(null);
    const measureRef = useRef(null);
    const pendingCaret = useRef(null);
    const [scroll, setScroll] = useState({ top: 0, left: 0 });
    // Open suggestion list: { start, prefix, items, index, top, left } or null
    const [completion, setCompletion] = useState(null);

    const lineCount = code.split('\n').length;
    const segments = useMemo(() => highlightSegments(code, settings), [code, settings]);

    // Keep the line numbers aligned with the text, and put the caret after an accepted suggestion
    useLayoutEffect(() => {
        if (gutterRef.current) gutterRef.current.scrollTop = scroll.top;
        if (pendingCaret.current !== null && textareaRef.current) {
            textareaRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
            pendingCaret.current = null;
        }
    });

    const syncScroll = (e) => {
        setScroll({ top: e.target.scrollTop, left: e.target.scrollLeft });
    };

    // Where to show suggestions: just under the start of the word being typed.
    // The width is measured from the real text, so it works for every script.
    const popupPosition = (text, wordStart, itemCount) => {
        const textarea = textareaRef.current;
        const style = getComputedStyle(textarea);
        const lineHeight = parseFloat(style.lineHeight);
        const lineIndex = lineAt(text, wordStart) - 1;
        measureRef.current.textContent = text.slice(text.lastIndexOf('\n', wordStart - 1) + 1, wordStart);
        const left = parseFloat(style.paddingLeft) + measureRef.current.offsetWidth - textarea.scrollLeft;
        const lineTop = parseFloat(style.paddingTop) + lineIndex * lineHeight - textarea.scrollTop;
        const height = itemCount * SUGGESTION_ROW_PX + 8;
        // Open above the line when there is no room below it
        const below = lineTop + lineHeight;
        const top = below + height > textarea.clientHeight && lineTop > height ? lineTop - height : below;
        return { top, left: Math.max(0, left) };
    };

    const openSuggestions = (text, caret) => {
        const word = wordBeforeCaret(text, caret);
        if (!word || insideTextOrComment(text, caret, settings)) {
            setCompletion(null);
            return;
        }
        const items = completionCandidates(text, word.prefix, settings);
        if (items.length === 0) {
            setCompletion(null);
            return;
        }
        setCompletion({ ...word, items, index: 0, ...popupPosition(text, word.start, items.length) });
    };

    const accept = (item) => {
        const end = completion.start + completion.prefix.length;
        setCode(code.slice(0, completion.start) + item.label + code.slice(end));
        pendingCaret.current = completion.start + item.label.length;
        setCompletion(null);
    };

    const handleChange = (e) => {
        setCode(e.target.value);
        openSuggestions(e.target.value, e.target.selectionStart);
    };

    const handleKeyDown = (e) => {
        // Ctrl+Space asks for suggestions at the caret
        if (e.key === ' ' && e.ctrlKey) {
            e.preventDefault();
            openSuggestions(code, e.target.selectionStart);
            return;
        }
        if (!completion) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const step = e.key === 'ArrowDown' ? 1 : -1;
            const count = completion.items.length;
            setCompletion({ ...completion, index: (completion.index + step + count) % count });
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            accept(completion.items[completion.index]);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            setCompletion(null);
        }
    };

    // Moving the caret selects the line it is on, and closes suggestions if it left the word
    const handleSelect = (e) => {
        const caret = e.target.selectionStart;
        onSelectLine(lineAt(e.target.value, caret));
        if (completion && caret !== completion.start + completion.prefix.length) setCompletion(null);
    };

    return (
        <div className="editor-section">
            <div className="panel-head">
                <label htmlFor="code-input" className="editor-label">Code Editor</label>
                <span className="panel-meta">
                    {lineCount} {lineCount === 1 ? 'line' : 'lines'}
                    {selectedLine !== null && ` · tracing line ${selectedLine}`}
                </span>
            </div>
            <div className="editor-frame">
                <div className="editor-gutter" ref={gutterRef}>
                    {Array.from({ length: lineCount }, (_, i) => (
                        <span
                            key={i}
                            className={i + 1 === selectedLine ? 'is-selected' : undefined}
                            onClick={() => onSelectLine(i + 1)}
                            title={`Trace line ${i + 1}`}
                        >
                            {i + 1}
                        </span>
                    ))}
                </div>
                <div className="editor-code">
                    {selectedLine !== null && selectedLine <= lineCount && (
                        <div
                            className="editor-line-highlight"
                            aria-hidden="true"
                            style={{
                                top: `calc(1rem + ${selectedLine - 1} * ${LINE_HEIGHT})`,
                                height: LINE_HEIGHT,
                                transform: `translateY(${-scroll.top}px)`,
                            }}
                        />
                    )}
                    <pre className="code-highlight" aria-hidden="true">
                        <code style={{ transform: `translate(${-scroll.left}px, ${-scroll.top}px)` }}>
                            {segments.map((segment, index) => (
                                <span key={index} className={`syntax-${segment.kind}`}>{segment.text}</span>
                            ))}
                        </code>
                    </pre>
                    <textarea
                        id="code-input"
                        ref={textareaRef}
                        className="code-input"
                        value={code}
                        onChange={handleChange}
                        onKeyDown={handleKeyDown}
                        onScroll={syncScroll}
                        onSelect={handleSelect}
                        onBlur={() => setCompletion(null)}
                        spellCheck="false"
                        wrap="off"
                        aria-autocomplete="list"
                        aria-expanded={completion !== null}
                        aria-controls="code-suggestions"
                    />
                    <span className="code-measure" ref={measureRef} aria-hidden="true" />
                    {completion && (
                        <ul
                            id="code-suggestions"
                            className="completion-popup"
                            role="listbox"
                            style={{ top: completion.top, left: completion.left }}
                        >
                            {completion.items.map((item, index) => (
                                <li
                                    key={item.label}
                                    role="option"
                                    aria-selected={index === completion.index}
                                    className={`completion-item${index === completion.index ? ' is-active' : ''}`}
                                    // mousedown, not click, so the editor keeps focus
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        accept(item);
                                    }}
                                >
                                    <span className="completion-label">{item.label}</span>
                                    <span className="completion-detail">{item.detail}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CodeEditor;
