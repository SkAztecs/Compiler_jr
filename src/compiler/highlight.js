import { Lexer } from '../interpreter/lexer.js';
import { TokenType } from '../../token.js';

// Syntax highlighting with the compiler's own lexer.
// HighlightLexer reuses the Lexer's keyword table and its rules for numbers, text
// and names, so the editor colours code exactly the way the compiler will read it,
// in whichever language the keywords are set to. Unlike the Lexer it never stops
// at a mistake: it marks the bad characters and carries on, because the code is
// usually half-typed while someone is editing it.
//
// The result is a list of segments { text, kind } that together are the whole source.
// Kinds: keyword, literal (true/false), identifier, number, string, comment,
// operator, punctuation, space, error.

const OPERATORS = new Set(['+', '-', '*', '/', '=', '<', '>', '!']);
const TWO_CHAR_OPERATORS = new Set(['==', '!=', '&&', '||']);
const PUNCTUATION = new Set(['(', ')', '{', '}', ';', ',']);

class HighlightLexer extends Lexer {
    getSegments() {
        const segments = [];
        while (this.currentChar !== null) {
            const start = this.pos;
            const kind = this.scanOne();
            segments.push({ text: this.text.slice(start, this.pos), kind });
        }
        return segments;
    }

    // Reads one segment and says what kind it is
    scanOne() {
        const char = this.currentChar;
        if (this.isWhitespace(char)) {
            while (this.currentChar !== null && this.isWhitespace(this.currentChar)) this.advance();
            return 'space';
        }
        if (this.isDigit(char)) {
            this.getNumber();
            return 'number';
        }
        if (this.isAlpha(char)) {
            const token = this.getIdentifier();
            if (token.type === TokenType.IDENTIFIER) return 'identifier';
            return token.type === TokenType.TRUE || token.type === TokenType.FALSE ? 'literal' : 'keyword';
        }
        if (char === '"') {
            try {
                this.getString();
                return 'string';
            } catch {
                return 'error'; // never closed: everything after the quote is unfinished text
            }
        }
        if (char === '/' && this.peek() === '/') {
            while (this.currentChar !== null && this.currentChar !== '\n') this.advance();
            return 'comment';
        }
        if (TWO_CHAR_OPERATORS.has(char + this.peek())) {
            this.advance();
            this.advance();
            return 'operator';
        }
        this.advance();
        if (OPERATORS.has(char)) return 'operator';
        if (PUNCTUATION.has(char)) return 'punctuation';
        return 'error'; // a character the language doesn't have
    }
}

export function highlightSegments(source, settings = {}) {
    let lexer;
    try {
        lexer = new HighlightLexer(source, settings);
    } catch {
        // The keyword settings are invalid (e.g. two keywords spelled the same),
        // so highlight with the default English keywords until they are fixed
        lexer = new HighlightLexer(source, {});
    }
    return lexer.getSegments();
}
