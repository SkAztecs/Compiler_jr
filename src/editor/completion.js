import { keywordSpellings } from '../interpreter/lexer.js';
import { highlightSegments } from '../compiler/highlight.js';

// Keyword and name suggestions while typing.
// Besides the keywords of the chosen language, typing an English keyword ('pr')
// suggests the regional one ('பதிப்பி'), so students without a Tamil or Hindi
// keyboard can still write every keyword.

const WORD_CHAR = /[\p{L}\p{N}\p{M}_]/u;
const MAX_SUGGESTIONS = 8;

// The partly typed word that ends at the caret, or null if there isn't one
export function wordBeforeCaret(code, caret) {
    let start = caret;
    while (start > 0 && WORD_CHAR.test(code[start - 1])) start--;
    const prefix = code.slice(start, caret);
    if (prefix === '' || /^\p{N}/u.test(prefix)) return null; // nothing typed, or a number
    return { start, prefix };
}

// True when the caret is inside "text" or a // comment, where suggestions would get in the way
export function insideTextOrComment(code, caret, settings) {
    let offset = 0;
    for (const segment of highlightSegments(code, settings)) {
        const end = offset + segment.text.length;
        if (caret > offset && caret <= end) {
            const unfinishedText = segment.kind === 'error' && segment.text.startsWith('"');
            return segment.kind === 'string' || segment.kind === 'comment' || unfinishedText;
        }
        offset = end;
    }
    return false;
}

// Suggestions for 'prefix': { label, detail } where label is the text to insert
export function completionCandidates(code, prefix, settings) {
    const lower = prefix.toLowerCase();
    const matches = (word) => word.toLowerCase().startsWith(lower) && word !== prefix;
    const suggestions = [];
    const seen = new Set();
    const add = (label, detail) => {
        if (seen.has(label)) return;
        seen.add(label);
        suggestions.push({ label, detail });
    };

    const keywords = keywordSpellings(settings);
    for (const { word } of keywords) {
        if (matches(word)) add(word, 'keyword');
    }
    // English keyword typed in another language: offer the regional spelling
    for (const { word, defaultWord } of keywords) {
        if (word !== defaultWord && defaultWord.toLowerCase().startsWith(lower)) {
            add(word, `keyword: ${defaultWord}`);
        }
    }
    // Names already used in the program
    const names = new Set(highlightSegments(code, settings)
        .filter(segment => segment.kind === 'identifier')
        .map(segment => segment.text));
    for (const name of [...names].sort()) {
        if (matches(name)) add(name, 'variable');
    }
    return suggestions.slice(0, MAX_SUGGESTIONS);
}
